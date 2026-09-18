/**
 * On-phone storage for the PWA. Albums/playlists the user saves are written to the Origin Private File System
 * (falls back to Cache Storage), with a small JSON catalog so the app can browse and play with no connection.
 * Nothing is saved automatically — the user picks what lives on the phone and sees the size first.
 */
import type { Album, AlbumDetail, ArtistDetail, Home, Overview, PlaylistDetail, SearchResult, Track, Artist } from "./types";
import { getToken, offlineArt, offlineUrls } from "./platform";
import { log } from "@/lib/log";
import * as phone from "./phone";

interface Catalog {
  version: 1;
  tracks: Record<string, Track>;
  albums: Record<string, Album>;
  savedAlbums: number[];
  savedPlaylists: { id: number; name: string; trackIds: number[] }[];
  pendingPlays: { id: number; ms: number; skipped: boolean; at: number }[];
  bytes: Record<string, number>;
}

const empty = (): Catalog => ({ version: 1, tracks: {}, albums: {}, savedAlbums: [], savedPlaylists: [], pendingPlays: [], bytes: {} });
let catalog: Catalog = empty();
let reachable = true;
const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((f) => f());

export const isReachable = () => reachable;
export function setReachable(v: boolean) {
  if (v !== reachable) {
    reachable = v;
    emit();
    if (v) void flushPlays();
  }
}

// ---------- capability detection ----------
export interface StorageInfo {
  secure: boolean;
  opfs: boolean;
  cacheApi: boolean;
  persisted: boolean;
  usage: number;
  quota: number;
}

export async function storageInfo(): Promise<StorageInfo> {
  const secure = window.isSecureContext;
  const opfs = secure && !!navigator.storage?.getDirectory;
  const cacheApi = secure && "caches" in window;
  let persisted = false;
  let usage = 0;
  let quota = 0;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch {
    /* not supported */
  }
  return { secure, opfs, cacheApi, persisted, usage, quota };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ---------- low-level store (OPFS, else Cache Storage) ----------
async function root(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return navigator.storage?.getDirectory ? await navigator.storage.getDirectory() : null;
  } catch {
    return null;
  }
}

async function writeBlob(name: string, blob: Blob): Promise<void> {
  const dir = await root();
  if (dir) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await (fh as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  const cache = await caches.open("feedback-offline");
  await cache.put(`/__offline/${name}`, new Response(blob));
}

async function readBlob(name: string): Promise<Blob | null> {
  const dir = await root();
  if (dir) {
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  }
  if (!("caches" in window)) return null;
  const hit = await (await caches.open("feedback-offline")).match(`/__offline/${name}`);
  return hit ? hit.blob() : null;
}

async function removeBlob(name: string) {
  const dir = await root();
  if (dir) {
    try {
      await dir.removeEntry(name);
    } catch {
      /* already gone */
    }
    return;
  }
  if ("caches" in window) await (await caches.open("feedback-offline")).delete(`/__offline/${name}`);
}

async function saveCatalog() {
  await writeBlob("catalog.json", new Blob([JSON.stringify(catalog)], { type: "application/json" }));
  emit();
}

export async function init() {
  try {
    const blob = await readBlob("catalog.json");
    if (blob) catalog = { ...empty(), ...JSON.parse(await blob.text()) };
  } catch (e) {
    log.warn("SYNC", "offline catalog unreadable", e);
  }
  for (const id of Object.keys(catalog.tracks)) {
    const b = await readBlob(`t-${id}`);
    if (b) offlineUrls.set(Number(id), URL.createObjectURL(b));
  }
  for (const a of Object.values(catalog.albums)) if (a.art) await loadArt(a.art);
  for (const t of Object.values(catalog.tracks)) if (t.art) await loadArt(t.art);
  emit();
}

async function loadArt(hash: string) {
  for (const size of [160, 480]) {
    const key = `${hash}/${size}`;
    if (offlineArt.has(key)) continue;
    const b = await readBlob(`a-${hash}-${size}`);
    if (b) offlineArt.set(key, URL.createObjectURL(b));
  }
}

// ---------- saving ----------
const authed = (url: string) => `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(getToken() ?? "")}`;

export function isSaved(trackId: number) {
  return !!catalog.tracks[trackId];
}
export function savedAlbumIds() {
  return catalog.savedAlbums;
}
export function savedPlaylists() {
  return catalog.savedPlaylists;
}
export function savedBytes() {
  return Object.values(catalog.bytes).reduce((a, b) => a + b, 0);
}

export async function saveTracks(tracks: Track[], onProgress?: (done: number, total: number) => void) {
  phone.cacheTracks(tracks);
  let done = 0;
  for (const t of tracks) {
    if (!catalog.tracks[t.id]) {
      const res = await fetch(authed(`/media/track/${t.id}?download=1`));
      if (!res.ok) throw new Error(`Couldn't download “${t.title}”.`);
      const blob = await res.blob();
      await writeBlob(`t-${t.id}`, blob);
      catalog.bytes[t.id] = blob.size;
      catalog.tracks[t.id] = t;
      offlineUrls.set(t.id, URL.createObjectURL(blob));
      if (t.art) {
        for (const size of [160, 480]) {
          if (offlineArt.has(`${t.art}/${size}`)) continue;
          const r = await fetch(authed(`/media/art/${t.art}/${size}`));
          if (r.ok) {
            const b = await r.blob();
            await writeBlob(`a-${t.art}-${size}`, b);
            offlineArt.set(`${t.art}/${size}`, URL.createObjectURL(b));
          }
        }
      }
      await saveCatalog();
    }
    onProgress?.(++done, tracks.length);
  }
}

export async function saveAlbum(d: AlbumDetail, onProgress?: (done: number, total: number) => void) {
  await saveTracks(d.tracks, onProgress);
  catalog.albums[d.album.id] = d.album;
  if (!catalog.savedAlbums.includes(d.album.id)) catalog.savedAlbums.push(d.album.id);
  await saveCatalog();
}

export async function savePlaylist(d: PlaylistDetail, onProgress?: (done: number, total: number) => void) {
  phone.cachePlaylist(d);
  const tracks = d.entries.map((e) => e.track);
  await saveTracks(tracks, onProgress);
  catalog.savedPlaylists = catalog.savedPlaylists.filter((p) => p.id !== d.playlist.id);
  catalog.savedPlaylists.push({ id: d.playlist.id, name: d.playlist.name, trackIds: tracks.map((t) => t.id) });
  await saveCatalog();
}

function referenced(): Set<number> {
  const keep = new Set<number>();
  for (const aid of catalog.savedAlbums) for (const t of Object.values(catalog.tracks)) if (t.albumId === aid) keep.add(t.id);
  for (const p of catalog.savedPlaylists) p.trackIds.forEach((id) => keep.add(id));
  return keep;
}

async function gc() {
  const keep = referenced();
  for (const id of Object.keys(catalog.tracks).map(Number)) {
    if (keep.has(id)) continue;
    await removeBlob(`t-${id}`);
    const u = offlineUrls.get(id);
    if (u) URL.revokeObjectURL(u);
    offlineUrls.delete(id);
    delete catalog.tracks[id];
    delete catalog.bytes[id];
  }
  await saveCatalog();
}

export async function removeAlbum(id: number) {
  catalog.savedAlbums = catalog.savedAlbums.filter((a) => a !== id);
  delete catalog.albums[id];
  await gc();
}

export async function removePlaylist(id: number) {
  catalog.savedPlaylists = catalog.savedPlaylists.filter((p) => p.id !== id);
  await gc();
}

export async function queuePlay(id: number, ms: number, skipped: boolean) {
  catalog.pendingPlays.push({ id, ms, skipped, at: Date.now() });
  await saveCatalog();
}

async function flushPlays() {
  if (!catalog.pendingPlays.length) return;
  const pending = catalog.pendingPlays;
  catalog.pendingPlays = [];
  for (const p of pending) {
    try {
      const response = await fetch(`/api/play/${p.id}`, { method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ ms: p.ms, skipped: p.skipped }) });
      if (!response.ok) throw new Error("Play not acknowledged");
    } catch {
      catalog.pendingPlays.push(p);
    }
  }
  await saveCatalog();
}

