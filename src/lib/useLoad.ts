import { useEffect, useState } from "react";
import { useLibrary } from "@/state/library";
import { log } from "./log";

/** Load data; reloads when deps change or the library reports a change. Keeps stale data visible while refetching. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const version = useLibrary((l) => l.version);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        log.warn("UI", e);
        setError(e instanceof Error ? e.message : "Couldn't load this.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
