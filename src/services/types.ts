export type Id = number;

export interface Track {
  id: Id;
  title: string;
  artist: string;
  artistId: Id | null;
  album: string;
  albumId: Id | null;
  albumArtist: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  genre?: string;
  durationMs: number;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  art?: string;
  hasLyrics: boolean;
  kind: "audio" | "video";
  favourite: boolean;
  playCount: number;
  lastPlayedAt?: number;
  addedAt: number;
  missing: boolean;
  rgTrack?: number;
  rgAlbum?: number;
  fileSize: number;
}

export interface Album {
  id: Id;
  title: string;
  artist: string;
  artistId: Id | null;
  year: number | null;
  genre: string | null;
  art: string | null;
  palette: string | null;
  trackCount: number;
  durationMs: number;
  addedAt: number;
  lastPlayedAt: number | null;
  playCount: number;
}

export interface Artist {
  id: Id;
  name: string;
  albumCount: number;
  trackCount: number;
  art: string | null;
}

export interface Genre {
  name: string;
  trackCount: number;
  albumCount: number;
}

export interface Overview {
  tracks: number;
  albums: number;
  artists: number;
  videos: number;
  folders: number;
  durationMs: number;
}

export interface AlbumDetail {
  album: Album;
  tracks: Track[];
  moreByArtist: Album[];
}

export interface ArtistDetail {
  id: Id;
  name: string;
  albums: Album[];
  appearsOn: Album[];
  topTracks: Track[];
  videos: Track[];
  trackCount: number;
  durationMs: number;
}

export interface Playlist {
  id: Id;
  name: string;
  description: string | null;
  trackCount: number;
  durationMs: number;
  updatedAt: number;
  arts: string[];
  rules: SmartPlaylistRules | null;
}

export type SmartPlaylistField = "genre" | "artist" | "album" | "year" | "plays" | "added" | "lastPlayed" | "favourite" | "codec" | "duration";
export type SmartPlaylistSort = "added_desc" | "plays_desc" | "last_played_desc" | "year_desc" | "title" | "artist" | "random";
export interface SmartPlaylistCondition { field: SmartPlaylistField; op: string; value: string | number | boolean | null }
export interface SmartPlaylistRules { match: "all" | "any"; conditions: SmartPlaylistCondition[]; sort: SmartPlaylistSort; limit: number | null }

export interface PlaylistDetail {
  playlist: Playlist;
  entries: { entryId: Id; track: Track }[];
}

export interface LookupCandidate {
  mbid: string;
  title: string;
  artist: string;
  date: string | null;
  country: string | null;
  label: string | null;
  trackCount: number | null;
  format: string | null;
  thumb: string | null;
}

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  videos: Track[];
  playlists: Playlist[];
  genres: string[];
}

export interface Home {
  recentlyAdded: Album[];
  recentlyPlayed: Album[];
  mostPlayed: Track[];
  forgotten: Album[];
  randomAlbums: Album[];
  genres: Genre[];
  videos: Track[];
}

export interface Folder {
  id: Id;
  path: string;
  addedAt: number;
  lastScanAt: number | null;
  available: boolean;
  trackCount: number;
}

export interface ScanProgress {
  phase: "walking" | "reading" | "finishing" | "done";
  done: number;
  total: number;
  added: number;
  updated: number;
  missing: number;
  errors: number;
}

export interface Lyrics {
  source: "lrc" | "txt" | "embedded";
  synced: boolean;
  text: string;
}

export interface ImportResult {
  copied: number;
  skipped: number;
  foldersAdded: number;
  rejected: number;
}

export type SmartList = "favourites" | "history" | "most-played" | "recently-added";

export interface AppError {
  code: string;
  message: string;
}
