import { useSyncExternalStore } from "react";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-sized layout (touch-first shell). Short touch viewports are phones in landscape. */
export const useIsMobile = () => useMedia("(max-width: 760px), ((max-height: 520px) and (pointer: coarse))");
