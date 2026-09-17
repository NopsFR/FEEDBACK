import type { LibraryService } from "./library";
import { FeedbackError } from "./ipc";
import { getToken } from "./platform";
import type { Album, Lyrics, Track } from "./types";
import * as offline from "./offline";

/** PWA data access: talks to the paired desktop over HTTPS; falls back to what's stored on this device. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" } });
  } catch {
    offline.setReachable(false);
    throw new FeedbackError({ code: "offline", message: "Can't reach your computer. Showing what's saved on this phone." });
  }
  offline.setReachable(true);
  if (res.status === 401) {
    window.dispatchEvent(new Event("feedback:unpaired"));
    throw new FeedbackError({ code: "unpaired", message: "This phone isn't paired any more." });
  }
  if (!res.ok) throw new FeedbackError({ code: "http", message: "Your computer couldn't answer that." });
  return res.json() as Promise<T>;
}

const unsupported = (what: string) => async () => {
  throw new FeedbackError({ code: "unsupported", message: `${what} is done on the computer.` });
};

/** Try the desktop; if unreachable, answer from the offline snapshot. */
function withOffline<A extends unknown[], T>(online: (...a: A) => Promise<T>, fallback: (...a: A) => Promise<T>) {
  return async (...a: A): Promise<T> => {
    if (!offline.isReachable() && !navigator.onLine) return fallback(...a);
    try {
      return await online(...a);
    } catch (e) {
      if (e instanceof FeedbackError && e.code === "offline") return fallback(...a);
      throw e;
    }
  };
}

export const remoteLibrary: LibraryService = {
  overview: withOffline(() => api("/api/overview"), offline.overview),
  tracks: withOffline((kind = "audio") => api(`/api/tracks?kind=${kind}`), offline.tracks),
  tracksByIds: withOffline((ids) => api("/api/tracks/by-ids", { method: "POST", body: JSON.stringify(ids) }), offline.tracksByIds),
  albums: withOffline(() => api("/api/albums"), offline.albums),
  artists: withOffline(() => api("/api/artists"), offline.artists),
  genres: withOffline(() => api("/api/genres"), async () => []),
  album: withOffline((id) => api(`/api/album/${id}`), offline.album),
  artist: withOffline((id) => api(`/api/artist/${id}`), offline.artist),
  albumsBy: withOffline((f: { genre?: string; year?: number }) => api<Album[]>(`/api/albums/by?${f.genre ? `genre=${encodeURIComponent(f.genre)}` : `year=${f.year ?? ""}`}`), async () => [] as Album[]),
  search: withOffline((q) => api(`/api/search?q=${encodeURIComponent(q)}`), offline.search),
  home: withOffline(() => api("/api/home"), offline.home),
  smart: withOffline((which: string) => api<Track[]>(`/api/smart/${which}`), async () => [] as Track[]),
  folders: async () => [],
  addFolder: unsupported("Adding folders"),
  removeFolder: unsupported("Removing folders"),
  rescan: async () => {},
  cancelScan: async () => {},
  importPaths: unsupported("Importing"),
  setFavourite: async (id, on) => {
    await api(`/api/favourite/${id}`, { method: "POST", body: JSON.stringify({ on }) });
  },
  recordPlay: async (id, ms, skipped) => {
    await api(`/api/play/${id}`, { method: "POST", body: JSON.stringify({ ms, skipped }) }).catch(() => offline.queuePlay(id, ms, skipped));
  },
  playlists: withOffline(() => api("/api/playlists"), async () => []),
  playlist: withOffline((id) => api(`/api/playlist/${id}`), offline.playlist),
  createPlaylist: unsupported("Creating playlists"),
  createSmartPlaylist: unsupported("Creating smart playlists"),
  setPlaylistRules: unsupported("Editing smart playlists"),
  renamePlaylist: unsupported("Renaming playlists"),
  deletePlaylist: unsupported("Deleting playlists"),
  duplicatePlaylist: unsupported("Duplicating playlists"),
  addToPlaylist: unsupported("Editing playlists"),
  removeFromPlaylist: unsupported("Editing playlists"),
  reorderPlaylist: unsupported("Editing playlists"),
  settings: async () => {
    try {
      return JSON.parse(localStorage.getItem("feedback.pwa.settings") || "{}");
    } catch {
      return {};
    }
  },
  setSetting: async (key, value) => {
    try {
      const all = JSON.parse(localStorage.getItem("feedback.pwa.settings") || "{}");
      all[key] = value;
      localStorage.setItem("feedback.pwa.settings", JSON.stringify(all));
    } catch {
      /* ignore */
    }
  },
  trackPath: unsupported("Showing files"),
  lyrics: withOffline((id: number) => api<Lyrics | null>(`/api/lyrics/${id}`), async () => null as Lyrics | null),
  removeTracks: unsupported("Removing tracks"),
};

export async function pair(code: string, name: string): Promise<string> {
  const res = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) });
  if (!res.ok) throw new Error((await res.text()) || "Pairing failed.");
  const { token } = await res.json();
  return token as string;
}
