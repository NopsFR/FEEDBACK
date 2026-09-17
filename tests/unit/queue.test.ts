import { describe, expect, it } from "vitest";
import * as Q from "@/features/player/queue";
import type { Track } from "@/services/types";

const t = (id: number, extra: Partial<Track> = {}): Track => ({
  id, title: `T${id}`, artist: "A", artistId: 1, album: "B", albumId: 1, albumArtist: "A", durationMs: 1000, hasLyrics: false, kind: "audio",
  favourite: false, playCount: 0, addedAt: 0, missing: false, fileSize: 1, ...extra,
});
const tracks = [1, 2, 3, 4, 5].map((i) => t(i));
const ids = (q: Q.QueueState) => q.items.map((i) => i.track.id);
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("queue", () => {
  it("sets a queue at a start index", () => {
    const q = Q.setQueue(Q.emptyQueue(), tracks, 2);
    expect(Q.current(q)?.track.id).toBe(3);
    expect(ids(q)).toEqual([1, 2, 3, 4, 5]);
  });

  it("skips missing files", () => {
    const q = Q.setQueue(Q.emptyQueue(), [t(1, { missing: true }), t(2), t(3)], 0);
    expect(ids(q)).toEqual([2, 3]);
    expect(Q.current(q)?.track.id).toBe(2);
  });

  it("shuffle keeps the chosen track first and restores order", () => {
    const q = Q.setQueue(Q.emptyQueue(), tracks, 3, { shuffle: true, rnd });
    expect(Q.current(q)?.track.id).toBe(4);
    expect(q.index).toBe(0);
    expect(new Set(ids(q))).toEqual(new Set([1, 2, 3, 4, 5]));
    const un = Q.toggleShuffle(q);
    expect(ids(un)).toEqual([1, 2, 3, 4, 5]);
    expect(Q.current(un)?.track.id).toBe(4);
  });

  it("toggling shuffle mid-queue only shuffles upcoming", () => {
    let q = Q.setQueue(Q.emptyQueue(), tracks, 1);
    q = Q.toggleShuffle(q, rnd);
    expect(ids(q).slice(0, 2)).toEqual([1, 2]);
    expect(Q.current(q)?.track.id).toBe(2);
  });

  it("next/prev respect repeat", () => {
    let q = Q.setQueue(Q.emptyQueue(), tracks, 4);
    expect(Q.nextIndex(q, true)).toBeNull();
    q = { ...q, repeat: "all" };
    expect(Q.nextIndex(q, true)).toBe(0);
    q = { ...q, repeat: "one" };
    expect(Q.nextIndex(q, true)).toBe(4);
    expect(Q.nextIndex(q, false)).toBe(0);
    q = Q.jump({ ...q, repeat: "off" }, 0);
    expect(Q.prevIndex(q)).toBe(0);
  });

  it("play next inserts after current; add appends", () => {
    let q = Q.setQueue(Q.emptyQueue(), tracks, 1);
    q = Q.playNext(q, [t(9)]);
    expect(ids(q)).toEqual([1, 2, 9, 3, 4, 5]);
    q = Q.addToQueue(q, [t(10)]);
    expect(ids(q).at(-1)).toBe(10);
  });

  it("removing the current item moves to the next survivor", () => {
    const q = Q.setQueue(Q.emptyQueue(), tracks, 2);
    const { state, removedCurrent } = Q.removeItems(q, [q.items[2].uid, q.items[3].uid]);
    expect(removedCurrent).toBe(true);
    expect(Q.current(state)?.track.id).toBe(5);
  });

  it("move keeps the current item selected", () => {
    let q = Q.setQueue(Q.emptyQueue(), tracks, 1);
    q = Q.move(q, 4, 0);
    expect(ids(q)).toEqual([5, 1, 2, 3, 4]);
    expect(Q.current(q)?.track.id).toBe(2);
  });

  it("clearUpcoming keeps history and current", () => {
    const q = Q.clearUpcoming(Q.setQueue(Q.emptyQueue(), tracks, 2));
    expect(ids(q)).toEqual([1, 2, 3]);
  });
});
