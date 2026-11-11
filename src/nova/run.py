# Runs one qBittorrent search plugin for RaveBSD (src/qbtplugins.js). Not part of qBittorrent.
#
#   run.py info <plugin.py>                    -> one JSON line: name, url, categories, download
#   run.py search <plugin.py> <category> <q>   -> the plugin's result lines (link|name|size|seeds|leech|engine|desc|date)
#   run.py download <plugin.py> <url>          -> "<path> <url>": the .torrent the plugin saved
#
# novaprinter.py, helpers.py and socks.py next to this file are qBittorrent's own (github.com/qbittorrent/search-plugins,
# nova3), so plugins import them exactly as they do inside qBittorrent. What a plugin prints with prettyPrinter goes
# to stdout; its errors and log lines go to stderr.
import importlib.util
import json
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))


def load(file):
    file = os.path.abspath(file)
    name = os.path.splitext(os.path.basename(file))[0]
    # The plugin's own folder too, for plugins that ship a helper module next to them.
    for p in (os.path.dirname(file), HERE):
        if p not in sys.path:
            sys.path.insert(0, p)
    spec = importlib.util.spec_from_file_location(name, file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    # qBittorrent's rule: the class has the file's name.
    cls = getattr(mod, name, None)
    if cls is None:
        raise SystemExit(f'{os.path.basename(file)} has no class named "{name}" (qBittorrent needs the class named like the file)')
    return cls


def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: run.py info|search|download <plugin.py> ...')
    cmd, file = sys.argv[1], sys.argv[2]
    cls = load(file)
    if cmd == 'info':
        cats = getattr(cls, 'supported_categories', None)
        print(json.dumps({
            'name': str(getattr(cls, 'name', '') or ''),
            'url': str(getattr(cls, 'url', '') or ''),
            # None: the plugin lists no categories, so qBittorrent only ever runs it with search(what).
            'categories': None if cats is None else [str(c) for c in cats],
            'download': callable(getattr(cls, 'download_torrent', None)),
        }))
    elif cmd == 'search':
        cat, query = sys.argv[3], ' '.join(sys.argv[4:])
        engine = cls()
        # As nova2.py does it: the query URL-encoded, and only categories the plugin lists.
        what = urllib.parse.quote(query)
        cats = getattr(engine, 'supported_categories', None)
        if cats is None:
            engine.search(what)
        elif cat in cats:
            engine.search(what, cat)
    elif cmd == 'download':
        url = sys.argv[3]
        engine = cls()
        if callable(getattr(engine, 'download_torrent', None)):
            engine.download_torrent(url)
        else:
            import helpers
            print(helpers.download_file(url))
    else:
        raise SystemExit(f'unknown command {cmd}')


if __name__ == '__main__':
    main()
