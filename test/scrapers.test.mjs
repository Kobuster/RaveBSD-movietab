// Drop-in scrapers and the movies category. Run: node test/scrapers.test.mjs
// No network: the built-in movie scrapers are switched off for the merged search, and a fake scraper stands in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rbsd-scrapers-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.SCRAPERS_DIR = path.join(root, 'mine');
fs.mkdirSync(process.env.SCRAPERS_DIR, { recursive: true });
const write = (name, body) => fs.writeFileSync(path.join(process.env.SCRAPERS_DIR, name), body);

const { checkScraper, refreshScrapers, listScrapers, scraperProblems, getScraper } = await import('../src/scrapers.js');

// ── What a scraper file must export ──────────────────────────────────────────
{
    const ok = { id: 'abc', name: 'A', kinds: ['movies'], search() {} };
    assert.equal(checkScraper(ok), '');
    assert.match(checkScraper({ ...ok, id: 'Bad-Id' }), /lowercase/);
    assert.match(checkScraper({ ...ok, id: 'libgen' }), /taken/);
    assert.match(checkScraper({ ...ok, kinds: ['films'] }), /kinds/);
    assert.match(checkScraper({ ...ok, kinds: [] }), /kinds/);
    assert.match(checkScraper({ ...ok, search: 'x' }), /search/);
    assert.match(checkScraper({ ...ok, resolve: 1 }), /resolve/);
    assert.match(checkScraper(null), /missing/);
    console.log('scraper checks: ok');
}

// ── Loading: built-in ones, yours, broken ones, replacing and reloading ──────
{
    write('fake.js', `export default { id: 'fakefilms', name: 'Fake Films', kinds: ['movies'], about: 'test', colour: '#123456',
        async search(q) { return [
            { title: 'Nosferatu', author: 'F. W. Murnau', year: 1922, format: '.MP4', filesize: '1000', directUrl: 'https://films.example/n.mp4', coverUrl: 'javascript:alert(1)' },
            { title: 'Nosferatu (restored)', year: '1922', pageUrl: 'https://films.example/m', itemId: 'm1' },
            { nope: true },
        ]; },
        async resolve(r) { if (r.itemId === 'm1') { r.directUrl = 'https://films.example/m.mkv'; r.format = 'MKV'; r.filesize = '2000'; } } };`);
    write('broken.js', `export default { id: 'Broken', name: 'x', kinds: ['movies'], search() {} };`);
    write('throws.js', `throw new Error('boom at load');`);
    write('_ignored.js', `export default { id: 'ignored', name: 'x', kinds: ['movies'], search() {} };`);
    write('notes.txt', 'not code');
    await refreshScrapers(true);
    const ids = listScrapers().map(s => s.id).sort();
    assert.deepEqual(ids, ['commonsfilms', 'fakefilms', 'iafilms', 'locfilms'], 'built-in and yours load, broken and _ files do not');
    const probs = scraperProblems();
    assert.ok(probs.some(p => p.file === 'broken.js' && /lowercase/.test(p.error)), 'a bad id is reported');
    assert.ok(probs.some(p => p.file === 'throws.js' && /boom at load/.test(p.error)), 'a file that throws is reported');
    assert.equal(getScraper('fakefilms').from, 'yours');
    assert.equal(getScraper('iafilms').from, 'built-in');

    // Same id as a built-in one: yours wins.
    write('myia.js', `export default { id: 'iafilms', name: 'My IA', kinds: ['movies'], search() { return []; } };`);
    await refreshScrapers(true);
    assert.equal(getScraper('iafilms').name, 'My IA');
    fs.rmSync(path.join(process.env.SCRAPERS_DIR, 'myia.js'));
    await refreshScrapers(true);
    assert.equal(getScraper('iafilms').name, 'Internet Archive films', 'removing yours brings the built-in one back');

    // A changed file is loaded again without a restart.
    const f = path.join(process.env.SCRAPERS_DIR, 'later.js');
    fs.writeFileSync(f, `export default { id: 'later', name: 'Before', kinds: ['ebooks'], search() { return []; } };`);
    await refreshScrapers(true);
    assert.equal(getScraper('later').name, 'Before');
    fs.writeFileSync(f, `export default { id: 'later', name: 'After', kinds: ['ebooks'], search() { return []; } };`);
    const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t);
    await refreshScrapers(true);
    assert.equal(getScraper('later').name, 'After', 'an edited file is picked up');
    fs.rmSync(f);
    await refreshScrapers(true);
    assert.equal(getScraper('later'), null, 'a deleted file is dropped');
    console.log('scraper loading: ok');
}

