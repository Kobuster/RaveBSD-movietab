// Drop-in scrapers: one file per source, nothing else to edit.
//
// Two folders are read: src/scrapers/ (the ones that ship with this fork) and SCRAPERS_DIR (yours; Docker
// mounts ./scrapers there, read-only). A file of yours with the same id as a built-in one replaces it.
// Files starting with "_" or "." are skipped, so _template.js stays a template.
//
// The folders are checked again at most every 10 seconds when a search starts, so a new or changed file is
// picked up by the next search without a restart. A file that fails to load is skipped and its error is shown
// in the admin panel under Libraries; the other sources carry on.
//
// What a scraper file exports is described in src/scrapers/development-aide.md and src/scrapers/_template.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODES } from './kinds.js';

const BUILT_IN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scrapers');
export const USER_DIR = path.resolve(process.env.SCRAPERS_DIR || path.join(process.cwd(), 'scrapers'));
// The sources written into sources.js keep their ids; "all" is the merged search.
const RESERVED = new Set(['all', 'libgen', 'annas', 'archive', 'gutenberg', 'openstax', 'libretexts', 'memoryoftheworld', 'royallib',
    'zlibrary', 'mobilism', 'audiobookbay', 'librivox', 'audiobooksbee']);
const ID = /^[a-z][a-z0-9]{1,30}$/;
const RESCAN_MS = 10e3;

const loaded = new Map();   // file path -> { mtime, def }  (def null when it failed)
let problems = [];          // [{ file, error }]
let active = new Map();     // id -> scraper (user files win over built-in ones)
let lastScan = 0, scanning = null;

const listDir = dir => {
    try {
        return fs.readdirSync(dir).filter(f => /\.m?js$/.test(f) && !/^[_.]/.test(f)).sort().map(f => path.join(dir, f));
    } catch (e) { return []; }
};

// Checks what a file exported. Returns the error text, or '' when it is usable.
export function checkScraper(def) {
    if (!def || typeof def !== 'object') return 'export default { id, name, kinds, search } is missing';
    if (typeof def.id !== 'string' || !ID.test(def.id)) return 'id must be 2 to 31 lowercase letters and digits, starting with a letter';
    if (RESERVED.has(def.id)) return `id "${def.id}" is taken by a built-in library`;
    if (typeof def.name !== 'string' || !def.name.trim()) return 'name is missing';
    if (!Array.isArray(def.kinds) || !def.kinds.length || def.kinds.some(k => !MODES.includes(k))) return `kinds must list one or more of ${MODES.join(', ')}`;
    if (typeof def.search !== 'function') return 'search(query, ctx) is missing';
    if (def.resolve != null && typeof def.resolve !== 'function') return 'resolve must be a function when given';
    return '';
}

async function loadFile(file, from) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const known = loaded.get(file);
    if (known && known.mtime === st.mtimeMs) return known;
    let def = null, error = '';
    try {
        // The modification time in the address makes Node load a changed file again instead of its cached copy.
        const mod = await import(pathToFileURL(file).href + '?v=' + Math.round(st.mtimeMs));
        def = mod.default || mod.scraper || null;
        error = checkScraper(def);
    } catch (e) { error = (e && e.message) || String(e); }
    const entry = { mtime: st.mtimeMs, from, error, def: error ? null : {
        id: def.id, name: def.name.trim().slice(0, 60), kinds: [...new Set(def.kinds)],
        about: typeof def.about === 'string' ? def.about.slice(0, 200) : '',
        colour: typeof def.colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(def.colour) ? def.colour : '',
        timeout: Math.min(60e3, Math.max(2e3, Number(def.timeout) || 20e3)),
        search: def.search, resolve: def.resolve || null, file: path.basename(file), from,
    } };
    if (error) console.warn(`Scraper ${file} was skipped: ${error}`);
    loaded.set(file, entry);
    return entry;
}

// Reads both folders again (throttled unless forced). Safe to call often; concurrent calls share one scan.
export function refreshScrapers(force = false) {
    if (scanning) return scanning;
    if (!force && Date.now() - lastScan < RESCAN_MS) return Promise.resolve();
    scanning = (async () => {
        const files = [...listDir(BUILT_IN).map(f => [f, 'built-in']), ...listDir(USER_DIR).map(f => [f, 'yours'])];
        const next = new Map(), errs = [];
        for (const [f, from] of files) {
            const e = await loadFile(f, from);
            if (!e) continue;
            if (e.error) { errs.push({ file: path.basename(f), from, error: e.error }); continue; }
            const had = next.get(e.def.id);
            if (had && had.from === from) { errs.push({ file: path.basename(f), from, error: `id "${e.def.id}" is already used by ${had.file}` }); continue; }
            next.set(e.def.id, e.def);
        }
        for (const f of [...loaded.keys()]) if (!files.some(([x]) => x === f)) loaded.delete(f);
        active = next; problems = errs; lastScan = Date.now();
    })().finally(() => { scanning = null; });
    return scanning;
}

export const scrapersFor = mode => [...active.values()].filter(s => s.kinds.includes(mode));
export const getScraper = id => active.get(id) || null;
export const scraperByName = name => [...active.values()].find(s => s.name === name) || null;
// For the admin panel: what is loaded and what was skipped.
export const listScrapers = () => [...active.values()].map(({ id, name, kinds, about, colour, file, from }) => ({ id, name, kinds, about, colour, file, from }));
export const scraperProblems = () => problems.slice();
