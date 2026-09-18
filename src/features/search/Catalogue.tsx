import { useEffect, useState } from "react";
import { searchCatalogue } from "@/services/catalogue";
import { playCatalogueTrack, streamSource } from "@/services/external";
import type { CatalogueOutcome, CatalogueTrack } from "@/services/types";
import { Artwork } from "@/components/Artwork";
import { Section } from "@/components/Section";
import { useNav } from "@/state/nav";
import { duration } from "@/lib/format";
import s from "./Catalogue.module.css";

/**
 * Results from the wider catalogue — what exists, not what FEEDBACK can play. Anything already in
 * the library is shown by the local results above, so this section lists only the rest, and it
 * never offers a Play button it can't honour.
 */
/** The resolver's verdict in the user's words. A row that nothing can play says so. */
function playState(type: CatalogueTrack["playbackType"]) {
  switch (type) {
    case "full":
      return { label: "Playable", why: "A full recording is available to FEEDBACK" };
    case "userCloud":
      return { label: "Your copy", why: "Your own upload backs this — it plays anywhere you sign in" };
    case "preview":
      return { label: "Preview only", why: "Only a short sample is offered for this recording" };
    default:
      return { label: "Not in your library", why: "FEEDBACK has no audio for this — it's a catalogue entry" };
  }
}

/** Why nothing came back, in the user's terms — never a shrug, and never silence. */
function trouble(outcome: CatalogueOutcome | null): string | null {
  if (!outcome) return "The catalogue didn't answer. Your library is still searchable.";
  const failed = outcome.debug.providers.filter((p) => p.error);
  if (!failed.length) return null;
  const reason = failed.map((p) => p.error ?? "").join(" ");
  if (/429|503|rate/i.test(reason)) return "The catalogue is busy right now — it asked FEEDBACK to slow down. Try again in a moment.";
  if (/401|403|auth|sign/i.test(reason)) return "That provider needs you to sign in before it will hand over anything.";
  if (/unreachable|network|offline/i.test(reason)) return "FEEDBACK couldn't reach the catalogue. Your library is still searchable.";
  return "The catalogue didn't answer. Your library is still searchable.";
}

/** What the section found, said plainly: playable first, metadata counted but not paraded. */
function summary(playable: number, metadataOnly: number): string {
  if (playable > 0) return `${playable} playable ${playable === 1 ? "result" : "results"} from outside your library.`;
  if (metadataOnly > 0) return "Nothing out there can be played — no provider grants FEEDBACK the audio for this. Your own copies always play.";
  return "Nothing else found.";
}

export function CatalogueResults({ query, index }: { query: string; index: number }) {
  const [outcome, setOutcome] = useState<CatalogueOutcome | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "failed">("idle");
  const [showMetadata, setShowMetadata] = useState(false);
  const go = useNav((n) => n.go);

  useEffect(() => {
    setShowMetadata(false);
    if (query.trim().length < 2) {
      setOutcome(null);
      return;
    }
    let cancelled = false;
    const aborter = new AbortController();
    // The library answers instantly; the catalogue may take a moment, so it waits for a pause in
    // typing rather than firing a request per keystroke.
    const timer = setTimeout(() => {
      setState("searching");
      searchCatalogue(query, aborter.signal)
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
      aborter.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const remote = (outcome?.tracks ?? []).filter((t) => t.localTrackId == null);
  // Search is for music you can hear. A recording nobody will let FEEDBACK play is a catalogue
  // entry, not a result, so it waits behind a link instead of burying the ones that do play.
  const playable = remote.filter((t) => t.playbackType !== "unavailable");
  const catalogue = remote.filter((t) => t.playbackType === "unavailable");
  const shown = showMetadata ? [...playable, ...catalogue] : playable;
  const releases = (outcome?.releases ?? []).filter((r) => r.localAlbumId == null);
  if (state !== "searching" && !shown.length && !catalogue.length && !releases.length) return null;

  return (
    <Section index={index} title="Elsewhere in the catalogue">
      <p className={s.note}>
        {state === "searching" ? "Looking for something playable…" : (playable.length ? null : trouble(outcome)) ?? summary(playable.length, catalogue.length)}
        {catalogue.length > 0 && state !== "searching" && (
          <>
            {" "}
            <button className={s.link} onClick={() => setShowMetadata((on) => !on)}>
              {showMetadata ? "Hide catalogue entries" : `Show ${catalogue.length} catalogue ${catalogue.length === 1 ? "entry" : "entries"}`}
            </button>
          </>
        )}
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
      {shown.length > 0 && (
        <ul className={s.tracks}>
          {shown.slice(0, 12).map((t) => (
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
              {streamSource(t) ? (
                <button className={`mono ${s.playBtn}`} onClick={() => playCatalogueTrack(t)} title={`Streamed by ${streamSource(t)?.provider}`}>
                  Play · {streamSource(t)?.provider}
                </button>
              ) : (
                <span className={`mono ${s.badge}`} title={playState(t.playbackType).why}>
                  {playState(t.playbackType).label}
                </span>
              )}
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
