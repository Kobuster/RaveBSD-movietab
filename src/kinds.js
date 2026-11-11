// Every kind of search RaveBSD knows, in one table. The server and the page both read it (the page imports this
// file as /js/kinds.js), so a new kind is one line here: search, filing, folders, naming, settings and stats
// all follow. Pure data and small helpers, no Node APIs.
//
// A search runs in a mode (the plural, as in /search/all?mode=movies); a downloaded file has a kind (the singular,
// stored in shelf.json). qbt is the qBittorrent search-plugin category that feeds the mode: qBittorrent plugins
// only ever offer all, anime, books, games, movies, music, pictures, software and tv.
//
// eBooks, audiobooks and movies keep the setting names they had before this table (ebookDir, audioDir, movieDir,
// ...), so saved settings carry over. Kinds added later use <kind>Dir and <kind>Template.
const FOLDER_TPL = '{title} ({year})/{title} ({year}).{ext}';
export const KIND_LIST = [
    { mode: 'ebooks', kind: 'ebook', label: 'eBooks', one: 'eBook', many: 'eBooks', folder: 'books', env: 'BOOKS_DIR', dirKey: 'ebookDir', tplKey: 'ebookTemplate',
        template: '{author}/{title} ({year}).{ext}', qbt: 'books', colour: '#FFD54A', formats: ['epub', 'pdf', 'mobi', 'azw3'] },
    { mode: 'audiobooks', kind: 'audiobook', label: 'Audiobooks', one: 'audiobook', many: 'audiobooks', folder: 'audiobooks', env: 'AUDIOBOOKS_DIR', dirKey: 'audioDir', tplKey: 'audioTemplate',
        template: '{author}/{title} ({year})/{track} - {title}.{ext}', qbt: 'books', colour: '#FF9FE8', formats: ['m4b', 'mp3', 'zip'] },
    { mode: 'movies', kind: 'movie', label: 'Movies', one: 'movie', many: 'movies', folder: 'movies', env: 'MOVIES_DIR', dirKey: 'movieDir', tplKey: 'movieTemplate',
        template: FOLDER_TPL, qbt: 'movies', colour: '#8FD0FF', formats: ['mp4', 'mkv', 'webm', 'avi'] },
    { mode: 'tv', kind: 'tv', label: 'TV', one: 'TV show', many: 'TV shows', folder: 'tv', env: 'TV_DIR', dirKey: 'tvDir', tplKey: 'tvTemplate',
        template: FOLDER_TPL, qbt: 'tv', colour: '#B7A4FF', formats: ['mkv', 'mp4', 'avi'] },
    { mode: 'anime', kind: 'anime', label: 'Anime', one: 'anime', many: 'anime', folder: 'anime', env: 'ANIME_DIR', dirKey: 'animeDir', tplKey: 'animeTemplate',
        template: FOLDER_TPL, qbt: 'anime', colour: '#FF8A65', formats: ['mkv', 'mp4'] },
    { mode: 'music', kind: 'music', label: 'Music', one: 'album', many: 'albums', folder: 'music', env: 'MUSIC_DIR', dirKey: 'musicDir', tplKey: 'musicTemplate',
        template: '{author}/{title} ({year})/{track} - {title}.{ext}', qbt: 'music', colour: '#5EEAB4', formats: ['flac', 'mp3', 'zip'] },
    { mode: 'games', kind: 'game', label: 'Games', one: 'game', many: 'games', folder: 'games', env: 'GAMES_DIR', dirKey: 'gameDir', tplKey: 'gameTemplate',
        template: FOLDER_TPL, qbt: 'games', colour: '#2EE6F6', formats: ['zip', 'iso', '7z', 'exe'] },
    { mode: 'software', kind: 'software', label: 'Software', one: 'program', many: 'programs', folder: 'software', env: 'SOFTWARE_DIR', dirKey: 'softwareDir', tplKey: 'softwareTemplate',
        template: FOLDER_TPL, qbt: 'software', colour: '#A8F0FF', formats: ['zip', 'iso', 'exe', 'deb'] },
    { mode: 'pictures', kind: 'picture', label: 'Pictures', one: 'picture set', many: 'picture sets', folder: 'pictures', env: 'PICTURES_DIR', dirKey: 'pictureDir', tplKey: 'pictureTemplate',
        template: FOLDER_TPL, qbt: 'pictures', colour: '#FFC070', formats: ['jpg', 'png', 'zip', 'pdf'] },
];
export const MODES = KIND_LIST.map(k => k.mode);
export const KINDS = KIND_LIST.map(k => k.kind);
const byMode = Object.fromEntries(KIND_LIST.map(k => [k.mode, k]));
const byKind = Object.fromEntries(KIND_LIST.map(k => [k.kind, k]));
export const kindInfo = kind => byKind[kind] || byKind.ebook;
export const modeInfo = mode => byMode[mode] || byMode.ebooks;
export const kindOf = mode => modeInfo(mode).kind;
export const modeOf = v => (byMode[v] ? v : 'ebooks');
// A search's mode from ?mode= or ?kind= (API callers use either; "audio" and "film" are older spellings).
export const modeFrom = (mode, kind = '') => (byMode[mode] ? mode : byKind[kind] ? byKind[kind].mode
    : /^audio/.test(kind) ? 'audiobooks' : /^(movie|film)/.test(kind) ? 'movies' : 'ebooks');
// The qBittorrent category a search in this mode asks plugins for.
export const qbtCategoryOf = mode => modeInfo(mode).qbt;
// The modes a qBittorrent plugin can answer, from the categories it lists ("books" feeds eBooks and audiobooks).
export const modesForCategories = cats => KIND_LIST.filter(k => (cats || []).includes(k.qbt)).map(k => k.mode);