// ---------- read models from the catalog (used when the computer can't be reached) ----------
const trackList = () => Object.values(catalog.tracks).sort((a, b) => a.albumArtist.localeCompare(b.albumArtist) || a.album.localeCompare(b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0));

export async function overview(): Promise<Overview> {
  const t = trackList();
  return { tracks: t.length, albums: catalog.savedAlbums.length, artists: new Set(t.map((x) => x.artistId)).size, videos: 0, folders: 0, durationMs: t.reduce((a, x) => a + x.durationMs, 0), missing: 0 };
}
export async function tracks(): Promise<Track[]> {
  return trackList();
}
export async function tracksByIds(ids: number[]): Promise<Track[]> {
  return ids.map((id) => catalog.tracks[id]).filter(Boolean);
}
export async function albums(): Promise<Album[]> {
  return catalog.savedAlbums.map((id) => catalog.albums[id]).filter(Boolean);
}
export async function artists(): Promise<Artist[]> {
  const map = new Map<number, Artist>();
  for (const t of trackList()) {
    if (t.artistId == null) continue;
    const a = map.get(t.artistId) ?? { id: t.artistId, name: t.artist, albumCount: 0, trackCount: 0, art: t.art ?? null };
    a.trackCount++;
    map.set(t.artistId, a);
  }
  return [...map.values()];
}
export async function album(id: number): Promise<AlbumDetail> {
  const a = catalog.albums[id];
  if (!a) throw new Error("That album isn't saved on this phone.");
  return { album: a, tracks: trackList().filter((t) => t.albumId === id), moreByArtist: [] };
}
export async function artist(id: number): Promise<ArtistDetail> {
  const ts = trackList().filter((t) => t.artistId === id);
  if (!ts.length) throw new Error("Nothing by this artist is saved on this phone.");
  const albumsOf = catalog.savedAlbums.map((aid) => catalog.albums[aid]).filter((a) => a && a.artistId === id);
  return { id, name: ts[0].artist, albums: albumsOf, appearsOn: [], topTracks: ts.slice(0, 10), videos: [], trackCount: ts.length, durationMs: ts.reduce((s, t) => s + t.durationMs, 0) };
}
export async function playlist(id: number): Promise<PlaylistDetail> {
  const p = catalog.savedPlaylists.find((x) => x.id === id);
  if (!p) throw new Error("That playlist isn't saved on this phone.");
  const ts = p.trackIds.map((tid) => catalog.tracks[tid]).filter(Boolean);
  return { playlist: { id, name: p.name, description: null, trackCount: ts.length, durationMs: ts.reduce((s, t) => s + t.durationMs, 0), updatedAt: 0, arts: [], rules: null }, entries: ts.map((t, i) => ({ entryId: i + 1, track: t })) };
}
export async function search(q: string): Promise<SearchResult> {
  const needle = q.toLowerCase();
  const ts = trackList().filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle));
  const als = (await albums()).filter((a) => `${a.title} ${a.artist}`.toLowerCase().includes(needle));
  return { tracks: ts, albums: als, artists: [], videos: [], playlists: [], genres: [] };
}
export async function home(): Promise<Home> {
  return { recentlyAdded: await albums(), recentlyPlayed: [], mostPlayed: [], forgotten: [], randomAlbums: [], genres: [], videos: [] };
}
