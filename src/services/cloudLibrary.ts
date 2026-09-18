/**
 * The library as your account sees it — what the phone uses away from home.
 *
 * Everything here comes from the cloud tables over HTTPS, so it works on 4G with the desktop off.
 * A track is playable only when your own upload backs it; anything else is metadata and says so.
 */
import type { LibraryService } from "./library";
import type { Album, AlbumDetail, Artist, ArtistDetail, Home, Overview, Playlist, PlaylistDetail, SearchResult, Track } from "./types";
import { currentSession, forgetSignedUrl, select, signedUrl, write } from "./supabase";
import { cloudUrls } from "./platform";

interface CloudTrack {
  id: string;
  title: string;
  artist_name: string;
  album_title: string;
  album_artist_name: string;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  genre: string | null;
  duration_ms: number;
  codec: string | null;
  upload_id: string | null;
  uploads?: { object_path: string } | { object_path: string }[] | null;
}

// Cloud ids are uuids; the app speaks in numbers. The map is stable for as long as the app is open
// and is rebuilt from the same list on reload, so queue state survives a refresh.
const numeric = new Map<string, number>();
const uuids = new Map<number, string>();
const objects = new Map<number, string>();
let nextId = 1;

function localId(uuid: string): number {
  const existing = numeric.get(uuid);
  if (existing) return existing;
  const id = nextId++;
  numeric.set(uuid, id);
  uuids.set(id, uuid);
  return id;
}

export function cloudUuid(id: number): string | undefined {
  return uuids.get(id);
}

function toTrack(row: CloudTrack, favourites: Set<string>): Track {
  const id = localId(row.id);
  const upload = Array.isArray(row.uploads) ? row.uploads[0] : row.uploads;
  if (upload?.object_path) objects.set(id, upload.object_path);
  return {
    id,
    title: row.title,
    artist: row.artist_name || "Unknown artist",
    artistId: null,
    album: row.album_title || "",
    albumId: null,
    albumArtist: row.album_artist_name || row.artist_name || "",
    trackNo: row.track_no ?? undefined,
    discNo: row.disc_no ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    durationMs: row.duration_ms ?? 0,
    codec: row.codec ?? undefined,
    hasLyrics: false,
    kind: "audio",
    favourite: favourites.has(row.id),
    playCount: 0,
    addedAt: 0,
    missing: !upload?.object_path,
    fileSize: 0,
  } as Track;
}

const TRACK_SELECT = "tracks?select=id,title,artist_name,album_title,album_artist_name,track_no,disc_no,year,genre,duration_ms,codec,upload_id,uploads(object_path)&order=album_artist_name,album_title,disc_no,track_no";

let favouriteIds = new Set<string>();
async function loadFavourites(): Promise<Set<string>> {
  try {
    const rows = await select<{ track_id: string }[]>("favourites?select=track_id");
    favouriteIds = new Set(rows.map((r) => r.track_id));
  } catch {
    /* keep what we had */
  }
  return favouriteIds;
}

let cache: Track[] | null = null;
async function allTracks(force = false): Promise<Track[]> {
  if (cache && !force) return cache;
  const favourites = await loadFavourites();
  const rows = await select<CloudTrack[]>(TRACK_SELECT);
  cache = rows.map((r) => toTrack(r, favourites));
  return cache;
}

/** Sign the URLs a view is about to need, so pressing play doesn't wait on a round trip. */
export async function primeUrls(tracks: Track[]): Promise<void> {
  const wanted = tracks.filter((t) => objects.has(t.id) && !cloudUrls.has(t.id)).slice(0, 40);
  await Promise.all(
    wanted.map(async (t) => {
      try {
        cloudUrls.set(t.id, await signedUrl(objects.get(t.id)!));
      } catch {
        /* leave it unplayable rather than guessing a URL */
      }
    }),
  );
}