// ── A movie search through the merged search, then filing a movie ───────────
{
    const { settings } = await import('../src/config.js');
    const sources = await import('../src/sources.js');
    const jobs = await import('../src/jobs.js');
    sources.setResultDecorator(jobs.decorateResult);
    sources.setSourcesOff(['iafilms', 'commonsfilms', 'locfilms']); // they would go to the network
    const ask = async u => (await sources.default.fetch(new Request('http://x' + u), {}, { waitUntil() {} })).json();
    const out = await ask('/search/all?q=nosferatu&mode=movies');
    assert.deepEqual(Object.keys(out.meta).filter(k => out.meta[k] > 0), ['fakefilms'], 'only movie sources answer');
    assert.ok(!('libgen' in out.meta) || out.meta.libgen === 0, 'book libraries are not asked');
    assert.equal(out.labels.fakefilms, 'Fake Films', 'the page is told the scraper\'s name');
    const n = out.results.find(r => r.title === 'Nosferatu');
    assert.ok(n, 'results come through');
    assert.equal(n.source, 'Fake Films');
    assert.equal(n.kind, 'movie');
    assert.equal(n.format, 'mp4', 'format is cleaned');
    assert.equal(n.filesize, 1000, 'size is a number');
    assert.equal(n.year, '1922');
    assert.equal(n.coverUrl, undefined, 'non-web links are dropped');
    assert.equal(n.linkType, 'direct');
    assert.match(n.fileAs, /^Nosferatu \(1922\)\/Nosferatu \(1922\)\.mp4$/, 'filed with the movie template');
    assert.equal(out.results.find(r => r.title === 'Nosferatu (restored)').linkType, 'direct', 'the plain JSON search waits for links');
    // The page's streamed search answers first and finds links afterwards, through /resolve.
    const raw = await (await sources.default.fetch(new Request('http://x/search/all?q=nosferatu&mode=movies&stream=1'), {}, { waitUntil() {} })).text();
    const lines = raw.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines[0].labels.fakefilms, 'Fake Films', 'the stream names the scraper before it answers');
    const fin = lines.find(l => l.final).final;
    const m = fin.results.find(r => r.title === 'Nosferatu (restored)');
    assert.equal(m.linkType, 'pending', 'a scraper with resolve() finds links later');
    const res = await ask('/resolve?id=' + encodeURIComponent(m.id));
    assert.equal(res.directUrl, 'https://films.example/m.mkv');
    assert.equal(res.format, 'mkv');
    assert.equal(res.filesize, 2000);
    assert.equal(out.results.length, 2, 'a result without a title is dropped');
    // The scraper on its own, links looked up.
    const one = await ask('/search/fakefilms?q=nosferatu&mode=movies');
    assert.equal(one.results.length, 2);
    assert.ok(one.results.every(r => r.linkType === 'direct'), '/search/<id> returns resolved links');
    // A book search never runs a movie scraper.
    sources.setSourcesOff(['iafilms', 'commonsfilms', 'locfilms', 'libgen', 'annas', 'archive', 'gutenberg', 'openstax', 'libretexts', 'memoryoftheworld', 'royallib', 'zlibrary', 'mobilism']);
    const books = await ask('/search/all?q=nosferatu&mode=ebooks');
    assert.ok(!('fakefilms' in books.meta), 'movie scrapers stay out of book searches');
    console.log('movie search: ok');

    // Filing: a torrent with several files is kept whole, in the folder the movie template names.
    const inc = path.join(root, 'incoming', 'Nosferatu.1922.1080p.BluRay');
    fs.mkdirSync(path.join(inc, 'Subs'), { recursive: true });
    const film = path.join(inc, 'Nosferatu.1922.mkv'), sample = path.join(inc, 'sample.mkv'), subs = path.join(inc, 'Subs', 'English.srt'), art = path.join(inc, 'poster.jpg');
    fs.writeFileSync(film, 'v'.repeat(5000)); fs.writeFileSync(sample, 'v'.repeat(300)); fs.writeFileSync(subs, 's'.repeat(900)); fs.writeFileSync(art, 'i'.repeat(800));
    const job = { id: 'f1', kind: 'movie', title: 'Nosferatu', author: 'F. W. Murnau', year: '1922', format: '', how: 'qbit', owners: [] };
    await jobs.fileIt(job, [subs, art, sample, film], { copy: true, srcRoot: inc });
    const folder = path.join(settings.shelves.movieDir, 'Nosferatu (1922)');
    assert.ok(fs.statSync(folder).isDirectory(), 'the torrent is filed as a folder under the movies folder');
    assert.deepEqual(fs.readdirSync(folder).sort(), ['Nosferatu.1922.mkv', 'Subs', 'poster.jpg', 'sample.mkv'], 'every file kept, as it came');
    assert.equal(fs.readFileSync(path.join(folder, 'Subs', 'English.srt'), 'utf8').length, 900, 'subfolders too');
    assert.ok(!fs.existsSync(folder + '.incoming'), 'no temporary folder left behind');
    const item = jobs.listShelf({ role: 'admin' }).find(i => i.kind === 'movie');
    assert.equal(item.format, 'mkv', 'the format shown is the biggest file\'s');
    assert.equal(item.tracks, 4);
    assert.ok(item && jobs.fileFor(item) && jobs.fileFor(item).isDir, 'it is on the shelf and saves as a folder (a zip)');
    assert.equal(jobs.shelfBytes().movie, 7000);
    // The same torrent again, with "skip": nothing is replaced.
    await jobs.fileIt({ ...job, id: 'f2' }, [subs, art, sample, film], { copy: true, srcRoot: inc });
    assert.equal(jobs.listShelf({ role: 'admin' }).filter(i => i.kind === 'movie').length, 1, 'already on the shelf: skipped');
    // A game, the same way, in its own folder.
    const g = path.join(root, 'incoming', 'Beneath.a.Steel.Sky.GOG');
    fs.mkdirSync(g, { recursive: true });
    fs.writeFileSync(path.join(g, 'setup.exe'), 'x'.repeat(100)); fs.writeFileSync(path.join(g, 'data.bin'), 'x'.repeat(400));
    await jobs.fileIt({ id: 'g1', kind: 'game', title: 'Beneath a Steel Sky', author: '', year: '1994', format: '', how: 'qbit', owners: [] }, [path.join(g, 'setup.exe'), path.join(g, 'data.bin')], { copy: true, srcRoot: g });
    assert.deepEqual(fs.readdirSync(path.join(settings.shelves.gameDir, 'Beneath a Steel Sky (1994)')).sort(), ['data.bin', 'setup.exe'], 'a game keeps all its files');
    assert.equal(jobs.shelfBytes().game, 500);
    await jobs.deleteItems([item.id], { role: 'admin' });
    assert.ok(!fs.existsSync(folder), 'deleting it removes the film folder');
    console.log('filing a movie: ok');

    const { countDownload, statsFor } = await import('../src/config.js');
    countDownload({ kind: 'movie', format: 'mkv', bytes: 5000, author: 'F. W. Murnau' });
    const st = statsFor('all');
    assert.ok(st.movie >= 1 && st.bytes.movie >= 5000, 'movies are counted apart');
    console.log('movie stats: ok');
}

