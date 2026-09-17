import { call } from "./ipc";
import type {
  Album, AlbumDetail, Artist, ArtistDetail, Folder, Genre, Home, ImportResult, Lyrics, Overview, Playlist, PlaylistDetail, SearchResult, SmartList, Track,
} from "./types";

/** Data access contract. Desktop uses the Tauri backend; the PWA supplies an HTTP/IndexedDB implementation. */
export interface LibraryService {
  overview(): Promise<Overview>;
  tracks(kind?: "audio" | "video"): Promise<Track[]>;
  tracksByIds(ids: number[]): Promise<Track[]>;
  albums(): Promise<Album[]>;
  artists(): Promise<Artist[]>;
  genres(): Promise<Genre[]>;
  album(id: number): Promise<AlbumDetail>;
  artist(id: number): Promise<ArtistDetail>;
  albumsBy(filter: { genre?: string; year?: number }): Promise<Album[]>;
  search(q: string): Promise<SearchResult>;
  home(): Promise<Home>;
  smart(which: SmartList, limit?: number): Promise<Track[]>;
  folders(): Promise<Folder[]>;
  addFolder(path: string): Promise<number>;
  removeFolder(id: number): Promise<void>;
  rescan(): Promise<void>;
  cancelScan(): Promise<void>;
  importPaths(paths: string[]): Promise<ImportResult>;
  setFavourite(trackId: number, on: boolean): Promise<void>;
  recordPlay(trackId: number, msPlayed: number, skipped: boolean): Promise<void>;
  playlists(): Promise<Playlist[]>;
  playlist(id: number): Promise<PlaylistDetail>;
  createPlaylist(name: string, trackIds?: number[]): Promise<number>;
  renamePlaylist(id: number, name: string, description?: string | null): Promise<void>;
  deletePlaylist(id: number): Promise<void>;
  duplicatePlaylist(id: number): Promise<number>;
  addToPlaylist(id: number, trackIds: number[]): Promise<number>;
  removeFromPlaylist(id: number, entryIds: number[]): Promise<void>;
  reorderPlaylist(id: number, entryIds: number[]): Promise<void>;
  settings(): Promise<Record<string, unknown>>;
  setSetting(key: string, value: unknown): Promise<void>;
  trackPath(id: number): Promise<string>;
  lyrics(id: number): Promise<Lyrics | null>;
  removeTracks(ids: number[]): Promise<void>;
}

export const tauriLibrary: LibraryService = {
  overview: () => call("library_overview"),
  tracks: (kind = "audio") => call("library_tracks", { kind }),
  tracksByIds: (ids) => call("tracks_by_ids", { ids }),
  albums: () => call("library_albums"),
  artists: () => call("library_artists"),
  genres: () => call("library_genres"),
  album: (id) => call("album_detail", { id }),
  artist: (id) => call("artist_detail", { id }),
  albumsBy: ({ genre, year }) => call("albums_by", { genre: genre ?? null, year: year ?? null }),
  search: (q) => call("search", { q }),
  home: () => call("home"),
  smart: (which, limit) => call("smart_list", { which, limit: limit ?? null }),
  folders: () => call("list_folders"),
  addFolder: (path) => call("add_folder", { path }),
  removeFolder: (id) => call("remove_folder", { id }),
  rescan: () => call("rescan"),
  cancelScan: () => call("cancel_scan"),
  importPaths: (paths) => call("import_paths", { paths }),
  setFavourite: (trackId, on) => call("set_favourite", { trackId, on }),
  recordPlay: (trackId, msPlayed, skipped) => call("record_play", { trackId, msPlayed, skipped }),
  playlists: () => call("playlists"),
  playlist: (id) => call("playlist_detail", { id }),
  createPlaylist: (name, trackIds) => call("playlist_create", { name, trackIds: trackIds ?? null }),
  renamePlaylist: (id, name, description) => call("playlist_rename", { id, name, description: description ?? null }),
  deletePlaylist: (id) => call("playlist_delete", { id }),
  duplicatePlaylist: (id) => call("playlist_duplicate", { id }),
  addToPlaylist: (id, trackIds) => call("playlist_add", { id, trackIds }),
  removeFromPlaylist: (id, entryIds) => call("playlist_remove", { id, entryIds }),
  reorderPlaylist: (id, entryIds) => call("playlist_reorder", { id, entryIds }),
  settings: () => call("get_settings"),
  setSetting: (key, value) => call("set_setting", { key, value }),
  trackPath: (id) => call("track_file_path", { id }),
  lyrics: (id) => call("get_lyrics", { id }),
  removeTracks: (ids) => call("remove_tracks", { ids }),
};

export const library: LibraryService = tauriLibrary;
