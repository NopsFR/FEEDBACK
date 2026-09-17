/** Durable phone metadata and pending edits. Audio downloads remain explicitly user-selected. */
import { getToken } from "./platform";
import type { Playlist, PlaylistDetail, Track } from "./types";

type Pending = { operationId: string; kind: "playlist" | "deletePlaylist" | "favourite"; id?: number; on?: boolean; base?: unknown; name?: string; description?: string | null; trackIds?: number[]; localId?: number };
type State = { lists: Record<number, PlaylistDetail>; tracks: Record<number, Track>; pending: Pending[]; aliases: Record<number, number>; next: number };
const empty = (): State => ({ lists: {}, tracks: {}, pending: [], aliases: {}, next: -1 });
let scope = "";
let state = empty();
let flushing = false;
let notice = "";
let retryTimer: ReturnType<typeof setTimeout> | undefined;
export function init() {
  const key = `feedback.phone.v1.${getToken()?.slice(-32) ?? "unpaired"}`;
  if (key === scope) return;
  scope = key;
  try { state = { ...empty(), ...JSON.parse(localStorage.getItem(key) || "null") }; }
  catch { state = empty(); }
}
function save() {
  // Browsing a large library must not fill the phone's metadata storage.
  const keep = new Set(Object.keys(state.tracks).slice(-300).map(Number));
  for (const edit of state.pending) {
    if (edit.kind === "favourite" && edit.id != null) keep.add(edit.id);
    for (const id of edit.trackIds ?? []) keep.add(id);
  }
  for (const list of Object.values(state.lists)) for (const entry of list.entries) keep.add(entry.track.id);
  const tracks = Object.fromEntries([...keep].flatMap((id) => state.tracks[id] ? [[id, state.tracks[id]]] : []));
  localStorage.setItem(scope, JSON.stringify({ ...state, tracks }));
}
function change(edit: () => void) {
  init();
  const before = structuredClone(state);
  try { edit(); } catch (e) { state = before; throw e; }
  try { save(); } catch { state = before; throw new Error("Your phone couldn't save the edit. Free some storage and try again."); }
  window.dispatchEvent(new Event("feedback:phone-change"));
}
const idOf = (id: number): number => state.aliases[id] != null && state.aliases[id] !== id ? idOf(state.aliases[id]) : id;
const baseOf = (d: PlaylistDetail) => ({ name: d.playlist.name, description: d.playlist.description, entries: d.entries.map((e) => [e.entryId, e.track.id]), rules: d.playlist.rules });
export function status() { init(); return { pending: state.pending.length, notice, syncing: flushing }; }
export function discardFirstEdit() {
  if (flushing) throw new Error("Wait for the current sync attempt to finish.");
  change(() => {
    const first = state.pending.shift();
    if (first?.localId != null) {
      state.pending = state.pending.filter((p) => p.localId !== first.localId);
      delete state.lists[first.localId];
    }
  });
  notice = "";
  void flush();
}
export function cacheTracks(tracks: Track[]) { init(); for (const t of tracks) state.tracks[t.id] = t; try { save(); } catch { /* Reading still works when storage is full. */ } }
export function overlay<T>(data: T): T {
  init();
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === "number" && "favourite" in obj && "durationMs" in obj) {
      const pending = [...state.pending].reverse().find((p) => p.kind === "favourite" && p.id === obj.id);
      const track = { ...obj, ...(pending ? { favourite: pending.on } : {}) } as unknown as Track;
      state.tracks[track.id] = track;
      return track;
    }
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, visit(value)]));
  };
  return visit(data) as T;
}
export function cachePlaylist(detail: PlaylistDetail): PlaylistDetail {
  init(); const id = idOf(detail.playlist.id);
  if (state.pending.some((p) => p.localId === id)) return state.lists[id] ?? detail;
  state.lists[id] = overlay(detail);
  try { save(); } catch { /* Cache only. */ }
  return state.lists[id];
}
export function localPlaylist(id: number): PlaylistDetail | undefined { init(); return state.lists[idOf(id)]; }
export function dirty(id: number) { init(); return state.pending.some((p) => p.localId === idOf(id)); }
export function playlists(online?: Playlist[]): Playlist[] {
  init();
  const map = new Map((online ?? Object.values(state.lists).map((d) => d.playlist)).map((p) => [p.id, p]));
  for (const p of state.pending) {
    if (p.localId == null) continue;
    if (p.kind === "deletePlaylist") map.delete(p.localId);
    else if (state.lists[p.localId]) map.set(p.localId, state.lists[p.localId].playlist);
  }
  return [...map.values()];
}
export function favourite(id: number, on: boolean) {
  change(() => { state.pending.push({ operationId: crypto.randomUUID(), kind: "favourite", id, on }); if (state.tracks[id]) state.tracks[id].favourite = on; });
  void flush();
}
export function favouriteTracks(): Track[] { init(); return overlay(Object.values(state.tracks)).filter((t) => t.favourite); }
function summary(d: PlaylistDetail) {
  d.playlist.trackCount = d.entries.length;
  d.playlist.durationMs = d.entries.reduce((n, e) => n + e.track.durationMs, 0);
  d.playlist.arts = [...new Set(d.entries.flatMap((e) => e.track.art ? [e.track.art] : []))].slice(0, 4);
  d.playlist.updatedAt = Date.now();
}
export function editPlaylist(id: number | null, edit: (d: PlaylistDetail) => void, remove = false): number {
  init(); let result = id == null ? state.next : idOf(id);
  change(() => {
    let d = id == null ? { playlist: { id: result, name: "", description: null, rules: null, trackCount: 0, durationMs: 0, arts: [], updatedAt: Date.now() }, entries: [] } as PlaylistDetail : state.lists[result];
    if (!d) throw new Error("Open this playlist while connected before editing it offline.");
    if (d.playlist.rules) throw new Error("Edit smart-playlist rules on the computer.");
    if (id == null) state.next--;
    const base = baseOf(d);
    d = structuredClone(d); edit(d); summary(d);
    state.lists[result] = d;
    state.pending.push({ operationId: crypto.randomUUID(), kind: remove ? "deletePlaylist" : "playlist", localId: result, id: result > 0 ? result : undefined, base: result > 0 ? base : undefined, name: d.playlist.name, description: d.playlist.description, trackIds: d.entries.map((e) => e.track.id) });
  });
  void flush(); return result;
}
export function append(d: PlaylistDetail, ids: number[]) {
  for (const id of ids) { const track = state.tracks[id]; if (!track) throw new Error("Open these tracks before adding them offline."); d.entries.push({ entryId: state.next--, track }); }
}
export async function flush() {
  init(); if (flushing || !getToken() || !state.pending.length) return;
  flushing = true;
  const originalScope = scope;
  try {
    while (state.pending.length && scope === originalScope) {
      const edit = state.pending[0];
      const response = await fetch("/api/edits", { method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(edit), signal: AbortSignal.timeout(5000) });
      if (scope !== originalScope) break;
      if (response.status === 401) { notice = "Pair this phone again to sync pending edits."; window.dispatchEvent(new Event("feedback:unpaired")); break; }
      if (!response.ok) { notice = (await response.json().catch(() => null))?.message ?? "Edits are saved on this phone and will retry when connected."; break; }
      const result = await response.json() as { detail?: PlaylistDetail; conflict?: boolean; omitted?: number };
      const before = structuredClone(state);
      state.pending.shift();
      if (edit.localId != null) {
        const oldId = edit.localId;
        if (result.detail) {
          const newId = result.detail.playlist.id;
          state.aliases[oldId] = newId;
          const later = state.pending.filter((p) => p.localId === oldId);
          for (const p of later) { p.localId = newId; p.id = newId; }
          if (later.length) later[0].base = baseOf(result.detail);
          const local = state.lists[oldId];
          delete state.lists[oldId];
          state.lists[newId] = later.length ? { ...local, playlist: { ...local.playlist, id: newId } } : result.detail;
          if (oldId !== newId) window.dispatchEvent(new CustomEvent("feedback:playlist-remap", { detail: { oldId, newId } }));
        } else delete state.lists[oldId];
      }
      try { save(); } catch (e) { state = before; throw e; }
      notice = result.conflict ? "Both versions were kept. Your edits are in a separate phone copy." : result.omitted ? "Synced. Tracks removed from the computer were skipped." : "";
      window.dispatchEvent(new Event("feedback:phone-change"));
    }
  } catch { notice = "Edits are saved on this phone and will retry when connected."; }
  finally {
    flushing = false;
    window.dispatchEvent(new Event("feedback:sync-status"));
    if (state.pending.length && getToken()) { clearTimeout(retryTimer); retryTimer = setTimeout(() => void flush(), 15000); }
  }
}
