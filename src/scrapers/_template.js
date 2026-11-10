// A drop-in scraper. Copy this file into your scrapers folder (./scrapers next to compose.yaml), give it a
// name that does not start with "_", fill it in, and search: RaveBSD picks it up within 10 seconds, no
// restart. Problems show in the admin panel under Libraries, and in `docker compose logs ravebsd`.
//
// Try it on its own while you write it: /search/<id>?q=words&mode=movies on your RaveBSD shows exactly what
// it returns, file links included.

export default {
    // Lowercase letters and digits, starting with a letter. Used in /search/<id> and to switch it off.
    id: 'mysite',
    // Shown in the loading bar, on results ("Found on ...") and in the admin panel.
    name: 'My Site',
    // Which searches it answers: any of 'ebooks', 'audiobooks', 'movies'.
    kinds: ['movies'],
    // Optional: one line under its name in the admin panel, and its colour there.
    about: 'Movies · what it has',
    colour: '#B7A4FF',
    // Optional: the longest one request may take, in milliseconds (default 20000, at most 60000).
    timeout: 20000,

    // Returns a list of results. Each needs a title; everything else is optional:
    //   author, year, language, format ('mp4'), filesize (bytes), length ('1 h 32 min'),
    //   pageUrl (the item's page on the site), coverUrl (an image), and one of:
    //   directUrl (the file itself: RaveBSD can download it to the server),
    //   magnet (a magnet link: goes to qBittorrent when that is set up).
    // Any other fields you add are kept and handed back to resolve() below.
    // Throwing an error counts as "failed on the last search" in the admin panel; the other sources carry on.
    async search(query, ctx) {
        // ctx.json(url, { headers, ms }) fetches and parses JSON, throwing on an error status.
        // ctx.text(url) returns the page as text; ctx.get(url) returns the raw Response.
        // ctx.strip(html) turns HTML into plain text; ctx.lengthText(seconds) gives '1 h 32 min';
        // ctx.parseSize('1.4', 'GB') gives bytes; ctx.log(...) writes to the server log with this id.
        // ctx.mode is the search being run ('movies' here).
        const data = await ctx.json(`https://example.org/api/search?q=${encodeURIComponent(query)}`);
        return (data.items || []).map(it => ({
            title: it.title,
            year: String(it.year || ''),
            pageUrl: it.page,
            coverUrl: it.poster,
            itemId: it.id, // kept for resolve()
        }));
    },

    // Optional. When finding the file needs another request per result, do it here instead of in search():
    // results show at once and their links fill in as the page asks for them (and right before a download).
    // Set r.directUrl (or r.magnet), and r.format / r.filesize / r.length if you learn them.
    async resolve(r, ctx) {
        const item = await ctx.json(`https://example.org/api/item/${encodeURIComponent(r.itemId)}`);
        const file = (item.files || []).find(f => /\.mp4$/i.test(f.url));
        if (!file) return;
        r.directUrl = file.url;
        r.format = 'mp4';
        r.filesize = file.bytes || 0;
    },
};
