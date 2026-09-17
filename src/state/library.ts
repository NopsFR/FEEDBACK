import { create } from "zustand";
import { library } from "@/services/library";
import type { Album, Artist, Overview, Playlist, ScanProgress, Track } from "@/services/types";

/**
 * Cached collections. `version` bumps whenever the backend reports a change; views refetch on version change.
 * Large lists (tracks) are fetched once and virtualised in the UI.
 */
interface LibraryState {
  version: number;
  overview: Overview | null;
  tracks: Track[] | null;
  albums: Album[] | null;
  artists: Artist[] | null;
  playlists: Playlist[];
  favourites: Set<number>;
  favouriteOverrides: Record<number, boolean>;
  scan: ScanProgress | null;
  invalidate: () => void;
  loadOverview: () => Promise<void>;
  loadTracks: () => Promise<Track[]>;
  loadAlbums: () => Promise<Album[]>;
  loadArtists: () => Promise<Artist[]>;
  loadPlaylists: () => Promise<void>;
  setScan: (p: ScanProgress | null) => void;
  setFavourite: (id: number, on: boolean) => void;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  version: 0,
  overview: null,
  tracks: null,
  albums: null,
  artists: null,
  playlists: [],
  favourites: new Set(),
  favouriteOverrides: {},
  scan: null,
  invalidate: () => {
    set({ version: get().version + 1, tracks: null, albums: null, artists: null });
    void get().loadOverview();
    void get().loadPlaylists();
  },
  loadOverview: async () => set({ overview: await library.overview() }),
  loadTracks: async () => {
    const cached = get().tracks;
    if (cached) return cached;
    const tracks = await library.tracks("audio");
    set({ tracks, favourites: new Set(tracks.filter((t) => t.favourite).map((t) => t.id)) });
    return tracks;
  },
  loadAlbums: async () => {
    const cached = get().albums;
    if (cached) return cached;
    const albums = await library.albums();
    set({ albums });
    return albums;
  },
  loadArtists: async () => {
    const cached = get().artists;
    if (cached) return cached;
    const artists = await library.artists();
    set({ artists });
    return artists;
  },
  loadPlaylists: async () => set({ playlists: await library.playlists() }),
  setScan: (p) => set({ scan: p }),
  setFavourite: (id, on) => {
    const f = new Set(get().favourites);
    if (on) f.add(id);
    else f.delete(id);
    set({ favourites: f, favouriteOverrides: { ...get().favouriteOverrides, [id]: on } });
  },
}));

export function isFavourite(t: Track): boolean {
  const favs = useLibrary.getState().favourites;
  return favs.size ? favs.has(t.id) : t.favourite;
}