/**
 * A signed link only lasts a couple of hours, and a phone can sit in a pocket for longer than that.
 * When playback fails, sign a new one rather than skipping the track: a stale link is not a
 * missing song. Returns false when this track has no cloud copy at all.
 */
export async function refreshCloudUrl(id: number): Promise<boolean> {
  const path = objects.get(id);
  if (!path) return false;
  forgetSignedUrl(path);
  cloudUrls.delete(id);
  try {
    cloudUrls.set(id, await signedUrl(path));
    return true;
  } catch {
    return false;
  }
}

/** True when your account holds the audio for this track. */
export function playableInCloud(id: number): boolean {
  return objects.has(id);
}

function albumsFrom(tracks: Track[]): Album[] {
  const map = new Map<string, Album & { _tracks: Track[] }>();
  for (const t of tracks) {
    const key = `${t.albumArtist}|${t.album}`.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing._tracks.push(t);
      existing.trackCount = existing._tracks.length;
      existing.durationMs += t.durationMs;
      continue;
    }
    map.set(key, {
      id: map.size + 1,
      title: t.album || "Unknown album",
      artist: t.albumArtist || t.artist,
      artistId: null,
      year: t.year ?? null,
      genre: t.genre ?? null,
      art: null,
      palette: null,
      trackCount: 1,
      durationMs: t.durationMs,
      addedAt: 0,
      lastPlayedAt: null,
      _tracks: [t],
    } as Album & { _tracks: Track[] });
  }
  return [...map.values()];
}

const unsupported = (what: string) => async () => {
  throw new Error(`${what} happens on the computer that holds your files.`);
};

