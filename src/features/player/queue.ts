import type { Track } from "@/services/types";

export type RepeatMode = "off" | "all" | "one";

export interface QueueItem {
  uid: string;
  track: Track;
  /** Where this item came from, for "Playing from …" */
  source?: string;
}

export interface QueueState {
  items: QueueItem[];
  index: number; // -1 = nothing loaded
  shuffle: boolean;
  repeat: RepeatMode;
  /** Pre-shuffle order (uids) so un-shuffling restores the original sequence. */
  unshuffled: string[] | null;
  source?: string;
}

let counter = 0;
export const uid = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyQueue = (): QueueState => ({ items: [], index: -1, shuffle: false, repeat: "off", unshuffled: null });

const toItems = (tracks: Track[], source?: string): QueueItem[] => tracks.map((track) => ({ uid: uid(), track, source }));

function shuffleArray<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function current(q: QueueState): QueueItem | null {
  return q.index >= 0 && q.index < q.items.length ? q.items[q.index] : null;
}

/** Replace the queue. With shuffle on, the chosen start track plays first and the rest are shuffled. */
export function setQueue(q: QueueState, tracks: Track[], start = 0, opts: { shuffle?: boolean; source?: string; rnd?: () => number } = {}): QueueState {
  const playable = tracks.filter((t) => !t.missing);
  if (!playable.length) return { ...q, items: [], index: -1, unshuffled: null };
  const startTrack = tracks[start] && !tracks[start].missing ? tracks[start] : playable[0];
  let items = toItems(playable, opts.source);
  const shuffle = opts.shuffle ?? q.shuffle;
  let index = Math.max(0, playable.indexOf(startTrack));
  let unshuffled: string[] | null = null;
  if (shuffle) {
    unshuffled = items.map((i) => i.uid);
    const first = items[index];
    const rest = shuffleArray(items.filter((_, i) => i !== index), opts.rnd ?? Math.random);
    items = [first, ...rest];
    index = 0;
  }
  return { ...q, items, index, shuffle, unshuffled, source: opts.source };
}

export function toggleShuffle(q: QueueState, rnd: () => number = Math.random): QueueState {
  if (!q.items.length) return { ...q, shuffle: !q.shuffle };
  if (!q.shuffle) {
    const cur = q.items.slice(0, q.index + 1);
    const upcoming = shuffleArray(q.items.slice(q.index + 1), rnd);
    return { ...q, shuffle: true, unshuffled: q.items.map((i) => i.uid), items: [...cur, ...upcoming] };
  }
  // restore original order for items still present; keep current item playing
  const cur = current(q);
  const order = q.unshuffled ?? q.items.map((i) => i.uid);
  const byUid = new Map(q.items.map((i) => [i.uid, i]));
  const restored = order.filter((u) => byUid.has(u)).map((u) => byUid.get(u)!);
  const extras = q.items.filter((i) => !order.includes(i.uid)); // added while shuffled
  const items = [...restored, ...extras];
  return { ...q, shuffle: false, unshuffled: null, items, index: cur ? items.findIndex((i) => i.uid === cur.uid) : -1 };
}

export function cycleRepeat(q: QueueState): QueueState {
  const next: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
  return { ...q, repeat: next[q.repeat] };
}

/** Index to move to on "next". `auto` = track ended naturally (repeat-one repeats). null = stop. */
export function nextIndex(q: QueueState, auto: boolean): number | null {
  if (!q.items.length) return null;
  if (auto && q.repeat === "one") return q.index;
  if (q.index + 1 < q.items.length) return q.index + 1;
  return q.repeat === "off" ? null : 0;
}

export function prevIndex(q: QueueState): number | null {
  if (!q.items.length) return null;
  if (q.index > 0) return q.index - 1;
  return q.repeat === "all" ? q.items.length - 1 : 0;
}

export function jump(q: QueueState, index: number): QueueState {
  return index >= 0 && index < q.items.length ? { ...q, index } : q;
}

export function playNext(q: QueueState, tracks: Track[], source?: string): QueueState {
  const add = toItems(tracks.filter((t) => !t.missing), source);
  if (q.index < 0) return { ...q, items: [...q.items, ...add], index: q.items.length ? q.index : -1 };
  const items = [...q.items.slice(0, q.index + 1), ...add, ...q.items.slice(q.index + 1)];
  return { ...q, items };
}

export function addToQueue(q: QueueState, tracks: Track[], source?: string): QueueState {
  return { ...q, items: [...q.items, ...toItems(tracks.filter((t) => !t.missing), source)] };
}

export function removeItems(q: QueueState, uids: string[]): { state: QueueState; removedCurrent: boolean } {
  const cur = current(q);
  const removedCurrent = !!cur && uids.includes(cur.uid);
  const items = q.items.filter((i) => !uids.includes(i.uid));
  let index: number;
  if (!items.length) index = -1;
  else if (removedCurrent) {
    // next surviving item after the old position
    const after = q.items.slice(q.index).find((i) => !uids.includes(i.uid));
    index = after ? items.indexOf(after) : Math.min(q.index, items.length - 1);
    if (!after && q.repeat === "off") index = items.length - 1;
  } else index = cur ? items.findIndex((i) => i.uid === cur.uid) : -1;
  return { state: { ...q, items, index }, removedCurrent };
}

export function move(q: QueueState, from: number, to: number): QueueState {
  if (from === to || from < 0 || to < 0 || from >= q.items.length || to >= q.items.length) return q;
  const cur = current(q);
  const items = [...q.items];
  const [m] = items.splice(from, 1);
  items.splice(to, 0, m);
  return { ...q, items, index: cur ? items.findIndex((i) => i.uid === cur.uid) : q.index };
}

export function clearUpcoming(q: QueueState): QueueState {
  if (q.index < 0) return emptyQueue();
  return { ...q, items: q.items.slice(0, q.index + 1), unshuffled: null };
}

export function upcoming(q: QueueState): QueueItem[] {
  return q.items.slice(q.index + 1);
}

export function history(q: QueueState): QueueItem[] {
  return q.items.slice(0, Math.max(0, q.index));
}
