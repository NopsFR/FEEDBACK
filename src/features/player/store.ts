import { create } from "zustand";
import { AudioEngine } from "./engine";
import * as Q from "./queue";
import type { QueueState, RepeatMode } from "./queue";
import type { Track } from "@/services/types";
import { artUrl, trackUrl } from "@/services/platform";
import { library } from "@/services/library";
import { useSettings } from "@/state/settings";
import { toast } from "@/state/ui";
import { log } from "@/lib/log";

/** Position is kept outside React state (updated ~5x/s) — components subscribe via usePosition(). */
type PosListener = (pos: number, dur: number) => void;
const posListeners = new Set<PosListener>();
let lastPos = 0;
let lastDur = 0;
export function subscribePosition(fn: PosListener) {
  posListeners.add(fn);
  fn(lastPos, lastDur);
  return () => {
    posListeners.delete(fn);
  };
}
export const getPosition = () => ({ pos: lastPos, dur: lastDur });
let engineRef: AudioEngine | null = null;

interface PlayerState {
  queue: QueueState;
  current: Track | null;
  playing: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
  sleepAt: number | null; // epoch ms, or -1 = end of track
  restored: boolean;

  playTracks: (tracks: Track[], start?: number, opts?: { shuffle?: boolean; source?: string }) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  jumpTo: (index: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setRepeat: (r: RepeatMode) => void;
  playNext: (tracks: Track[]) => void;
  addToQueue: (tracks: Track[]) => void;
  removeFromQueue: (uids: string[]) => void;
  moveInQueue: (from: number, to: number) => void;
  clearUpcoming: () => void;
  patchTrack: (id: number, patch: Partial<Track>) => void;
  setSleep: (minutes: number | "track" | null) => void;
  restore: () => Promise<void>;
}

// ---- listening stats: count a play at 50% or 4 minutes; count a skip under 30% ----
let listenedMs = 0;
let lastTick = 0;
let counted = false;

function gainFor(t: Track): number {
  const mode = useSettings.getState().replayGain;
  if (mode === "off") return 0;
  const g = mode === "album" ? t.rgAlbum ?? t.rgTrack : t.rgTrack ?? t.rgAlbum;
  if (g == null) return 0;
  return Math.max(-18, Math.min(6, g));
}

export const usePlayer = create<PlayerState>((set, get) => {
  const engine = new AudioEngine({
    onTime: (pos, dur) => {
      const now = performance.now();
      if (get().playing && lastTick) listenedMs += Math.min(1000, now - lastTick);
      lastTick = now;
      lastPos = pos;
      lastDur = dur;
      posListeners.forEach((fn) => fn(pos, dur));
      const cur = get().current;
      if (cur && !counted && dur > 0 && (listenedMs >= Math.min(dur * 0.5, 240000))) {
        counted = true;
        library.recordPlay(cur.id, Math.round(listenedMs), false).catch(() => {});
      }
    },
    onPlayState: (playing) => {
      lastTick = performance.now();
      set({ playing });
      updateMediaSessionState(playing);
    },
    onBuffering: (buffering) => set({ buffering }),
    onEnded: () => advance(true),
    onAdvanced: () => {
      // engine already swapped decks to the preloaded next track
      const q = get().queue;
      const idx = Q.nextIndex(q, true);
      if (idx == null) return;
      const nq = Q.jump(q, idx);
      beginTrack(nq, false);
    },
    onError: (message) => {
      const cur = get().current;
      set({ error: message, buffering: false, playing: false });
      toast(cur ? `Skipped “${cur.title}” — ${message.toLowerCase()}` : message, "error");
      // avoid infinite skip loops on a queue of broken files
      errorStreak++;
      if (errorStreak < 5) advance(true);
      else get().pause();
    },
  });
  let errorStreak = 0;
  engineRef = engine;

  const s = useSettings.getState();
  engine.setCrossfade(s.gapless ? s.crossfadeSec : 0);
  engine.setEq(s.eqEnabled, s.eqBands);
  useSettings.subscribe((st) => {
    engine.setCrossfade(st.crossfadeSec);
    engine.setEq(st.eqEnabled, st.eqBands);
    prepareUpcoming();
  });

  function prepareUpcoming() {
    const { queue, current } = get();
    const settings = useSettings.getState();
    if (!current || (!settings.gapless && settings.crossfadeSec === 0)) {
      engine.prepareNext(null);
      return;
    }
    const idx = Q.nextIndex(queue, true);
    if (idx == null || idx === queue.index) {
      engine.prepareNext(null);
      return;
    }
    const t = queue.items[idx].track;
    engine.prepareNext(trackUrl(t.id), gainFor(t));
  }

  function finishStats(skipped: boolean) {
    const cur = get().current;
    if (cur && !counted && skipped && lastDur > 0 && listenedMs < lastDur * 0.3 && listenedMs > 1500) {
      library.recordPlay(cur.id, Math.round(listenedMs), true).catch(() => {});
    }
    listenedMs = 0;
    counted = false;
    lastTick = performance.now();
  }

  /** Set queue state + current track bookkeeping. If `load`, also loads into the engine. */
  function beginTrack(queue: QueueState, load: boolean, autoplay = true, startMs = 0) {
    const item = Q.current(queue);
    finishStats(false);
    set({ queue, current: item?.track ?? null, error: null });
    if (!item) {
      engine.stop();
      set({ playing: false });
      lastPos = 0;
      lastDur = 0;
      posListeners.forEach((fn) => fn(0, 0));
      updateMediaSession(null);
      return;
    }
    if (load) engine.load(trackUrl(item.track.id), gainFor(item.track), startMs, autoplay);
    updateMediaSession(item.track);
    prepareUpcoming();
    persistSoon();
    const sleep = get().sleepAt;
    if (sleep === -1 && !load) {
      // "end of track" sleep: we advanced naturally, so stop now.
      engine.pause();
      set({ sleepAt: null });
    }
  }

  function advance(auto: boolean) {
    const q = get().queue;
    if (auto && get().sleepAt === -1) {
      engine.pause();
      set({ sleepAt: null });
      return;
    }
    const idx = Q.nextIndex(q, auto);
    if (idx == null) {
      // end of queue: stop at the start of the last track
      finishStats(false);
      engine.pause();
      engine.seek(0);
      set({ playing: false });
      return;
    }
    if (auto && idx === q.index) {
      engine.seek(0);
      engine.play();
      finishStats(false);
      return;
    }
    if (!auto) finishStats(true);
    beginTrack(Q.jump(q, idx), true);
  }

  // ---- media session (OS media keys, lock screen, SMTC) ----
  function updateMediaSession(t: Track | null) {
    if (!("mediaSession" in navigator)) return;
    if (!t) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const art = artUrl(t.art, 480);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: art ? [{ src: art, sizes: "480x480", type: "image/jpeg" }] : [],
    });
  }
  function updateMediaSessionState(playing: boolean) {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const h = (a: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {
        /* unsupported action */
      }
    };
    h("play", () => get().play());
    h("pause", () => get().pause());
    h("nexttrack", () => get().next());
    h("previoustrack", () => get().prev());
    h("seekto", (d) => d.seekTime != null && get().seek(d.seekTime * 1000));
    h("seekbackward", (d) => get().seek(lastPos - (d.seekOffset ?? 10) * 1000));
    h("seekforward", (d) => get().seek(lastPos + (d.seekOffset ?? 10) * 1000));
  }