export const cloudLibrary: LibraryService = {
  overview: async () => {
    const tracks = await allTracks();
    return {
      tracks: tracks.length,
      albums: albumsFrom(tracks).length,
      artists: new Set(tracks.map((t) => t.artist)).size,
      videos: 0,
      folders: 0,
      durationMs: tracks.reduce((a, t) => a + t.durationMs, 0),
      missing: 0,
    } as Overview;
  },
  tracks: async (kind = "audio") => (kind === "video" ? [] : allTracks().then(async (t) => (await primeUrls(t.slice(0, 40)), t))),
  tracksByIds: async (ids) => (await allTracks()).filter((t) => ids.includes(t.id)),
  albums: async () => albumsFrom(await allTracks()) as Album[],
  artists: async () => {
    const tracks = await allTracks();
    const map = new Map<string, Artist>();
    for (const t of tracks) {
      const existing = map.get(t.artist.toLowerCase());
      if (existing) {
        existing.trackCount += 1;
        continue;
      }
      map.set(t.artist.toLowerCase(), { id: map.size + 1, name: t.artist, art: null, albumCount: 0, trackCount: 1 } as Artist);
    }
    return [...map.values()];
  },
  genres: async () => [],
  album: async (id) => {
    const albums = albumsFrom(await allTracks()) as (Album & { _tracks: Track[] })[];
    const album = albums.find((a) => a.id === id) ?? albums[0];
    await primeUrls(album?._tracks ?? []);
    return { album, tracks: album?._tracks ?? [], appearsOn: [] } as unknown as AlbumDetail;
  },
  artist: async (id) => {
    const tracks = await allTracks();
    const artists = await cloudLibrary.artists();
    const artist = artists.find((a) => a.id === id) ?? artists[0];
    const mine = tracks.filter((t) => t.artist === artist?.name);
    await primeUrls(mine);
    return { id, name: artist?.name ?? "", albums: [], appearsOn: [], topTracks: mine.slice(0, 10), videos: [], trackCount: mine.length, durationMs: mine.reduce((a, t) => a + t.durationMs, 0) } as unknown as ArtistDetail;
  },
  albumsBy: async () => [],
  search: async (q) => {
    const term = q.trim().toLowerCase();
    const tracks = (await allTracks()).filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(term));
    await primeUrls(tracks.slice(0, 20));
    return { tracks, albums: [], artists: [], videos: [], playlists: [], genres: [] } as SearchResult;
  },
  home: async () => {
    const tracks = await allTracks();
    await primeUrls(tracks.slice(0, 20));
    return { recentlyAdded: [], recentlyPlayed: [], mostPlayed: tracks.slice(0, 10), forgotten: [], randomAlbums: [], genres: [], videos: [] } as unknown as Home;
  },
  smart: async (which) => {
    const tracks = await allTracks();
    return which === "favourites" ? tracks.filter((t) => t.favourite) : [];
  },
  radio: async () => [],
  folders: async () => [],
  addFolder: unsupported("Adding folders"),
  removeFolder: unsupported("Removing folders"),
  rescan: async () => {},
  cancelScan: async () => {},
  importPaths: unsupported("Importing"),
  setFavourite: async (id, on) => {
    const uuid = cloudUuid(id);
    if (!uuid) return;
    const session = currentSession();
    if (!session) return;
    if (on) await write("POST", "favourites?on_conflict=user_id,track_id", [{ user_id: session.userId, track_id: uuid }]);
    else await write("DELETE", `favourites?track_id=eq.${uuid}`, undefined, "return=minimal");
    favouriteIds[on ? "add" : "delete"](uuid);
    cache = cache?.map((t) => (t.id === id ? { ...t, favourite: on } : t)) ?? null;
  },
  recordPlay: async (id, ms, skipped) => {
    const uuid = cloudUuid(id);
    const session = currentSession();
    if (!uuid || !session) return;
    await write("POST", "play_history", [{ user_id: session.userId, track_id: uuid, ms_played: ms, skipped }], "return=minimal").catch(() => {});
  },
  playlists: async () => {
    const rows = await select<{ id: string; name: string; description: string | null; playlist_tracks: { track_id: string }[] }[]>("playlists?select=id,name,description,playlist_tracks(track_id)&order=updated_at.desc");
    return rows.map((r, i) => {
      numeric.set(`playlist:${r.id}`, i + 1);
      uuids.set(i + 1, `playlist:${r.id}`);
      return { id: i + 1, name: r.name, description: r.description, trackCount: r.playlist_tracks?.length ?? 0, durationMs: 0, updatedAt: 0, arts: [], rules: null } as Playlist;
    });
  },
  playlist: async (id) => {
    const uuid = (cloudUuid(id) ?? "").replace("playlist:", "");
    const rows = await select<{ id: string; name: string; description: string | null; playlist_tracks: { track_id: string; position: number }[] }[]>(`playlists?select=id,name,description,playlist_tracks(track_id,position)&id=eq.${uuid}`);
    const row = rows[0];
    const all = await allTracks();
    const entries = (row?.playlist_tracks ?? [])
      .sort((a, b) => a.position - b.position)
      .flatMap((e, index) => {
        const track = all.find((t) => cloudUuid(t.id) === e.track_id);
        return track ? [{ entryId: index + 1, track }] : [];
      });
    await primeUrls(entries.map((e) => e.track));
    return { playlist: { id, name: row?.name ?? "", description: row?.description ?? null, trackCount: entries.length, durationMs: entries.reduce((a, e) => a + e.track.durationMs, 0), updatedAt: 0, arts: [], rules: null }, entries } as PlaylistDetail;
  },
  createPlaylist: unsupported("Creating playlists"),
  createSmartPlaylist: unsupported("Smart playlists"),
  setPlaylistRules: unsupported("Smart playlists"),
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
    const all = JSON.parse(localStorage.getItem("feedback.pwa.settings") || "{}");
    all[key] = value;
    localStorage.setItem("feedback.pwa.settings", JSON.stringify(all));
  },
  lyrics: async () => null,
  trackPath: unsupported("Showing files"),
  removeTracks: unsupported("Removing tracks"),
};
