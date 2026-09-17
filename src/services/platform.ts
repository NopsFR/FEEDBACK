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

export function trackUrl(id: number): string {
  return `${mediaBase}/track/${id}`;
}

export function artUrl(hash: string | null | undefined, size: 160 | 480 | 0 = 480): string | null {
  if (!hash) return null;
  return `${mediaBase}/art/${hash}/${size}`;
}
