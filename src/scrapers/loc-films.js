// Library of Congress: films and videos in its online collections, through the loc.gov JSON API.
//
// Written from the API documentation (https://www.loc.gov/apis/json-and-yaml/). Many items can only be watched
// on loc.gov; those stay "source page only". Items marked access-restricted are left out.
const BASE = 'https://www.loc.gov';
const https = u => (typeof u === 'string' && u.startsWith('//') ? 'https:' + u : u);
const list = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
// Contributors come as plain names or as { name: facet link } objects.
const names = v => list(v).map(x => (typeof x === 'string' ? x : Object.keys(x || {})[0] || '')).filter(Boolean);

// The best video file in an item's resources (exported for the tests). resources[].files is a list of lists:
// each inner list is one file in several versions.
export function pickLocVideo(resources) {
    const files = list(resources).flatMap(r => list(r && r.files).flat()).filter(f => f && typeof f.url === 'string');
    const videos = files.filter(f => /^video\//.test(f.mimetype || '') || /\.(mp4|mov|mpe?g|webm)(\?|$)/i.test(f.url));
    return videos.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (Number(b.height) || 0) - (Number(a.height) || 0))[0] || null;
}

export default {
    id: 'locfilms',
    name: 'Library of Congress',
    kinds: ['movies'],
    about: 'Movies · early films and newsreels from loc.gov',
    colour: '#FFC070',

    async search(query, ctx) {
        const data = await ctx.json(`${BASE}/film-and-videos/?q=${encodeURIComponent(query)}&fo=json&c=25`);
        return list(data.results)
            .filter(r => r && (r.url || r.id) && !r.access_restricted && !r['access-restricted'])
            .filter(r => { const f = list(r.online_format || r['online-format']); return !f.length || f.some(x => /video/i.test(x)); })
            .map(r => ({
                title: list(r.title)[0] || 'Untitled',
                author: names(r.contributor).slice(0, 3).join(', '),
                year: (String(r.date || '').match(/\d{4}/) || [''])[0],
                language: list(r.language)[0] || '',
                pageUrl: https(r.url || r.id),
                coverUrl: https(list(r.image_url)[0] || ''),
            }));
    },

    async resolve(r, ctx) {
        const url = r.pageUrl + (r.pageUrl.includes('?') ? '&' : '?') + 'fo=json&at=item,resources';
        const data = await ctx.json(url);
        const f = pickLocVideo(data.resources);
        if (!f) return;
        r.directUrl = https(f.url);
        r.format = (String(f.mimetype || '').split('/')[1] || (f.url.match(/\.([a-z0-9]+)(\?|$)/i) || [])[1] || '').toLowerCase().replace('quicktime', 'mov');
        if (Number(f.size) > 0) r.filesize = Number(f.size);
        if (Number(f.duration) > 60) r.length = ctx.lengthText(Number(f.duration));
    },
};
