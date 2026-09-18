import { useCallback, useEffect, useState } from "react";
import { call } from "@/services/ipc";
import type { CatalogueHealth, CatalogueOutcome, ProviderStatus } from "@/services/types";
import { Button } from "@/components/Button";
import { toast, toastError } from "@/state/ui";
import s from "./Developer.module.css";

const STATE_LABEL: Record<ProviderStatus["state"], string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  rateLimited: "Slowed down",
  offline: "Offline",
  disabled: "Off",
};

function ago(ms: number | null) {
  if (ms == null) return "never";
  if (ms < 1000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

/**
 * What the catalogue is actually doing: which services answered, how fast, how often FEEDBACK
 * avoided asking them at all, and what a given search was made of. Credentials never appear here
 * because no provider FEEDBACK uses has any.
 */
export function Developer() {
  const [health, setHealth] = useState<CatalogueHealth | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [debug, setDebug] = useState<CatalogueOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    call<CatalogueHealth>("catalogue_health").then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const test = async (provider: string) => {
    setTests((t) => ({ ...t, [provider]: "…" }));
    try {
      const r = await call<{ ok: boolean; ms: number; detail: string }>("catalogue_test_provider", { provider });
      setTests((t) => ({ ...t, [provider]: `${r.ok ? "ok" : "failed"} · ${r.ms}ms · ${r.detail}` }));
    } catch (e) {
      setTests((t) => ({ ...t, [provider]: e instanceof Error ? e.message : String(e) }));
    }
    refresh();
  };

  const toggle = async (provider: string, enabled: boolean) => {
    try {
      await call("catalogue_set_provider", { provider, enabled });
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const runDebug = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setDebug(await call<CatalogueOutcome>("catalogue_search", { query, scope: "everywhere" }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const cache = health?.cache;
  const lookups = (cache?.hits ?? 0) + (cache?.misses ?? 0);
  const hitRate = lookups ? Math.round(((cache?.hits ?? 0) / lookups) * 100) : 0;

  return (
    <div className={s.panel}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Provider</th>
            <th>State</th>
            <th className={s.num}>Latency</th>
            <th className={s.num}>Requests</th>
            <th className={s.num}>Errors</th>
            <th>Last success</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(health?.providers ?? []).map((p) => (
            <tr key={p.provider}>
              <td className={s.name}>{p.provider}</td>
              <td>
                <span className={`${s.state} ${s[p.state]}`}>{STATE_LABEL[p.state]}</span>
                {p.waitingFor ? <span className={s.dim}> · {p.waitingFor}s</span> : null}
              </td>
              <td className={`mono ${s.num}`}>{p.averageLatencyMs ? `${p.averageLatencyMs}ms` : "—"}</td>
              <td className={`mono ${s.num}`}>{p.requests}</td>
              <td className={`mono ${s.num}`}>{p.errors}</td>
              <td className={`mono ${s.dim}`}>{ago(p.lastSuccessMsAgo)}</td>
              <td className={s.actions}>
                <button className={s.link} onClick={() => void test(p.provider)}>Test</button>
                <button className={s.link} onClick={() => void toggle(p.provider, p.state === "disabled")}>{p.state === "disabled" ? "Enable" : "Disable"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.entries(tests).map(([provider, result]) => (
        <p key={provider} className={`mono ${s.testLine}`}>
          {provider}: {result}
        </p>
      ))}
      {(health?.providers ?? []).some((p) => p.lastError) && (
        <ul className={s.errors}>
          {(health?.providers ?? []).filter((p) => p.lastError).map((p) => (
            <li key={p.provider} className={s.dim}>
              <span className="mono">{p.provider}</span> — {p.lastError}
            </li>
          ))}
        </ul>
      )}

      <div className={s.cache}>
        <span className={`mono ${s.dim}`}>
          Cache · {cache?.rows ?? 0} rows · {hitRate}% of lookups answered without asking ({cache?.hits ?? 0} hits, {cache?.misses ?? 0} misses, {cache?.staleServed ?? 0} stale served) · schema v{cache?.schema ?? 0}
        </span>
        <Button
          variant="secondary"
          onClick={() =>
            call<number>("catalogue_clear_cache", {})
              .then((n) => {
                toast(`Cleared ${n} cached answers.`);
                refresh();
              })
              .catch(toastError)
          }
        >
          Clear cache
        </Button>
      </div>

      <div className={s.debug}>
        <label className={s.search}>
          <span className="label">Search debugger</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="artist and title" onKeyDown={(e) => e.key === "Enter" && void runDebug()} spellCheck={false} />
        </label>
        <Button variant="secondary" disabled={busy || !query.trim()} onClick={() => void runDebug()}>
          {busy ? "Running…" : "Run"}
        </Button>
      </div>
      {debug && (
        <div className={`mono ${s.result}`}>
          <div>
            query “{debug.debug.query}” · {debug.debug.totalMs}ms total
          </div>
          {debug.debug.providers.map((p) => (
            <div key={p.provider}>
              {p.provider}: {p.results} result{p.results === 1 ? "" : "s"} · {p.ms}ms · cache {p.cache}
              {p.error ? ` · ${p.error}` : ""}
            </div>
          ))}
          <div>
            dedupe: {debug.debug.incoming} in → {debug.debug.unique} out ({debug.debug.duplicatesRemoved} merged)
          </div>
          <div>top: {debug.tracks[0] ? `${debug.tracks[0].artist} — ${debug.tracks[0].title}${debug.tracks[0].localTrackId != null ? " (yours)" : ""}` : "nothing"}</div>
        </div>
      )}
    </div>
  );
}
