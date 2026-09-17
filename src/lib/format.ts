export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "1 hr 12 min" / "38 min" */
export function longDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function audioSpec(t: { codec?: string; bitrate?: number; sampleRate?: number; bitDepth?: number }): string {
  const parts: string[] = [];
  if (t.codec) parts.push(t.codec);
  const lossless = t.codec && ["FLAC", "ALAC", "WAV", "AIFF", "WavPack", "APE"].includes(t.codec);
  if (lossless && t.bitDepth && t.sampleRate) parts.push(`${t.bitDepth}/${(t.sampleRate / 1000).toFixed(t.sampleRate % 1000 ? 1 : 0)}`);
  else if (t.bitrate) parts.push(`${t.bitrate} kbps`);
  if (!lossless && t.sampleRate) parts.push(`${(t.sampleRate / 1000).toFixed(1)} kHz`);
  return parts.join(" · ");
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function relativeDay(ts: number | null | undefined): string {
  if (!ts) return "never";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

export function pad2(n: number | undefined): string {
  return n == null ? "–" : String(n).padStart(2, "0");
}
