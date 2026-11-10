// Internet Archive: public-domain feature films and the Prelinger Archives.
//
// Only the curated collections below are searched. Plain mediatype:movies would also find millions of user
// uploads, many of them not free to share. Add collection ids here to widen it (the id is the last part of
// https://archive.org/details/<id>).
const COLLECTIONS = ['feature_films', 'prelinger'];

const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|ogv|mpe?g)$/i;
// Formats most players open come first; within a format the biggest file wins (Archive.org keeps a small
// "512Kb MPEG4" copy next to the full-size one).
const RANK = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'ogv', 'mpeg', 'mpg'];
const extOf = name => (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
// A file's length in the item metadata: seconds ("1234.5") or a clock ("1:02:03").
const secs = v => { const t = String(v || ''); return t.includes(':') ? t.split(':').reduce((a, x) => a * 60 + (+x || 0), 0) : +t || 0; };
const first = v => (Array.isArray(v) ? v[0] : v) || '';

// The video file to download from an item's file list (exported for the tests).
export function pickVideo(files) {
    const videos = (files || []).filter(f => f && VIDEO.test(f.name || '') && f.source !== 'metadata' && !/(^|[^a-z])(sample|trailer)([^a-z]|$)/i.test(f.name));
    const rank = f => { const i = RANK.indexOf(extOf(f.name)); return i < 0 ? RANK.length : i; };
    return videos.sort((a, b) => rank(a) - rank(b) || (parseInt(b.size) || 0) - (parseInt(a.size) || 0))[0] || null;
}

export default {
    id: 'iafilms',
    name: 'Internet Archive films',
    kinds: ['movies'],
    about: 'Movies · public-domain feature films and Prelinger',
    colour: '#8FD0FF',

    async search(query, ctx) {
        const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+mediatype:movies+AND+collection:(${COLLECTIONS.join('+OR+')})`
            + '&fl[]=identifier,title,creator,year,language,downloads&sort[]=downloads+desc&rows=25&page=1&output=json';
        const data = await ctx.json(url);
        return ((data.response && data.response.docs) || []).filter(d => d.identifier).map(d => ({
            title: first(d.title) || d.identifier,
            author: Array.isArray(d.creator) ? d.creator.join(', ') : d.creator || '',
            year: String(d.year || ''),
            language: first(d.language),
            pageUrl: `https://archive.org/details/${d.identifier}`,
            coverUrl: `https://archive.org/services/img/${d.identifier}`,
            identifier: d.identifier,
        }));
    },

    // The item's file list says which file is the film, its size and its length.
    async resolve(r, ctx) {
        const meta = await ctx.json(`https://archive.org/metadata/${encodeURIComponent(r.identifier)}`);
        const f = pickVideo(meta.files);
        if (!f) return;
        r.directUrl = `https://archive.org/download/${encodeURIComponent(r.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
        r.format = extOf(f.name);
        r.filesize = parseInt(f.size) || 0;
        const s = secs(f.length) || secs(first(meta.metadata && meta.metadata.runtime));
        if (s > 60) r.length = ctx.lengthText(s);
        if (!r.year && meta.metadata) r.year = (String(first(meta.metadata.year) || first(meta.metadata.date)).match(/\d{4}/) || [''])[0];
    },
};
