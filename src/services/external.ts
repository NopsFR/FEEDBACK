/**
 * Playing something a provider streams rather than something you own.
 *
 * The queue speaks in library ids, so a provider track borrows a negative one — no library row can
 * collide with it — and its URL is registered where `trackUrl` will find it. Nothing is written to
 * the database: close FEEDBACK and the borrowed track is gone, which is the honest state of a song
 * you have not actually got.
 */
import type { CatalogueTrack, Track } from "./types";
import { externalArt, externalUrls } from "./platform";
import { usePlayer } from "@/features/player/store";

let nextId = -1;
const borrowed = new Map<string, Track>();

/** The provider whose stream this row would play, if any. */
export function streamSource(track: CatalogueTrack) {
  return track.sources.find((s) => s.kind === "legalRemoteStream" && s.url) ?? null;
}

export function asTrack(row: CatalogueTrack): Track | null {
  const existing = borrowed.get(row.canonicalId);
  if (existing) return existing;
  const source = streamSource(row);
  if (!source?.url) return null;
  const id = nextId--;
  externalUrls.set(id, source.url);
  if (row.artwork.remote) externalArt.set(id, row.artwork.remote);
  const track: Track = {
    id,
    title: row.title,
    artist: row.artist,
    artistId: null,
    album: row.album ?? source.provider,
    albumId: null,
    albumArtist: row.artist,
    durationMs: row.durationMs ?? 0,
    hasLyrics: false,
    kind: "audio",
    favourite: false,
    playCount: 0,
    addedAt: Date.now(),
    missing: false,
    fileSize: 0,
  };
  borrowed.set(row.canonicalId, track);
  return track;
}

/** Play a catalogue row that a provider actually streams. Returns false when nothing can play it. */
export function playCatalogueTrack(row: CatalogueTrack): boolean {
  const track = asTrack(row);
  if (!track) return false;
  usePlayer.getState().playTracks([track], 0, { source: "search" });
  return true;
}
