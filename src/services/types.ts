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
  missing: number;
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

/** Identifiers that let FEEDBACK recognise the same recording across providers. */
export interface ExternalIds {
  recordingMbid?: string | null;
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
  artistMbid?: string | null;
  isrcs?: string[];
  other?: Record<string, string>;
}

/** What the player may offer for a row. Decided by the resolver in Rust, never guessed here. */
export type PlaybackType = "full" | "userCloud" | "preview" | "unavailable";

export type PlaybackKind = "localFile" | "legalRemoteStream" | "externalLink" | "unavailable";

export interface PlaybackSource {
  kind: PlaybackKind;
  provider: string;
  trackId: number | null;
  url: string | null;
  mime: string | null;
}

export interface ArtworkRef {
  hash: string | null;
  remote: string | null;
}

/** A track as the catalogue sees it. `sources` decides whether anything can play it. */
export interface CatalogueTrack {
  canonicalId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  trackNo?: number | null;
  discNo?: number | null;
  releaseDate: string | null;
  releaseKind: string | null;
  ids: ExternalIds;
  tags?: string[];
  artwork: ArtworkRef;
  sources: PlaybackSource[];
  metadataSources: string[];
  localTrackId: number | null;
  playbackType: PlaybackType;
}

export interface CatalogueRelease {
  canonicalId: string;
  title: string;
  artist: string;
  date: string | null;
  country: string | null;
  label: string | null;
  format: string | null;
  trackCount: number | null;
  ids: ExternalIds;
  artwork: ArtworkRef;
  localAlbumId: number | null;
  metadataSources: string[];
}

export interface CatalogueArtist {
  canonicalId: string;
  name: string;
  sortName: string | null;
  disambiguation: string | null;
  country: string | null;
  ids: ExternalIds;
  tags?: string[];
  localArtistId: number | null;
  metadataSources: string[];
}

export interface CatalogueSearchDebug {
  query: string;
  providers: { provider: string; results: number; ms: number; cache: string; error: string | null }[];
  incoming: number;
  unique: number;
  duplicatesRemoved: number;
  totalMs: number;
}

export interface CatalogueOutcome {
  tracks: CatalogueTrack[];
  releases: CatalogueRelease[];
  artists: CatalogueArtist[];
  remoteAnswered: boolean;
  debug: CatalogueSearchDebug;
}

export interface ProviderStatus {
  provider: string;
  state: "healthy" | "degraded" | "rateLimited" | "offline" | "disabled";
  requests: number;
  errors: number;
  lastError: string | null;
  lastSuccessMsAgo: number | null;
  averageLatencyMs: number;
  waitingFor: number | null;
}

export interface CatalogueHealth {
  providers: ProviderStatus[];
  cache: { hits: number; misses: number; staleServed: number; rows: number; schema: number };
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
  /** "lrc" | "txt" | "embedded" for your own files, or a provider id such as "lrclib". */
  source: string;
  synced: boolean;
  text: string;
  /** The recording has no words — different from having none on file. */
  instrumental?: boolean;
}

export interface ImportResult {
  copied: number;
  skipped: number;
  foldersAdded: number;
  rejected: number;
}

export type SmartList = "favourites" | "history" | "most-played" | "recently-added" | "missing";

export interface AppError {
  code: string;
  message: string;
}
