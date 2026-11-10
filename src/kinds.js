// The three kinds of search and what each is called on the shelf. A search runs in a mode (the plural,
// as in /search/all?mode=movies); a downloaded file has a kind (the singular, stored in shelf.json).
export const MODES = ['ebooks', 'audiobooks', 'movies'];
export const KINDS = ['ebook', 'audiobook', 'movie'];
export const kindOf = mode => (mode === 'audiobooks' ? 'audiobook' : mode === 'movies' ? 'movie' : 'ebook');
export const modeOf = v => (MODES.includes(v) ? v : 'ebooks');
// Files a movie can come as. Torrents and archives also hold subtitles, samples and artwork.
export const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|ogv|avi|mov|mpe?g|wmv|ts)$/i;
