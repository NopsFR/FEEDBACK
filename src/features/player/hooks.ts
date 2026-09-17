import { useEffect, useState, useSyncExternalStore } from "react";
import { getPosition, subscribePosition } from "./store";

/** Current position/duration. Throttled at the source (~5Hz). */
export function usePosition() {
  const [state, setState] = useState(getPosition);
  useEffect(() => subscribePosition((pos, dur) => setState((s) => (Math.abs(s.pos - pos) < 50 && s.dur === dur ? s : { pos, dur }))), []);
  return state;
}

let reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rmListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    reduced = e.matches;
    rmListeners.forEach((f) => f());
  });
}
export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      rmListeners.add(cb);
      return () => rmListeners.delete(cb);
    },
    () => reduced,
  );
}
