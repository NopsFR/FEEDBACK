import { useEffect, useState } from "react";
import { artUrl } from "@/services/platform";

export interface Ambient {
  a: string;
  b: string;
  /** relative luminance of the dominant colour, 0..1 */
  lum: number;
}

const cache = new Map<string, Ambient>();
const FALLBACK: Ambient = { a: "#3b0a10", b: "#141414", lum: 0.05 };

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

/**
 * Derive two restrained ambient colours from artwork.
 * Rejects near-black/near-white and blown-out pixels, clamps saturation and lightness so text contrast stays predictable.
 */
export async function extractAmbient(hash: string): Promise<Ambient> {
  const hit = cache.get(hash);
  if (hit) return hit;
  const url = artUrl(hash, 160);
  if (!url) return FALLBACK;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return FALLBACK;
  }
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return FALLBACK;
  ctx.drawImage(img, 0, 0, 32, 32);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, 32, 32).data;
  } catch {
    return FALLBACK;
  }
  const buckets = new Map<number, { n: number; h: number; s: number; l: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = toHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.08 || l > 0.92) continue;
    const key = s < 0.12 ? 1000 + Math.round(l * 4) : Math.round(h / 24);
    const b = buckets.get(key) ?? { n: 0, h: 0, s: 0, l: 0 };
    const w = 1 + s * 3;
    b.n += w;
    b.h += h * w;
    b.s += s * w;
    b.l += l * w;
    buckets.set(key, b);
  }
  const sorted = [...buckets.values()].sort((x, y) => y.n - x.n);
  if (!sorted.length) {
    cache.set(hash, FALLBACK);
    return FALLBACK;
  }
  const pick = (b: { n: number; h: number; s: number; l: number }) => ({ h: b.h / b.n, s: b.s / b.n, l: b.l / b.n });
  const p1 = pick(sorted[0]);
  const p2 = sorted[1] ? pick(sorted[1]) : { ...p1, h: (p1.h + 30) % 360 };
  const amb: Ambient = {
    a: hsl(p1.h, Math.min(0.55, p1.s), Math.min(0.32, Math.max(0.14, p1.l * 0.6))),
    b: hsl(p2.h, Math.min(0.45, p2.s), Math.min(0.2, Math.max(0.07, p2.l * 0.4))),
    lum: p1.l,
  };
  cache.set(hash, amb);
  return amb;
}

export function useAmbient(hash: string | null | undefined): Ambient {
  const [amb, setAmb] = useState<Ambient>(() => (hash && cache.get(hash)) || FALLBACK);
  useEffect(() => {
    let alive = true;
    if (!hash) {
      setAmb(FALLBACK);
      return;
    }
    void extractAmbient(hash).then((a) => alive && setAmb(a));
    return () => {
      alive = false;
    };
  }, [hash]);
  return amb;
}
