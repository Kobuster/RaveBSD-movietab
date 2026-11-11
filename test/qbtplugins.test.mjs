// qBittorrent search plugins run as RaveBSD sources, and .torrent files. Run: node test/qbtplugins.test.mjs
// Needs python3. No network: fake plugins print fixed results.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rbsd-qbt-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.SCRAPERS_DIR = path.join(root, 'mine');
const QBT = path.join(process.env.SCRAPERS_DIR, 'qbt');
fs.mkdirSync(QBT, { recursive: true });
const plugin = (name, body) => fs.writeFileSync(path.join(QBT, name + '.py'), body);

const tf = await import('../src/torrentfile.js');
const { parseLine, parseRelease, runPy } = await import('../src/qbtplugins.js');
const { refreshScrapers, scrapersFor, listScrapers, scraperProblems, getScraper } = await import('../src/scrapers.js');

// A small .torrent, bencoded by hand.
const be = v => typeof v === 'number' ? `i${v}e` : typeof v === 'string' ? `${Buffer.byteLength(v)}:${v}` : Array.isArray(v) ? `l${v.map(be).join('')}e`
    : `d${Object.keys(v).sort().map(k => be(k) + be(v[k])).join('')}e`;
const info = { name: 'Night of the Living Dead (1968)', 'piece length': 16384, pieces: 'x'.repeat(20), files: [{ length: 700, path: ['film.mkv'] }, { length: 50, path: ['Subs', 'en.srt'] }], private: 1 };
const torrent = Buffer.from(be({ announce: 'https://tracker.example/announce/PASSKEY', 'announce-list': [['https://tracker.example/announce/PASSKEY'], ['udp://open.example:80']], info }), 'latin1');
const wantHash = crypto.createHash('sha1').update(Buffer.from(be(info), 'latin1')).digest('hex');

// ── .torrent files ───────────────────────────────────────────────────────────
{
    const t = tf.readTorrent(torrent);
    assert.equal(t.hash, wantHash, 'the info hash is the SHA-1 of the info dictionary as written');
    assert.equal(t.name, 'Night of the Living Dead (1968)');
    assert.deepEqual(t.trackers, ['https://tracker.example/announce/PASSKEY', 'udp://open.example:80']);
    assert.equal(t.files, 2); assert.equal(t.size, 750); assert.equal(t.private, true);
    const m = tf.magnetFor(t);
    assert.ok(m.startsWith('magnet:?xt=urn:btih:' + wantHash + '&dn='));
    assert.equal(tf.hexHash(m), wantHash);
    // Base32 hashes in magnets become hex.
    const b32 = 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U';
    assert.equal(tf.hexHash('magnet:?xt=urn:btih:' + b32), Buffer.from('abcdefghijklmnopqrst').toString('hex'));
    assert.equal(tf.hexHash('magnet:?xt=urn:btih:nothex'), '');
    for (const bad of [Buffer.from('<html>no</html>'.repeat(3)), Buffer.from('d4:spam3:egge'.repeat(3)), torrent.subarray(0, 60)]) assert.throws(() => tf.readTorrent(bad), /torrent/);
    const stored = await tf.storeTorrent(torrent);
    assert.equal(stored.hash, wantHash);
    assert.ok(tf.storedTorrent(wantHash).equals(torrent), 'kept under DATA/torrents');
    assert.equal(tf.storedTorrent('../../etc/passwd'), null);
    await tf.forgetTorrent(wantHash);
    assert.equal(tf.storedTorrent(wantHash), null);
    console.log('torrent files: ok');
}

// ── Result lines and release names ───────────────────────────────────────────
{
    const p = parseLine('magnet:?xt=urn:btih:' + 'a'.repeat(40) + '|Night%20of%20the%20Living%20Dead|734003200|12|3|https://ex.org|https://ex.org/t/1|1700000000');
    assert.equal(p.name, 'Night of the Living Dead'); assert.equal(p.size, 734003200); assert.equal(p.seeds, 12); assert.equal(p.desc, 'https://ex.org/t/1');
    assert.equal(parseLine('https://ex.org/a.torrent|x|-1|-1|-1|https://ex.org').seeds, -1, 'unknown counts stay -1');
    assert.equal(parseLine('Some debug print from a plugin'), null, 'other output is ignored');
    assert.equal(parseLine('javascript:alert(1)|x|1|1|1|e'), null, 'only magnets and web links');
    const cases = [
        ['Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', 'Night of the Living Dead', '1968'],
        ['The Thief of Bagdad (1924) [720p]', 'The Thief of Bagdad', '1924'],
        ['2001.A.Space.Odyssey.1968.REMASTERED.2160p', '2001 A Space Odyssey', '1968'],
        ['Big.Buck.Bunny.S01E02.WEB.h264', 'Big Buck Bunny', ''],
        ['Debian 12 netinst', 'Debian 12 netinst', ''],
        ['Dr. Strangelove', 'Dr. Strangelove', ''],
    ];
    for (const [name, title, year] of cases) assert.deepEqual(parseRelease(name), { title, year }, name);
    const { formatOf } = await import('../src/qbtplugins.js');
    assert.equal(formatOf('Some.Film.1999.1080p.x264.mkv', 'movies'), 'mkv');
    assert.equal(formatOf('Artist - Album (1977) [FLAC]', 'music'), 'flac');
    assert.equal(formatOf('Game.Name-GOG', 'games'), '', 'no format named: none guessed');
    console.log('result lines and release names: ok');
}

