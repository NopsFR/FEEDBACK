/** Runtime capability detection. The same frontend runs inside Tauri (desktop/mobile) and as a PWA. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isWindows = /Windows/i.test(ua);
export const isAndroid = /Android/i.test(ua);
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
export const isMac = /Macintosh/.test(ua) && !isIOS;
export const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
export const modKey = isMac || isIOS ? "⌘" : "Ctrl";

/** Base URL for the fbmedia custom protocol. Windows/Android WebViews use http://<scheme>.localhost. */
export const mediaBase = isWindows || isAndroid ? "http://fbmedia.localhost" : "fbmedia://localhost";

// ---- PWA mode: media comes from the paired desktop (or from on-device offline storage) ----
const TOKEN_KEY = "feedback.token";
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Offline blob URLs registered by the offline store (track id → object URL). */
export const offlineUrls = new Map<number, string>();
/** Short-lived signed URLs for your own uploads, filled in by the cloud library. */
export const cloudUrls = new Map<number, string>();
export const offlineArt = new Map<string, string>();

export function trackUrl(id: number): string {
  if (isTauri) return `${mediaBase}/track/${id}`;
  const local = offlineUrls.get(id);
  if (local) return local;
  // Your own cloud copy: works on mobile data with the computer switched off.
  const cloud = cloudUrls.get(id);
  if (cloud) return cloud;
  return `${location.origin}/media/track/${id}?t=${encodeURIComponent(getToken() ?? "")}`;
}

export function artUrl(hash: string | null | undefined, size: 160 | 480 | 0 = 480): string | null {
  if (!hash) return null;
  if (isTauri) return `${mediaBase}/art/${hash}/${size}`;
  const local = offlineArt.get(`${hash}/${size === 0 ? 480 : size}`);
  if (local) return local;
  return `${location.origin}/media/art/${hash}/${size}?t=${encodeURIComponent(getToken() ?? "")}`;
}
