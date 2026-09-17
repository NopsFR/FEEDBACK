import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import type { IntroMode } from "@/state/settings";
import { useSettings } from "@/state/settings";
import s from "./Intro.module.css";

// Same spike profile as the app icon glyph (brand/logo/feedback-icon-glyph.svg)
const UPS = [6, 13, 22, 34, 54, 30, 38, 18, 8];
const DOWNS = [5, 12, 26, 30, 46, 36, 24, 16, 7];

function Burst() {
  const span = 74;
  const cx = 60;
  const w = 11.5;
  return (
    <svg className={s.burst} viewBox="0 0 120 120" aria-hidden>
      <rect className={s.carrier} x="0" y="58.2" width="120" height="3.6" />
      {UPS.map((u, i) => {
        const x = cx - span / 2 + (i / (UPS.length - 1)) * span;
        const ww = w * (0.7 + 0.3 * Math.min(1, ((u + DOWNS[i]) / (54 + 46)) * 2));
        return (
          <polygon
            key={i}
            className={s.spike}
            style={{ ["--d" as string]: `${120 + Math.abs(i - 4) * 55}ms` }}
            points={`${x - ww / 2},60 ${x},${60 - u} ${x + ww / 2},60 ${x},${60 + DOWNS[i]}`}
          />
        );
      })}
    </svg>
  );
}

/** Tiny synthesised sting: mains hum → cable click → short feedback swell. Quiet, optional. */
function playSting(fast: boolean) {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime + 0.05;
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
    // hum
    const hum = ctx.createOscillator();
    hum.frequency.value = 50;
    const humG = ctx.createGain();
    humG.gain.setValueAtTime(0, now);
    humG.gain.linearRampToValueAtTime(0.25, now + 0.15);
    humG.gain.linearRampToValueAtTime(0, now + (fast ? 0.3 : 1.0));
    hum.connect(humG).connect(master);
    hum.start(now);
    hum.stop(now + 1.2);
    // click
    const click = ctx.createBuffer(1, 800, ctx.sampleRate);
    const d = click.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 90);
    const cs = ctx.createBufferSource();
    cs.buffer = click;
    cs.connect(master);
    cs.start(now + (fast ? 0.05 : 0.45));
    if (fast) return;
    // swell
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, now + 0.6);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 1.4);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 128) - 1) * 3);
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, now + 0.6);
    sg.gain.linearRampToValueAtTime(0.12, now + 1.35);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    osc.connect(shaper).connect(lp).connect(sg).connect(master);
    osc.start(now + 0.6);
    osc.stop(now + 1.7);
    setTimeout(() => void ctx.close(), 2500);
  } catch {
    /* audio unavailable */
  }
}

export function Intro({ mode, ready, onDone }: { mode: IntroMode; ready: boolean; onDone: () => void }) {
  const fast = mode === "fast" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<"play" | "exit">("play");
  const [minElapsed, setMinElapsed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (useSettings.getState().introSound) playSting(fast);
    const t = setTimeout(() => setMinElapsed(true), fast ? 650 : 2300);
    return () => clearTimeout(t);
  }, [fast]);

  useEffect(() => {
    if (!minElapsed || !ready) return;
    setPhase("exit");
    const t = setTimeout(onDone, fast ? 280 : 620);
    return () => clearTimeout(t);
  }, [minElapsed, ready, fast, onDone]);

  // Skip on any key or click
  useEffect(() => {
    const skip = () => {
      setMinElapsed(true);
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);

  return (
    <div className={`${s.intro} ${fast ? s.fast : ""} ${phase === "exit" ? s.exit : ""}`} aria-hidden>
      <div className={s.top} />
      <div className={s.bottom} />
      <div className={s.center}>
        <Burst />
        <div className={s.mark}>
          <Wordmark className={`${s.word} ${s.wordRed}`} />
          <Wordmark className={`${s.word} ${s.wordPaper}`} />
        </div>
      </div>
      <div className={s.scratches} />
    </div>
  );
}
