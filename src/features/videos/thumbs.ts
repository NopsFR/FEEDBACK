import { trackUrl } from "@/services/platform";

/** Grab a frame ~12% into a local video for a thumbnail. One at a time; cached as object URLs for the session. */
const cache = new Map<number, string>();
const waiting: { id: number; resolve: (u: string | null) => void }[] = [];
let busy = false;

function pump() {
  if (busy) return;
  const job = waiting.shift();
  if (!job) return;
  busy = true;
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "metadata";
  v.src = trackUrl(job.id);
  const done = (url: string | null) => {
    if (url) cache.set(job.id, url);
    job.resolve(url);
    v.removeAttribute("src");
    v.load();
    busy = false;
    pump();
  };
  const timer = setTimeout(() => done(null), 8000);
  v.addEventListener("loadedmetadata", () => {
    v.currentTime = Math.min(30, (v.duration || 10) * 0.12);
  });
  v.addEventListener("seeked", () => {
    clearTimeout(timer);
    try {
      const c = document.createElement("canvas");
      const w = 480;
      c.width = w;
      c.height = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => done(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.82);
    } catch {
      done(null);
    }
  });
  v.addEventListener("error", () => {
    clearTimeout(timer);
    done(null);
  });
}

export function videoThumb(id: number): Promise<string | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    waiting.push({ id, resolve });
    pump();
  });
}
