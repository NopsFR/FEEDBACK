export interface LyricLine {
  time: number; // ms, -1 for unsynced
  text: string;
}

const TIME = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parse LRC (with multiple timestamps per line and [offset:]) or plain text. */
export function parseLyrics(text: string, synced: boolean): LyricLine[] {
  const lines = text.replace(/\r/g, "").split("\n");
  if (!synced) return lines.map((l) => ({ time: -1, text: l.trim() })).filter((_, i, a) => i < a.length - 1 || a[i].text);
  let offset = 0;
  const out: LyricLine[] = [];
  for (const raw of lines) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) {
      offset = parseInt(off[1], 10);
      continue;
    }
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    TIME.lastIndex = 0;
    let lastIndex = 0;
    while ((m = TIME.exec(raw))) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      stamps.push(parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + frac);
      lastIndex = TIME.lastIndex;
    }
    if (!stamps.length) continue;
    const textPart = raw.slice(lastIndex).trim();
    for (const s of stamps) out.push({ time: Math.max(0, s - offset), text: textPart });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Index of the active line for a position (binary search). */
export function activeLine(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
