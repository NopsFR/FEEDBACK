import { useEffect, useRef } from "react";
import { getEngineAnalyser, usePlayer } from "./store";
import { useReducedMotion } from "./hooks";

/**
 * The FEEDBACK signal: a horizontal carrier line with symmetrical spikes driven by the spectrum —
 * the same burst as the logo, alive. Stops drawing when hidden or paused.
 */
export function Visualiser({ className, color = "#e6e1d6", accent = "#ff2a3a", bars = 96 }: { className?: string; color?: string; accent?: string; bars?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const playing = usePlayer((p) => p.playing);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let visible = true;
    const levels = new Float32Array(bars);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    let freq: Uint8Array<ArrayBuffer> | null = null;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden) return;
      const an = getEngineAnalyser();
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      if (an && (!freq || freq.length !== an.frequencyBinCount)) freq = new Uint8Array(an.frequencyBinCount);
      if (an && freq) an.getByteFrequencyData(freq);
      ctx.clearRect(0, 0, w, h);
      // log-spaced bins, mirrored from the centre outward so the burst peaks in the middle
      const half = bars / 2;
      for (let i = 0; i < half; i++) {
        let v = 0;
        if (freq && playing) {
          const lo = Math.floor(Math.pow(freq.length * 0.7, i / half));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(freq.length * 0.7, (i + 1) / half)));
          let sum = 0;
          for (let k = lo; k < hi; k++) sum += freq[k];
          v = sum / (hi - lo) / 255;
          v = Math.pow(v, 1.6);
        }
        const prev = levels[i];
        levels[i] = v > prev ? prev + (v - prev) * 0.55 : prev * 0.9;
      }
      const spacing = w / bars;
      const bw = Math.max(1.5, spacing * 0.55);
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i++) {
        const k = i < half ? half - 1 - i : i - half;
        const env = 1 - Math.abs(i - bars / 2) / (bars / 2);
        const lvl = levels[k] * (0.35 + 0.65 * env);
        const up = Math.max(1, lvl * mid * 0.95);
        const down = Math.max(1, lvl * mid * 0.75 * (0.7 + 0.3 * ((i * 7) % 5) / 5));
        const x = i * spacing + spacing / 2;
        ctx.beginPath();
        ctx.moveTo(x - bw / 2, mid);
        ctx.lineTo(x, mid - up);
        ctx.lineTo(x + bw / 2, mid);
        ctx.lineTo(x, mid + down);
        ctx.closePath();
        ctx.fill();
      }
      // carrier line
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.2, color);
      grad.addColorStop(0.5, accent);
      grad.addColorStop(0.8, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, mid - 0.75, w, 1.5);
      if (reduced || !playing) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [playing, reduced, bars, color, accent]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
