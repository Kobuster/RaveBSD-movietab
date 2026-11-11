// qBittorrent search plugins, run as RaveBSD sources. Drop a plugin's .py file into SCRAPERS_DIR/qbt/ (./scrapers/qbt
// next to compose.yaml); it is picked up within 10 seconds, no restart. No conversion: the file is run as it is,
// with qBittorrent's own helper files (src/nova/), so a plugin that works in qBittorrent works here.
//
// Which searches a plugin answers comes from its supported_categories, qBittorrent's fixed list:
//   books -> eBooks and audiobooks, movies, tv, anime, music, games, software, pictures -> the tab of that name.
// A plugin that lists only "all" (or nothing) is a general torrent search: it runs in every tab, but only while
// "Include general torrent search" is on in Settings > Libraries, and is asked for "all".
//
// Each search starts the plugin as its own Python process (src/nova/run.py), stopped after TIMEOUT_MS; whatever it
// printed by then still counts. Its .torrent links are fetched only when a result is used (download, magnet copy),
// through the plugin's own download_torrent() when it has one (private trackers log in there).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MODES, modesForCategories, qbtCategoryOf, modeInfo } from './kinds.js';
import { storeTorrent, magnetFor, hexHash, MAX_BYTES } from './torrentfile.js';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nova', 'run.py');
const PYTHON = process.env.PYTHON || 'python3';
export const QBT_CATEGORIES = ['all', 'anime', 'books', 'games', 'movies', 'music', 'pictures', 'software', 'tv'];
export const TIMEOUT_MS = 28e3;       // under the search's own 30 s deadline
const INFO_MS = 15e3, DOWNLOAD_MS = 11e3;
const MAX_OUT = 4e6;                  // bytes of output read from one run

// ── Running Python ───────────────────────────────────────────────────────────
// Resolves { out, err, code, timedOut }. Never rejects: a missing Python or a crash is in err.
export function runPy(args, ms, onLine) {
    return new Promise(resolve => {
        let out = '', err = '', buf = '', done = false, timedOut = false, size = 0;
        let child;
        try {
            child = spawn(PYTHON, ['-I', '-B', RUNNER, ...args], {
                // -I keeps PYTHONPATH and the user's site-packages out; -B: no __pycache__ in the (read-only) plugin folder.
                env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/tmp', LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) { return resolve({ out: '', err: e.message, code: -1, timedOut: false }); }
        const end = code => {
            if (done) return; done = true; clearTimeout(timer);
            if (buf && onLine) onLine(buf);
            resolve({ out, err: err.slice(-4000), code, timedOut });
        };
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, ms);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', d => {
            size += d.length;
            if (size > MAX_OUT) { child.kill('SIGKILL'); return; }
            out += d;
            if (onLine) { buf += d; const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine); }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', d => { if (err.length < 64e3) err += d; });
        child.on('error', e => { err += e.code === 'ENOENT' ? `Python 3 (${PYTHON}) is not installed in this image` : e.message; end(-1); });
        child.on('close', code => end(code));
    });
}
// The last meaningful line of a Python error, for the admin panel.
const lastError = err => String(err || '').trim().split('\n').filter(l => l.trim() && !/^\s/.test(l) && !/Warning:/.test(l)).pop() || '';

// ── Result lines ─────────────────────────────────────────────────────────────
// prettyPrinter's line: link|name (URL-quoted)|size in bytes|seeds|leech|engine url|description page|publish date
export function parseLine(line) {
    const f = String(line).replace(/\r$/, '').split('|');
    if (f.length < 6) return null;
    const link = f[0].trim();
    if (!/^(magnet:\?|https?:\/\/)/i.test(link)) return null;
    let name;
    try { name = decodeURIComponent(f[1]); } catch (e) { name = f[1]; }
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return null;
    const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : -1; };
    return { link, name, size: num(f[2]), seeds: num(f[3]), leech: num(f[4]), engine: f[5].trim(), desc: (f[6] || '').trim(), date: num(f[7]) };
}

