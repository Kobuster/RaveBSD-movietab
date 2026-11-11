// .torrent files that qBittorrent search plugins hand over (private trackers often give no magnet link).
//
// RaveBSD reads the file once to learn its info hash (how it follows the torrent in qBittorrent) and its trackers,
// keeps it under DATA/torrents/<hash>.torrent, and uploads that file to qBittorrent instead of a magnet. A magnet
// alone would not do for a private torrent: those switch off DHT and peer exchange, so only the file's own tracker
// address (which carries your passkey) finds peers.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA } from './config.js';

export const TORRENT_DIR = path.join(DATA, 'torrents');
const KEEP = 300;          // stored files, newest first; older ones are removed
export const MAX_BYTES = 10e6;

// Bencode, enough to read a .torrent: returns the value and, for the top dictionary's "info" entry, the exact
// bytes it was written as (the info hash is the SHA-1 of those bytes, not of a re-encoding).
export function decode(buf) {
    let i = 0, infoSpan = null;
    const fail = m => { throw new Error('Not a torrent file: ' + m); };
    const int = end => { const s = buf.toString('latin1', i, end); if (!/^-?\d+$/.test(s)) fail('bad number'); i = end + 1; return Number(s); };
    function value(depth) {
        if (depth > 50) fail('too deep');
        if (i >= buf.length) fail('cut short');
        const c = buf[i];
        if (c === 0x69) { i++; const e = buf.indexOf(0x65, i); if (e < 0) fail('cut short'); return int(e); }            // i<n>e
        if (c === 0x6c) { i++; const out = []; while (buf[i] !== 0x65) { if (i >= buf.length) fail('cut short'); out.push(value(depth + 1)); } i++; return out; } // l...e
        if (c === 0x64) {                                                                                                 // d...e
            i++; const out = {};
            while (buf[i] !== 0x65) {
                if (i >= buf.length) fail('cut short');
                const k = value(depth + 1);
                if (!Buffer.isBuffer(k)) fail('bad key');
                const key = k.toString('latin1'), start = i;
                out[key] = value(depth + 1);
                if (depth === 0 && key === 'info') infoSpan = [start, i];
            }
            i++; return out;
        }
        if (c >= 0x30 && c <= 0x39) {                                                                                     // <len>:<bytes>
            const colon = buf.indexOf(0x3a, i); if (colon < 0) fail('cut short');
            const len = int(colon);
            if (i + len > buf.length) fail('cut short');
            const s = buf.subarray(i, i + len); i += len; return s;
        }
        fail('unexpected byte');
    }
    const root = value(0);
    if (!root || Buffer.isBuffer(root) || Array.isArray(root) || typeof root !== 'object') fail('not a dictionary');
    return { root, infoSpan };
}

const text = v => (Buffer.isBuffer(v) ? v.toString('utf8') : '');

// { hash, name, trackers, files, size, private } or throws.
export function readTorrent(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.length > MAX_BYTES || buf[0] !== 0x64) throw new Error('Not a torrent file');
    const { root, infoSpan } = decode(buf);
    const info = root.info;
    if (!infoSpan || !info || typeof info !== 'object' || Buffer.isBuffer(info)) throw new Error('Not a torrent file: no info');
    const hash = crypto.createHash('sha1').update(buf.subarray(infoSpan[0], infoSpan[1])).digest('hex');
    const trackers = [...new Set([text(root.announce), ...(Array.isArray(root['announce-list']) ? root['announce-list'].flat().map(text) : [])]
        .filter(t => /^(https?|udp):\/\//i.test(t)))];
    const files = Array.isArray(info.files) ? info.files : [{ length: info.length }];
    return {
        hash, name: text(info['name.utf-8'] || info.name), trackers,
        files: files.length, size: files.reduce((n, f) => n + (Number(f && f.length) || 0), 0), private: info.private === 1,
    };
}

// A magnet for the same torrent (for copying and for RaveBSD's own bookkeeping; downloads use the file).
export const magnetFor = t => `magnet:?xt=urn:btih:${t.hash}` + (t.name ? `&dn=${encodeURIComponent(t.name)}` : '') + t.trackers.map(u => `&tr=${encodeURIComponent(u)}`).join('');

const fileOf = hash => path.join(TORRENT_DIR, String(hash).toLowerCase() + '.torrent');

// Keeps the file, then removes the oldest beyond KEEP. Returns what readTorrent found.
export async function storeTorrent(buf) {
    const t = readTorrent(buf);
    await fsp.mkdir(TORRENT_DIR, { recursive: true });
    const to = fileOf(t.hash), tmp = to + '.incoming';
    await fsp.writeFile(tmp, buf); await fsp.rename(tmp, to);
    prune().catch(() => {});
    return t;
}

// The stored file for this hash, or null.
export function storedTorrent(hash) {
    if (!/^[a-f0-9]{40}$/i.test(String(hash || ''))) return null;
    try { return fs.readFileSync(fileOf(hash)); } catch (e) { return null; }
}

export const forgetTorrent = hash => (/^[a-f0-9]{40}$/i.test(String(hash || '')) ? fsp.rm(fileOf(hash), { force: true }) : Promise.resolve());

async function prune() {
    const names = (await fsp.readdir(TORRENT_DIR)).filter(f => f.endsWith('.torrent'));
    if (names.length <= KEEP) return;
    const dated = await Promise.all(names.map(async f => [f, (await fsp.stat(path.join(TORRENT_DIR, f))).mtimeMs]));
    dated.sort((a, b) => b[1] - a[1]);
    for (const [f] of dated.slice(KEEP)) await fsp.rm(path.join(TORRENT_DIR, f), { force: true });
}

// Magnets may give the hash in base32 (32 letters); qBittorrent and RaveBSD use hex.
export function hexHash(magnet) {
    const m = String(magnet || '').match(/xt=urn:btih:([a-z0-9]+)/i);
    if (!m) return '';
    const h = m[1];
    if (/^[a-f0-9]{40}$/i.test(h)) return h.toLowerCase();
    if (!/^[a-z2-7]{32}$/i.test(h)) return '';
    let bits = '';
    for (const c of h.toUpperCase()) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
    return bits.match(/.{4}/g).map(b => parseInt(b, 2).toString(16)).join('');
}