// ── Plugins: loading, categories, the general switch ─────────────────────────
const PY = String.raw;
plugin('fakefilms', PY`
from novaprinter import prettyPrinter
import urllib.parse
class fakefilms(object):
    url = 'https://films.example'
    name = 'Fake Films'
    supported_categories = {'all': '0', 'movies': '1', 'tv': '2'}
    def search(self, what, cat='all'):
        q = urllib.parse.unquote(what)
        print('debug: searching', q, cat)   # stray output: ignored
        prettyPrinter({'link': 'magnet:?xt=urn:btih:' + 'b' * 40, 'name': 'Nosferatu.1922.720p.' + cat, 'size': '1.5 GB', 'seeds': 7, 'leech': 1, 'engine_url': self.url, 'desc_link': 'https://films.example/1'})
        prettyPrinter({'link': 'https://films.example/dl/2.torrent', 'name': q + ' (1922) restored', 'size': 1000, 'seeds': 30, 'leech': 2, 'engine_url': self.url})
    def download_torrent(self, info):
        import tempfile, os
        fd, p = tempfile.mkstemp()
        with os.fdopen(fd, 'wb') as f:
            f.write(TORRENT)
        print(p + ' ' + info)
TORRENT = bytes.fromhex('${torrent.toString('hex')}')
`);
plugin('everything', PY`
from novaprinter import prettyPrinter
class everything(object):
    url = 'https://all.example'
    name = 'Everything Tracker'
    supported_categories = {'all': 'all'}
    def search(self, what, cat='all'):
        prettyPrinter({'link': 'magnet:?xt=urn:btih:' + 'c' * 40, 'name': 'general ' + cat, 'size': 5, 'seeds': 1, 'leech': 0, 'engine_url': self.url})
`);
plugin('nocats', PY`
from novaprinter import prettyPrinter
class nocats(object):
    url = 'https://n.example'
    name = 'No Categories'
    def search(self, what):
        prettyPrinter({'link': 'magnet:?xt=urn:btih:' + 'd' * 40, 'name': 'plain search', 'size': 5, 'seeds': 1, 'leech': 0, 'engine_url': self.url})
`);
plugin('slowpoke', PY`
import time
from novaprinter import prettyPrinter
class slowpoke(object):
    url = 'https://s.example'
    name = 'Slowpoke'
    supported_categories = {'games': 'g'}
    def search(self, what, cat='all'):
        prettyPrinter({'link': 'magnet:?xt=urn:btih:' + 'e' * 40, 'name': 'first one', 'size': 5, 'seeds': 1, 'leech': 0, 'engine_url': self.url})
        time.sleep(60)
`);
plugin('wrongname', 'class somethingelse(object):\n    name = "x"\n    url = "y"\n');
plugin('badcat', 'class badcat(object):\n    name = "Bad"\n    url = "y"\n    supported_categories = {"films": 1}\n');
plugin('syntaxerr', 'class syntaxerr(:\n');

{
    await refreshScrapers(true);
    const by = Object.fromEntries(listScrapers().filter(s => s.qbt).map(s => [s.id, s]));
    assert.deepEqual(Object.keys(by).sort(), ['qbteverything', 'qbtfakefilms', 'qbtnocats', 'qbtslowpoke']);
    assert.deepEqual(by.qbtfakefilms.kinds, ['movies', 'tv'], 'categories become tabs');
    assert.equal(by.qbtfakefilms.general, false);
    assert.equal(by.qbtslowpoke.kinds.join(), 'games');
    assert.equal(by.qbteverything.general, true, 'only "all": general search');
    assert.equal(by.qbtnocats.general, true, 'no categories: general search');
    assert.equal(by.qbteverything.kinds.length, 9, 'general plugins can answer every tab');
    const probs = Object.fromEntries(scraperProblems().map(p => [p.file, p.error]));
    assert.match(probs['qbt/wrongname.py'], /class named "wrongname"/);
    assert.match(probs['qbt/badcat.py'], /unknown categories: films/);
    assert.match(probs['qbt/syntaxerr.py'], /SyntaxError/);
    // The general switch.
    const ids = (mode, general) => scrapersFor(mode, { general }).filter(s => s.qbt).map(s => s.id).sort();
    assert.deepEqual(ids('movies', false), ['qbtfakefilms']);
    assert.deepEqual(ids('movies', true), ['qbteverything', 'qbtfakefilms', 'qbtnocats']);
    assert.deepEqual(ids('ebooks', false), [], 'no book plugins here');
    assert.deepEqual(ids('pictures', true), ['qbteverything', 'qbtnocats']);
    console.log('plugin loading: ok');
}

