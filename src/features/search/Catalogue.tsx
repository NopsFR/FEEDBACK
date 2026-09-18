import { useEffect, useState } from "react";
import { call } from "@/services/ipc";
import type { CatalogueOutcome } from "@/services/types";
import { Artwork } from "@/components/Artwork";
import { Section } from "@/components/Section";
import { isTauri } from "@/services/platform";
import { useSettings } from "@/state/settings";
import { useNav } from "@/state/nav";
import { duration } from "@/lib/format";
import s from "./Catalogue.module.css";

/**
 * Results from the wider catalogue — what exists, not what FEEDBACK can play. Anything already in
 * the library is shown by the local results above, so this section lists only the rest, and it
 * never offers a Play button it can't honour.
 */
export function CatalogueResults({ query, index }: { query: string; index: number }) {
  const on = useSettings((st) => st.onlineLookups);
  const [outcome, setOutcome] = useState<CatalogueOutcome | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "failed">("idle");
  const go = useNav((n) => n.go);

  useEffect(() => {
    if (!on || !isTauri || query.trim().length < 2) {
      setOutcome(null);
      return;
    }
    let cancelled = false;
    // The library answers instantly; the catalogue may take a moment, so it waits for a pause in
    // typing rather than firing a request per keystroke.
    const timer = setTimeout(() => {
      setState("searching");
      call<CatalogueOutcome>("catalogue_search", { query, scope: "everywhere" })
        .then((r) => {
          if (cancelled) return;
          setOutcome(r);
          const anything = r.tracks.some((x) => x.localTrackId == null) || r.releases.length > 0;
          setState(r.remoteAnswered || anything ? "idle" : "failed");
        })
        .catch(() => {
          if (cancelled) return;
          setOutcome(null);
          setState("failed");
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, on]);

  if (!on || !isTauri) return null;
  const remote = (outcome?.tracks ?? []).filter((t) => t.localTrackId == null);
  const releases = (outcome?.releases ?? []).filter((r) => r.localAlbumId == null);
  if (state === "idle" && !remote.length && !releases.length) return null;

  return (
    <Section index={index} title="Elsewhere in the catalogue">
      <p className={s.note}>
        {state === "searching"
          ? "Asking the catalogue…"
          : state === "failed"
            ? "The catalogue didn't answer. Your library is still searchable."
            : `Metadata from MusicBrainz${outcome?.debug.providers.some((p) => p.cache === "hit") ? ", from FEEDBACK's cache" : ""}. FEEDBACK has no audio for these — they're here so you know what exists.`}
      </p>
      {releases.length > 0 && (
        <ul className={s.releases}>
          {releases.slice(0, 6).map((r) => (
            <li key={r.canonicalId} className={s.release}>
              <img className={s.releaseArt} src={r.artwork.remote ?? ""} alt="" loading="lazy" />
              <span className={`truncate ${s.releaseTitle}`}>{r.title}</span>
              <span className={`truncate ${s.releaseArtist}`}>{r.artist}</span>
              <span className={`mono ${s.spec}`}>{[r.date?.slice(0, 4), r.format, r.trackCount ? `${r.trackCount} tracks` : null].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
      {remote.length > 0 && (
        <ul className={s.tracks}>
          {remote.slice(0, 12).map((t) => (
            <li key={t.canonicalId} className={s.track}>
              <Artwork hash={null} size={160} seed={t.album ?? t.title} className={s.art} />
              <span className={s.text}>
                <span className={`truncate ${s.title}`}>{t.title}</span>
                <span className={`truncate ${s.artist}`}>
                  {t.artist}
                  {t.album ? ` · ${t.album}` : ""}
                </span>
              </span>
              <span className={`mono ${s.spec}`}>{t.releaseDate?.slice(0, 4) ?? ""}</span>
              <span className={`mono ${s.spec}`}>{t.durationMs ? duration(t.durationMs) : ""}</span>
              <span className={`mono ${s.badge}`} title="FEEDBACK has no audio for this — it's a catalogue entry">Not in your library</span>
            </li>
          ))}
        </ul>
      )}
      <p className={s.foot}>
        Have the file already?{" "}
        <button className={s.link} onClick={() => go({ name: "settings", section: "library" })}>
          Add the folder it's in
        </button>
        , or open an album and use “Find artwork online…” to borrow its sleeve.
      </p>
    </Section>
  );
}
