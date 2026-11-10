# src/scrapers/ : drop-in sources

Each file here is one source. `src/scrapers.js` loads every `.js` / `.mjs` file in this folder and in `SCRAPERS_DIR` (Docker: `./scrapers` next to `compose.yaml`, mounted read-only at `/scrapers`). Nothing else needs editing: the search, the loading bar, `/search/<id>`, the admin panel's library list and the on/off switch all come from the file. Files starting with `_` or `.` are skipped.

The folders are read again at most every 10 seconds when a search starts, so a new or changed file is used by the next search. A file of yours with the same `id` as one here replaces it.

## What a file exports

`_template.js` is a filled-in, commented example. In short:

```js
export default {
    id: 'mysite',                 // a-z and 0-9, starts with a letter, not a built-in library's id
    name: 'My Site',
    kinds: ['movies'],            // 'ebooks', 'audiobooks', 'movies'
    about: 'Movies · ...',        // optional, admin panel
    colour: '#B7A4FF',            // optional, admin panel
    timeout: 20000,               // optional, ms per request
    async search(query, ctx) { return [{ title, ... }]; },
    async resolve(result, ctx) { result.directUrl = '...'; },   // optional
};
```

`ctx`: `json(url, opts)`, `text(url, opts)`, `get(url, opts)` (all send RaveBSD's User-Agent and time out), `strip(html)`, `lengthText(seconds)`, `parseSize(number, unit)`, `log(...)`, `mode`.

## What happens to results

`normalizeScraped()` in `src/sources.js` keeps known fields in their types (title, author, year, language, length as text; format lowercase; filesize a number), sets `source` to the scraper's name and `_scraper` to its id, and drops any id the scraper set. Extra fields stay on the result for `resolve()`. Then every result goes through the same path as the built-in libraries' results:

- links that are not `http(s)` are removed (`cleanLinks`), so a scraper cannot point the page at `javascript:` or the server at a file;
- downloads still go through `netguard.fetchPublic`, so a scraped link cannot reach the owner's network;
- file names come from the naming template (`rename.js`), never from the site.

`resolve()` runs when the page asks for a result's link (`/resolve`), and again right before a download if it has not run yet. It gets the same deadline as the built-in resolvers (12 s).

## The ones here

| File | id | Searches | Notes |
| --- | --- | --- | --- |
| `archive-films.js` | `iafilms` | Archive.org collections `feature_films`, `prelinger` | `resolve()` reads the item's file list and picks the biggest MP4 (then MKV, WebM, …) |
| `commons-films.js` | `commonsfilms` | Wikimedia Commons, `filetype:video` | File link comes with the search; files under 15 MB are left out |
| `loc-films.js` | `locfilms` | loc.gov `/film-and-videos/` | Written from the API docs; many items are watch-only and stay "source page only" |

Their parsers have tests in `test/scrapers.test.mjs`, run by `npm test`.

## Rules

- Public, lawful sources. These files run inside the server with its permissions: only add code you trust.
- Catch nothing you cannot handle: a thrown error is reported as that source failing, which is what the admin panel should show.
- Keep requests few. `search()` should be one request; per-result lookups belong in `resolve()`, which only runs for results someone looks at.