// ── The built-in movie scrapers' parsers, on answers shaped like the real ones ─
{
    const { pickVideo } = await import('../src/scrapers/archive-films.js');
    const files = [
        { name: 'nosferatu.avi', source: 'original', size: '900000000' },
        { name: 'nosferatu_512kb.mp4', source: 'derivative', size: '200000000', length: '5652.3' },
        { name: 'nosferatu.mp4', source: 'derivative', size: '600000000', length: '01:34:12' },
        { name: 'nosferatu_trailer.mp4', source: 'original', size: '990000000' },
        { name: 'nosferatu_meta.xml', source: 'metadata', size: '1000' },
        { name: 'nosferatu.ogv', source: 'derivative', size: '800000000' },
    ];
    assert.equal(pickVideo(files).name, 'nosferatu.mp4', 'Archive.org: the biggest MP4, never a trailer');
    assert.equal(pickVideo([{ name: 'a.ogv', size: '5' }, { name: 'b.avi', size: '9' }]).name, 'b.avi');
    assert.equal(pickVideo([{ name: 'x.xml' }]), null);

    const { commonsResult } = await import('../src/scrapers/commons-films.js');
    const strip = s => s.replace(/<[^>]+>/g, '').trim();
    const page = { pageid: 1, ns: 6, title: 'File:Nosferatu (1922).webm', index: 2, imageinfo: [{ size: 812345678, width: 640, height: 480, duration: 5640.2,
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Nosferatu_(1922).webm', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Nosferatu_(1922).webm',
        thumburl: 'https://upload.wikimedia.org/thumb.jpg', mime: 'video/webm',
        extmetadata: { Artist: { value: '<a href="x">F. W. Murnau</a>' }, DateTimeOriginal: { value: '1922-03-04' }, LicenseShortName: { value: 'Public domain' } } }] };
    const c = commonsResult(page, strip);
    assert.equal(c.title, 'Nosferatu (1922)');
    assert.equal(c.author, 'F. W. Murnau');
    assert.equal(c.year, '1922');
    assert.equal(c.format, 'webm');
    assert.equal(c.filesize, 812345678);
    assert.equal(c.directUrl, page.imageinfo[0].url);
    assert.equal(c.license, 'Public domain');
    assert.equal(commonsResult({ title: 'File:x.webm' }, strip), null, 'no file info, no result');

    const { pickLocVideo } = await import('../src/scrapers/loc-films.js');
    const resources = [{ files: [[
        { mimetype: 'image/jpeg', url: 'https://tile.loc.gov/x.jpg', size: 99999999 },
        { mimetype: 'video/mp4', url: 'https://tile.loc.gov/storage-services/x_small.mp4', size: 1000, height: 240 },
        { mimetype: 'video/mp4', url: 'https://tile.loc.gov/storage-services/x.mp4', size: 9000, height: 480, duration: 600 },
    ]] }, { files: [] }, {}];
    assert.equal(pickLocVideo(resources).url, 'https://tile.loc.gov/storage-services/x.mp4', 'Library of Congress: the biggest video file');
    assert.equal(pickLocVideo([{ files: [[{ mimetype: 'image/jpeg', url: 'https://tile.loc.gov/x.jpg' }]] }]), null);
    console.log('movie scraper parsers: ok');
}

fs.rmSync(root, { recursive: true, force: true });
console.log('All scraper tests passed.');