// Release names ("Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP") made into a title and a year for naming
// and matching. The full name stays on the result, so nothing is lost when this guesses wrong.
const TAGS = /(^|\s)(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr|bluray|blu ray|bdrip|brrip|bdremux|remux|webrip|web dl|webdl|web|hdtv|hdrip|dvdrip|dvdscr|dvd|x264|x265|h 264|h 265|h264|h265|hevc|avc|xvid|divx|aac|ac3|dts|ddp?5 1|atmos|proper|repack|extended|unrated|remastered|complete|multi|subs?|dubbed|s\d{1,2}(e\d{1,3})?|season \d+|flac|mp3|320|v0|24bit|16bit|epub|pdf|mobi|azw3|m4b|unabridged|abridged|iso|gog|x64|x86|win(dows)?|linux|mac(os)?|portable|incl)(?=\s|$)/i;
export function parseRelease(name) {
    let s = String(name || '').trim();
    const full = s;
    s = s.replace(/\.(mkv|mp4|avi|torrent|zip|rar|7z)$/i, '');
    // Dots and underscores between words, as release names have them (but "Dr. Strangelove" keeps its dot).
    if (!/\s/.test(s) || (s.match(/[._]/g) || []).length >= 3) s = s.replace(/[._]+/g, ' ');
    s = s.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
    let cut = s.length, year = '';
    // A year after the start ("2001 A Space Odyssey 1968" keeps its title).
    const y = /(?:^|[\s(])((?:18|19|20)\d{2})(?=[\s)]|$)/g;
    let m;
    while ((m = y.exec(s))) { if (m.index + m[0].length - 4 > 0) { year = m[1]; cut = Math.min(cut, m.index); break; } }
    const t = s.match(TAGS);
    if (t && t.index > 0) cut = Math.min(cut, t.index);
    let title = s.slice(0, cut).replace(/[\s\-–(:,]+$/, '').trim();
    if (!title) title = s || full;
    return { title, year };
}

// The format a release name mentions ("...1080p.x264.mkv", "[FLAC]", "ISO"), the tab's own formats first. '' when none.
const ANY_FORMAT = ['mkv', 'mp4', 'avi', 'webm', 'epub', 'pdf', 'mobi', 'azw3', 'm4b', 'flac', 'mp3', 'iso', '7z', 'exe', 'deb', 'cbz', 'cbr'];
export function formatOf(name, mode) {
    const words = new Set(String(name || '').toLowerCase().split(/[^a-z0-9]+/));
    return [...modeInfo(mode).formats, ...ANY_FORMAT].find(f => words.has(f)) || '';
}

// ── Plugins ──────────────────────────────────────────────────────────────────
const infos = new Map();   // file -> { mtime, info, error }
const pending = new Map(); // token -> { file, url, name } for .torrent links (never sent to the page: they may hold passkeys)
const PENDING_MAX = 5000;
let problems = [];

const idFor = (stem, used) => {
    const base = ('qbt' + stem.toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 29);
    let id = base, n = 2;
    while (used.has(id)) id = base + n++;
    used.add(id);
    return id;
};

async function infoOf(file) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const known = infos.get(file);
    if (known && known.mtime === st.mtimeMs) return known;
    const r = await runPy(['info', file], INFO_MS);
    let info = null, error = '';
    try {
        info = JSON.parse(r.out.trim().split('\n').pop());
        if (!info || typeof info.name !== 'string' || !info.name.trim()) throw new Error('no name');
    } catch (e) { info = null; error = r.timedOut ? 'took too long to load' : lastError(r.err) || 'could not be read as a qBittorrent plugin'; }
    if (info && info.categories) {
        const bad = info.categories.filter(c => !QBT_CATEGORIES.includes(c));
        if (bad.length) { error = `unknown categories: ${bad.join(', ')} (qBittorrent only knows ${QBT_CATEGORIES.join(', ')})`; info = null; }
    }
    const entry = { mtime: st.mtimeMs, info, error };
    if (error) console.warn(`qBittorrent plugin ${path.basename(file)} was skipped: ${error}`);
    infos.set(file, entry);
    return entry;
}

