// Wikimedia Commons: freely licensed and public-domain video files, through the MediaWiki API.
//
// Commons holds every kind of video, from news clips to whole films. Files under MIN_MB are left out so a
// search mostly turns up films; lower it to see shorter clips too. The file link comes with the search answer,
// so nothing has to be looked up afterwards.
const MIN_MB = 15;
const API = 'https://commons.wikimedia.org/w/api.php';
const FORMAT = { 'video/webm': 'webm', 'video/ogg': 'ogv', 'application/ogg': 'ogv', 'video/mpeg': 'mpeg', 'video/mp4': 'mp4' };

// One page of the API answer as a result (exported for the tests). The answer lists pages either as an array
// (formatversion=2) or as an object keyed by page id.
export function commonsResult(page, strip) {
    const ii = (page.imageinfo || [])[0];
    if (!ii || !ii.url) return null;
    const ext = ii.extmetadata || {};
    const val = k => strip(String((ext[k] && ext[k].value) || ''));
    const fileName = String(page.title || '').replace(/^File:/, '');
    return {
        title: val('ObjectName') || fileName.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
        author: val('Artist').slice(0, 120),
        year: (val('DateTimeOriginal').match(/\b(1[89]\d\d|20\d\d)\b/) || [''])[0],
        format: FORMAT[ii.mime] || (fileName.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase(),
        filesize: Number(ii.size) || 0,
        length: Number(ii.duration) > 60 ? Math.round(Number(ii.duration)) : '',
        license: val('LicenseShortName'),
        directUrl: ii.url,
        pageUrl: ii.descriptionurl || '',
        coverUrl: ii.thumburl || '',
        order: Number(page.index) || 0,
    };
}

export default {
    id: 'commonsfilms',
    name: 'Wikimedia Commons',
    kinds: ['movies'],
    about: 'Movies · freely licensed and public-domain videos',
    colour: '#A8F0FF',

    async search(query, ctx) {
        const p = new URLSearchParams({
            action: 'query', format: 'json', formatversion: '2', origin: '*',
            generator: 'search', gsrnamespace: '6', gsrlimit: '30', gsrsearch: `${query} filetype:video`,
            prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '320',
            iiextmetadatafilter: 'ObjectName|Artist|DateTimeOriginal|LicenseShortName',
        });
        // Wikimedia asks scripts to say who they are; Api-User-Agent is the header meant for that.
        const data = await ctx.json(`${API}?${p}`, { headers: { 'Api-User-Agent': 'RaveBSD (self-hosted search)' } });
        const pages = data.query && data.query.pages;
        const list = Array.isArray(pages) ? pages : Object.values(pages || {});
        return list.map(pg => commonsResult(pg, ctx.strip)).filter(r => r && r.filesize >= MIN_MB * 1e6)
            .sort((a, b) => a.order - b.order)
            .map(r => ({ ...r, length: r.length ? ctx.lengthText(r.length) : '' }));
    },
};
