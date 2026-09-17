import { useRef } from "react";

/** Long-press for touch devices (iOS Safari doesn't fire contextmenu). Returns touch handlers. */
export function useLongPress(onLong: (x: number, y: number) => void, ms = 450) {
  const timer = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    clearTimeout(timer.current);
    origin.current = null;
  };
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      origin.current = { x: t.clientX, y: t.clientY };
      timer.current = window.setTimeout(() => {
        if (origin.current) {
          navigator.vibrate?.(12);
          onLong(origin.current.x, origin.current.y);
        }
        origin.current = null;
      }, ms);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.touches[0].clientX - o.x, e.touches[0].clientY - o.y) > 10) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };
}