// The plugins in dir as scraper definitions (the shape src/scrapers.js uses), plus what failed to load.
export async function loadPlugins(dir) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /\.py$/.test(f) && !/^[_.]/.test(f)).sort().map(f => path.join(dir, f)); } catch (e) { /* no folder */ }
    for (const f of [...infos.keys()]) if (!files.includes(f)) infos.delete(f);
    const defs = [], errs = [], used = new Set();
    for (const file of files) {
        const e = await infoOf(file);
        if (!e) continue;
        if (e.error) { errs.push({ file: 'qbt/' + path.basename(file), from: 'yours', error: e.error }); continue; }
        const cats = e.info.categories;
        const specific = (cats || []).filter(c => c !== 'all');
        const general = !specific.length;
        const kinds = general ? [...MODES] : modesForCategories(specific);
        defs.push({
            id: idFor(path.basename(file, '.py'), used), name: e.info.name.trim().slice(0, 60), kinds, general,
            about: general ? 'Torrents · general search, every tab' : `Torrents · ${specific.join(', ')}`,
            colour: '', timeout: TIMEOUT_MS + 2e3, file: 'qbt/' + path.basename(file), from: 'yours', qbt: true,
            search: (query, ctx) => searchPlugin(file, general, query, ctx),
            resolve: (r, ctx) => resolvePlugin(r, ctx),
        });
    }
    problems = errs;
    return { defs, problems: errs };
}
export const pluginProblems = () => problems.slice();

async function searchPlugin(file, general, query, ctx) {
    // General plugins without categories are run with search(what), like qBittorrent does (run.py decides).
    const cat = general ? 'all' : qbtCategoryOf(ctx.mode);
    const rows = [];
    const r = await runPy(['search', file, cat, query], TIMEOUT_MS, line => { const p = parseLine(line); if (p && rows.length < 200) rows.push(p); });
    if (!rows.length && r.code !== 0 && !r.timedOut) throw new Error(lastError(r.err) || 'the plugin failed');
    if (r.timedOut) ctx.log(`stopped after ${TIMEOUT_MS / 1000}s with ${rows.length} results`);
    // Most seeded first, as qBittorrent's own list is usually read.
    rows.sort((a, b) => b.seeds - a.seeds);
    return rows.slice(0, 60).map(p => {
        const { title, year } = parseRelease(p.name);
        const out = {
            title, year, release: p.name, filesize: p.size > 0 ? p.size : 0, format: formatOf(p.name, ctx.mode),
            seeds: p.seeds, leech: p.leech,
            pageUrl: /^https?:\/\//i.test(p.desc) ? p.desc : '',
        };
        if (/^magnet:/i.test(p.link)) {
            const hash = hexHash(p.link);
            if (hash) { out.magnet = p.link; out.infoHash = hash; }
        } else {
            const token = crypto.randomBytes(9).toString('hex');
            pending.set(token, { file, url: p.link, name: p.name });
            if (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value);
            out.torrentToken = token;
        }
        return out;
    }).filter(o => o.magnet || o.torrentToken);
}

// A .torrent link becomes a stored file and a magnet with the same hash (see torrentfile.js).
async function resolvePlugin(r, ctx) {
    if (r.magnet || !r.torrentToken) return;
    const p = pending.get(r.torrentToken);
    if (!p) throw new Error('this result is too old, search again');
    const out = await runPy(['download', p.file, p.url], DOWNLOAD_MS);
    // download_torrent() prints "<path> <url>"; the path is the first word.
    const line = out.out.trim().split('\n').filter(l => l.trim()).pop() || '';
    const file = line.split(' ')[0];
    if (!file || !path.isAbsolute(file)) throw new Error(out.timedOut ? 'the .torrent took too long' : lastError(out.err) || 'the plugin gave no .torrent');
    let buf;
    try {
        // Only temporary files the plugin just wrote (helpers.download_file uses the system temp folder).
        const real = fs.realpathSync(file);
        if (!/^\/tmp\//.test(real)) throw new Error('outside /tmp');
        if (fs.statSync(real).size > MAX_BYTES) throw new Error('too big');
        buf = fs.readFileSync(real);
    } finally { fs.rm(file, { force: true }, () => {}); }
    const t = await storeTorrent(buf);
    r.magnet = magnetFor(t); r.infoHash = t.hash; r.torrentFile = true;
    if (!r.filesize && t.size) r.filesize = t.size;
    pending.delete(r.torrentToken);
    ctx.log(`got the .torrent for ${t.name || t.hash}${t.private ? ' (private)' : ''}`);
}