  // ---- persistence ----
  let persistTimer = 0;
  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persistNow, 1500);
  }
  function persistNow() {
    const { queue, volume, muted } = get();
    const snapshot = {
      ids: queue.items.map((i) => i.track.id),
      index: queue.index,
      shuffle: queue.shuffle,
      repeat: queue.repeat,
      positionMs: Math.round(lastPos),
      volume,
      muted,
      source: queue.source ?? null,
    };
    library.setSetting("player.state", snapshot).catch(() => {});
  }
  window.addEventListener("beforeunload", persistNow);
  setInterval(() => get().playing && persistNow(), 15000);

  // sleep timer
  setInterval(() => {
    const at = get().sleepAt;
    if (at && at > 0 && Date.now() >= at) {
      set({ sleepAt: null });
      engine.fadeOutAndPause(8);
      toast("Sleep timer — faded out.");
    }
  }, 1000);

  return {
    queue: Q.emptyQueue(),
    current: null,
    playing: false,
    buffering: false,
    volume: 0.8,
    muted: false,
    error: null,
    sleepAt: null,
    restored: false,

    playTracks: (tracks, start = 0, opts = {}) => {
      errorStreak = 0;
      finishStats(true);
      const q = Q.setQueue(get().queue, tracks, start, opts);
      beginTrack(q, true);
    },
    toggle: () => (get().playing ? get().pause() : get().play()),
    play: () => {
      errorStreak = 0;
      const { current, queue } = get();
      if (!current) {
        if (queue.items.length) beginTrack(Q.jump(queue, Math.max(0, queue.index)), true);
        return;
      }
      if (!engine.durationMs && !engine.playing) {
        // restored but not yet loaded
        engine.load(trackUrl(current.id), gainFor(current), lastPos, true);
        prepareUpcoming();
        return;
      }
      engine.play();
    },
    pause: () => {
      engine.pause();
      persistNow();
    },
    next: () => {
      errorStreak = 0;
      advance(false);
    },
    prev: () => {
      errorStreak = 0;
      if (lastPos > 3000) {
        engine.seek(0);
        return;
      }
      const q = get().queue;
      const idx = Q.prevIndex(q);
      if (idx == null) return;
      finishStats(true);
      beginTrack(Q.jump(q, idx), true);
    },
    seek: (ms) => {
      if (!engine.durationMs && get().current) {
        lastPos = ms;
        posListeners.forEach((fn) => fn(ms, lastDur));
        return;
      }
      engine.seek(ms);
    },
    jumpTo: (index) => {
      errorStreak = 0;
      finishStats(true);
      beginTrack(Q.jump(get().queue, index), true);
    },
    setVolume: (v) => {
      engine.setVolume(v);
      set({ volume: v, muted: v === 0 ? get().muted : false });
      if (v > 0) engine.setMuted(false);
      persistSoon();
    },
    toggleMute: () => {
      const muted = !get().muted;
      engine.setMuted(muted);
      set({ muted });
      persistSoon();
    },
    toggleShuffle: () => {
      set({ queue: Q.toggleShuffle(get().queue) });
      prepareUpcoming();
      persistSoon();
    },
    cycleRepeat: () => {
      set({ queue: Q.cycleRepeat(get().queue) });
      prepareUpcoming();
      persistSoon();
    },
    setRepeat: (r) => {
      set({ queue: { ...get().queue, repeat: r } });
      prepareUpcoming();
    },
    playNext: (tracks) => {
      const had = get().queue.items.length > 0;
      const q = Q.playNext(get().queue, tracks);
      if (!had) beginTrack(Q.jump(q, 0), true);
      else {
        set({ queue: q });
        prepareUpcoming();
        persistSoon();
      }
      toast(tracks.length === 1 ? `“${tracks[0].title}” plays next` : `${tracks.length} tracks play next`);
    },
    addToQueue: (tracks) => {
      const had = get().queue.items.length > 0;
      const q = Q.addToQueue(get().queue, tracks);
      if (!had) beginTrack(Q.jump(q, 0), true);
      else {
        set({ queue: q });
        prepareUpcoming();
        persistSoon();
      }
      toast(tracks.length === 1 ? `Added “${tracks[0].title}” to the queue` : `Added ${tracks.length} tracks to the queue`);
    },
    removeFromQueue: (uids) => {
      const { state, removedCurrent } = Q.removeItems(get().queue, uids);
      if (removedCurrent) beginTrack(state, true, get().playing);
      else {
        set({ queue: state });
        prepareUpcoming();
      }
      persistSoon();
    },
    moveInQueue: (from, to) => {
      set({ queue: Q.move(get().queue, from, to) });
      prepareUpcoming();
      persistSoon();
    },
    clearUpcoming: () => {
      set({ queue: Q.clearUpcoming(get().queue) });
      prepareUpcoming();
      persistSoon();
    },
    patchTrack: (id, patch) => {
      const q = get().queue;
      const items = q.items.map((i) => (i.track.id === id ? { ...i, track: { ...i.track, ...patch } } : i));
      const cur = get().current;
      set({ queue: { ...q, items }, current: cur && cur.id === id ? { ...cur, ...patch } : cur });
    },
    setSleep: (minutes) => {
      if (minutes === null) set({ sleepAt: null });
      else if (minutes === "track") set({ sleepAt: -1 });
      else set({ sleepAt: Date.now() + minutes * 60000 });
    },
    restore: async () => {
      try {
        const all = await library.settings();
        const snap = all["player.state"] as
          | { ids: number[]; index: number; shuffle: boolean; repeat: RepeatMode; positionMs: number; volume: number; muted: boolean; source: string | null }
          | undefined;
        if (!snap) {
          engine.setVolume(get().volume);
          set({ restored: true });
          return;
        }
        engine.setVolume(snap.volume ?? 0.8);
        engine.setMuted(!!snap.muted);
        const tracks = snap.ids?.length ? await library.tracksByIds(snap.ids.slice(0, 5000)) : [];
        const items = tracks.map((track) => ({ uid: Q.uid(), track, source: snap.source ?? undefined }));
        const curId = snap.ids?.[snap.index];
        const index = Math.max(-1, items.findIndex((i) => i.track.id === curId));
        const queue: QueueState = { items, index, shuffle: !!snap.shuffle, repeat: snap.repeat ?? "off", unshuffled: null, source: snap.source ?? undefined };
        lastPos = index >= 0 ? snap.positionMs ?? 0 : 0;
        lastDur = index >= 0 ? items[index].track.durationMs : 0;
        set({ queue, current: index >= 0 ? items[index].track : null, volume: snap.volume ?? 0.8, muted: !!snap.muted, restored: true });
        posListeners.forEach((fn) => fn(lastPos, lastDur));
        if (index >= 0) {
          updateMediaSession(items[index].track);
          if (useSettings.getState().resumeOnLaunch) get().play();
        }
      } catch (e) {
        log.warn("PLAYER", "restore failed", e);
        set({ restored: true });
      }
    },
  };
});

export function getEngineAnalyser(): AnalyserNode | null {
  return engineRef?.analyser ?? null;
}
