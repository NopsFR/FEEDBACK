/**
 * FEEDBACK audio engine.
 * Two <audio> decks feed a Web Audio graph:  deck → deckGain → EQ(10) → master → analyser → out.
 * Deck B preloads the next track so transitions are gapless-ish, and enables crossfades.
 * The engine knows nothing about queues; the player store drives it.
 */
import { log } from "@/lib/log";

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "loud room": [4, 3, 1, 0, -1, 0, 1, 2, 3, 3],
  "bass heavy": [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  "vocal": [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1],
  "treble cut": [0, 0, 0, 0, 0, 0, -1, -3, -5, -7],
  "late night": [2, 1, 0, 0, -1, -1, 0, 0, -1, -2],
};

type DeckName = "a" | "b";

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  source: MediaElementAudioSourceNode | null;
  src: string | null;
}

export interface EngineEvents {
  onTime: (posMs: number, durMs: number) => void;
  onPlayState: (playing: boolean) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  onBuffering: (b: boolean) => void;
  /** Deck swapped to a preloaded track (gapless / crossfade path). */
  onAdvanced: () => void;
}

function makeAudio(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  return el;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private decks: Record<DeckName, Deck> = { a: { el: makeAudio(), gain: null, source: null, src: null }, b: { el: makeAudio(), gain: null, source: null, src: null } };
  private active: DeckName = "a";
  private eq: BiquadFilterNode[] = [];
  private master: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  private volume = 0.8;
  private muted = false;
  private gainDb: Record<DeckName, number> = { a: 0, b: 0 };
  private crossfadeSec = 0;
  private fading = false;
  private raf = 0;
  private lastTimeEmit = 0;
  private events: EngineEvents;
  private eqEnabled = false;
  private eqBands = EQ_PRESETS.flat;
  private nextPrepared: string | null = null;

  constructor(events: EngineEvents) {
    this.events = events;
    for (const name of ["a", "b"] as DeckName[]) this.wire(name);
  }

  private get deck(): Deck {
    return this.decks[this.active];
  }
  private get other(): Deck {
    return this.decks[this.active === "a" ? "b" : "a"];
  }
  private otherName(): DeckName {
    return this.active === "a" ? "b" : "a";
  }

  private wire(name: DeckName) {
    const el = this.decks[name].el;
    const isActive = () => this.active === name;
    el.addEventListener("playing", () => isActive() && (this.events.onPlayState(true), this.events.onBuffering(false)));
    el.addEventListener("pause", () => isActive() && !this.fading && this.events.onPlayState(false));
    el.addEventListener("waiting", () => isActive() && this.events.onBuffering(true));
    el.addEventListener("canplay", () => isActive() && this.events.onBuffering(false));
    el.addEventListener("loadedmetadata", () => isActive() && this.emitTime(true));
    el.addEventListener("ended", () => {
      if (!isActive()) return;
      if (this.nextPrepared && this.other.src === this.nextPrepared) {
        this.swapToPrepared(false);
      } else {
        this.events.onEnded();
      }
    });
    el.addEventListener("error", () => {
      if (!isActive() || !el.src) return;
      const code = el.error?.code;
      const message = code === 4 ? "This file's format can't be played here." : code === 2 ? "The file couldn't be read." : "Playback failed for this track.";
      log.warn("PLAYER", "media error", code, el.error?.message, el.src);
      this.events.onError(message);
    });
  }

  /** Create the AudioContext lazily (browsers require a gesture; desktop allows autoplay). */
  private ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "playback" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.eq = EQ_FREQS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
        b.frequency.value = f;
        b.Q.value = 1.1;
        b.gain.value = 0;
        return b;
      });
      for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);
      this.eq[this.eq.length - 1].connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      for (const name of ["a", "b"] as DeckName[]) {
        const d = this.decks[name];
        d.source = ctx.createMediaElementSource(d.el);
        d.gain = ctx.createGain();
        d.source.connect(d.gain);
        d.gain.connect(this.eq[0]);
        d.el.volume = 1;
      }
      this.applyEq();
      this.applyVolume();
      this.applyDeckGain("a");
      this.applyDeckGain("b");
    } catch (e) {
      // Fallback: element volume only (no EQ/visualiser)
      log.warn("PLAYER", "Web Audio unavailable, using element volume", e);
      this.ctx = null;
    }
  }

  private dbToLin(db: number) {
    return Math.pow(10, db / 20);
  }

  private applyVolume() {
    const v = this.muted ? 0 : this.volume * this.volume; // perceptual curve
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
    else for (const d of Object.values(this.decks)) d.el.volume = v;
  }

  private applyDeckGain(name: DeckName, fade = false) {
    const d = this.decks[name];
    if (!d.gain || !this.ctx) return;
    const target = this.dbToLin(this.gainDb[name]);
    if (fade) d.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    else d.gain.gain.value = target;
  }

  private applyEq() {
    this.eq.forEach((b, i) => (b.gain.value = this.eqEnabled ? this.eqBands[i] ?? 0 : 0));
  }

  setEq(enabled: boolean, bands: number[]) {
    this.eqEnabled = enabled;
    this.eqBands = bands;
    this.applyEq();
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
  }

  setCrossfade(sec: number) {
    this.crossfadeSec = Math.max(0, Math.min(12, sec));
  }

  /** Load a track into the active deck. `gainDb` is the ReplayGain adjustment. */
  load(src: string, gainDb: number, startMs = 0, autoplay = true) {
    this.ensureGraph();
    this.cancelFade();
    // If the requested track is already preloaded on the other deck, swap instead of reloading.
    if (this.other.src === src && this.nextPrepared === src && startMs === 0) {
      this.gainDb[this.otherName()] = gainDb;
      this.swapToPrepared(true, autoplay);
      return;
    }
    const d = this.deck;
    this.gainDb[this.active] = gainDb;
    this.applyDeckGain(this.active);
    d.src = src;
    d.el.src = src;
    if (startMs > 0) {
      const seek = () => {
        d.el.currentTime = startMs / 1000;
        d.el.removeEventListener("loadedmetadata", seek);
      };
      d.el.addEventListener("loadedmetadata", seek);
    }
    d.el.load();
    if (autoplay) this.play();
    else this.events.onPlayState(false);
    this.startClock();
  }

  /** Preload what plays next (gapless / crossfade). */
  prepareNext(src: string | null, gainDb = 0) {
    if (src === this.nextPrepared) return;
    this.nextPrepared = src;
    const o = this.other;
    if (!src) {
      if (o.src) {
        o.el.pause();
        o.el.removeAttribute("src");
        o.src = null;
      }
      return;
    }
    this.gainDb[this.otherName()] = gainDb;
    o.src = src;
    o.el.src = src;
    o.el.preload = "auto";
    o.el.load();
  }

  private swapToPrepared(userInitiated: boolean, autoplay = true) {
    const old = this.deck;
    this.active = this.otherName();
    this.nextPrepared = null;
    old.el.pause();
    this.applyDeckGain(this.active);
    this.deck.el.currentTime = 0;
    if (autoplay) this.play();
    if (!userInitiated) this.events.onAdvanced();
    // free old deck
    old.el.removeAttribute("src");
    old.el.load();
    old.src = null;
    this.startClock();
  }

  private cancelFade() {
    if (!this.fading) return;
    this.fading = false;
    const o = this.other;
    o.el.pause();
  }

  play() {
    this.ensureGraph();
    const p = this.deck.el.play();
    if (p) {
      p.catch((e: DOMException) => {
        if (e.name === "NotAllowedError") {
          log.info("PLAYER", "autoplay blocked; waiting for gesture");
          this.events.onPlayState(false);
        } else if (e.name !== "AbortError") log.warn("PLAYER", "play() failed", e);
      });
    }
    this.startClock();
  }

  pause() {
    this.deck.el.pause();
    if (this.fading) this.cancelFade();
  }

  stop() {
    this.pause();
    for (const d of Object.values(this.decks)) {
      d.el.removeAttribute("src");
      d.el.load();
      d.src = null;
    }
    this.nextPrepared = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  seek(ms: number) {
    const el = this.deck.el;
    if (!Number.isFinite(el.duration)) return;
    this.cancelFade();
    el.currentTime = Math.max(0, Math.min(el.duration - 0.05, ms / 1000));
    this.emitTime(true);
  }

  get playing() {
    return !this.deck.el.paused;
  }

  get positionMs() {
    return this.deck.el.currentTime * 1000;
  }

  get durationMs() {
    const d = this.deck.el.duration;
    return Number.isFinite(d) ? d * 1000 : 0;
  }

  /** Fade master out over `sec` then pause (sleep timer). */
  fadeOutAndPause(sec: number) {
    if (!this.master || !this.ctx) {
      this.pause();
      return;
    }
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + sec);
    setTimeout(() => {
      this.pause();
      this.applyVolume();
    }, sec * 1000 + 50);
  }

  private emitTime(force = false) {
    const now = performance.now();
    if (!force && now - this.lastTimeEmit < 200) return;
    this.lastTimeEmit = now;
    this.events.onTime(this.positionMs, this.durationMs);
  }

  private startClock() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      const el = this.deck.el;
      this.emitTime();
      // crossfade trigger
      if (this.crossfadeSec > 0 && this.nextPrepared && !this.fading && !el.paused && Number.isFinite(el.duration)) {
        const remaining = el.duration - el.currentTime;
        if (remaining <= this.crossfadeSec && el.duration > this.crossfadeSec * 2.5) this.beginCrossfade(remaining);
      }
      if (!el.paused || this.fading) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private beginCrossfade(sec: number) {
    if (!this.ctx) return;
    const outName = this.active;
    const inName = this.otherName();
    const out = this.decks[outName];
    const inc = this.decks[inName];
    if (!out.gain || !inc.gain) return;
    this.fading = true;
    const t = this.ctx.currentTime;
    const inTarget = this.dbToLin(this.gainDb[inName]);
    const outStart = this.dbToLin(this.gainDb[outName]);
    inc.gain.gain.cancelScheduledValues(t);
    inc.gain.gain.setValueAtTime(0.0001, t);
    inc.gain.gain.linearRampToValueAtTime(inTarget, t + sec);
    out.gain.gain.cancelScheduledValues(t);
    out.gain.gain.setValueAtTime(outStart, t);
    out.gain.gain.linearRampToValueAtTime(0.0001, t + sec);
    inc.el.currentTime = 0;
    void inc.el.play();
    // Hand over control immediately: the incoming track is now "current".
    this.active = inName;
    this.nextPrepared = null;
    this.events.onAdvanced();
    setTimeout(() => {
      if (!this.fading) return;
      this.fading = false;
      out.el.pause();
      out.el.removeAttribute("src");
      out.el.load();
      out.src = null;
      this.applyDeckGain(outName);
    }, sec * 1000 + 120);
  }
}