// ── Plugins: searching and .torrent links ────────────────────────────────────
{
    const sources = await import('../src/sources.js');
    const jobs = await import('../src/jobs.js');
    sources.setResultDecorator(jobs.decorateResult);
    const ctx = mode => ({ mode, log() {} });
    const s = getScraper('qbtfakefilms');
    const rs = await s.search('nosferatu', ctx('tv'));
    assert.equal(rs.length, 2);
    assert.equal(rs[0].seeds, 30, 'most seeded first');
    assert.equal(rs[0].title, 'nosferatu'); assert.equal(rs[0].year, '1922'); assert.equal(rs[0].release, 'nosferatu (1922) restored');
    assert.ok(rs[0].torrentToken && !rs[0].magnet && !JSON.stringify(rs[0]).includes('films.example/dl'), 'the .torrent address never goes to the page');
    assert.equal(rs[1].release, 'Nosferatu.1922.720p.tv', 'asked for the tab\'s category');
    assert.equal(rs[1].infoHash, 'b'.repeat(40)); assert.equal(rs[1].filesize, 1610612736); assert.equal(rs[1].pageUrl, 'https://films.example/1');
    // The general plugin is asked for "all".
    assert.equal((await getScraper('qbteverything').search('x', ctx('games')))[0].release, 'general all');
    assert.equal((await getScraper('qbtnocats').search('x', ctx('games')))[0].release, 'plain search');
    // Resolving the .torrent link: the plugin's download_torrent, the file kept, a magnet with the same hash.
    const r = { ...rs[0] };
    await s.resolve(r, ctx('tv'));
    assert.equal(r.infoHash, wantHash);
    assert.ok(r.magnet.startsWith('magnet:?xt=urn:btih:' + wantHash));
    assert.ok(tf.storedTorrent(wantHash), 'the .torrent waits for qBittorrent under DATA/torrents');
    // Through the search pipeline: a result with a .torrent link shows as a magnet (fetched only when used).
    const n = sources.normalizeScraped(s, rs);
    n.forEach(x => sources.registerResult(x, 'tv'));
    assert.equal(jobs.decorateResult(n[0]).linkType, 'magnet');
    assert.match(jobs.decorateResult(n[0]).fileAs, /^nosferatu \(1922\)\/$/, 'torrents are filed as a folder');
    console.log('plugin search and .torrent links: ok');
}

// ── A slow plugin is stopped, and what it printed still counts ───────────────
{
    const { TIMEOUT_MS } = await import('../src/qbtplugins.js');
    const t0 = Date.now();
    const r = await runPy(['search', path.join(QBT, 'slowpoke.py'), 'games', 'x'], 1500);
    assert.ok(r.timedOut && Date.now() - t0 < 5000, 'killed at the deadline');
    assert.match(r.out, /first%20one/, 'lines printed before the deadline are kept');
    assert.ok(TIMEOUT_MS < 30000, 'under the search deadline');
    console.log('slow plugins: ok');
}

// ── qBittorrent gets the .torrent file itself ─────────────────────────────────
{
    const http = await import('node:http');
    const got = [];
    const srv = http.createServer((req, res) => {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { got.push({ path: req.url, type: req.headers['content-type'] || '', body: Buffer.concat(chunks) }); res.end(req.url.endsWith('/add') ? 'Ok.' : ''); });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const { settings } = await import('../src/config.js');
    Object.assign(settings.qbit, { url: 'http://127.0.0.1:' + srv.address().port, category: 'ravebsd' });
    const qbit = await import('../src/qbit.js');
    await qbit.addTorrentFile(torrent, wantHash + '.torrent');
    const add = got.find(g => g.path === '/api/v2/torrents/add');
    assert.match(add.type, /^multipart\/form-data; boundary=/);
    assert.ok(add.body.includes(torrent), 'the file goes up as it is');
    assert.ok(add.body.includes('name="torrents"') && add.body.includes('name="category"') && add.body.includes('ravebsd'));
    srv.close();
    console.log('uploading .torrent files: ok');
}

// ── Real plugins, if their files are next to this test (info only, no network) ─
{
    const dir = process.env.QBT_PLUGINS || '';
    if (dir && fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.py'))) {
            const r = await runPy(['info', path.join(dir, f)], 15000);
            const info = JSON.parse(r.out.trim().split('\n').pop());
            assert.ok(info.name, f);
            console.log(`  ${f}: ${info.name}, ${info.categories ? info.categories.join(' ') : 'no categories'}${info.download ? ', own download_torrent' : ''}`);
        }
        console.log('real plugins: ok');
    }
}

fs.rmSync(root, { recursive: true, force: true });
console.log('All qBittorrent plugin tests passed.');
