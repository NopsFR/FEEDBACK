import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/Button";
import { call } from "@/services/ipc";
import type { Album, LookupCandidate } from "@/services/types";
import { useLibrary } from "@/state/library";
import { useSettings } from "@/state/settings";
import { toast, toastError, useUi } from "@/state/ui";
import s from "./ArtworkFinder.module.css";

/**
 * Finds a sleeve for an album in the Cover Art Archive, via a MusicBrainz release match.
 * Catalogue data only — no audio comes from these services — and it stays off until the user says otherwise.
 */
function Finder({ album, onClose }: { album: Album; onClose: () => void }) {
  const allowed = useSettings((st) => st.onlineLookups);
  const [results, setResults] = useState<LookupCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    setResults(null);
    setError(null);
    call<LookupCandidate[]>("lookup_album", { albumId: album.id })
      .then((r) => alive && setResults(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [album.id, allowed]);

  const apply = async (candidate: LookupCandidate) => {
    setApplying(candidate.mbid);
    try {
      await call("apply_lookup_art", { albumId: album.id, mbid: candidate.mbid });
      useLibrary.getState().invalidate();
      toast("Artwork updated.");
      onClose();
    } catch (e) {
      toastError(e);
      setApplying(null);
    }
  };

  return (
    <Dialog title="Find artwork" onClose={onClose} width={640}>
      <p className={s.intro}>
        {album.title} · {album.artist}
      </p>
      {!allowed ? (
        <>
          <p className={s.body}>
            FEEDBACK can ask MusicBrainz which release this is and fetch its sleeve from the Cover Art Archive. It sends
            only this album's title and artist, and only when you ask. No account, no tracking, and nothing is played
            from those services — they hold catalogue data, not music.
          </p>
          <div className={s.actions}>
            <Button variant="secondary" onClick={onClose}>Not now</Button>
            <Button onClick={() => useSettings.getState().set("onlineLookups", true)}>Turn on and search</Button>
          </div>
        </>
      ) : error ? (
        <>
          <p className={s.body}>{error}</p>
          <div className={s.actions}><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </>
      ) : !results ? (
        <p className={`mono ${s.body}`}>Searching the catalogue…</p>
      ) : results.length === 0 ? (
        <>
          <p className={s.body}>No release with a sleeve on file matched this album. Editing the album and artist tags usually helps.</p>
          <div className={s.actions}><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </>
      ) : (
        <ul className={s.grid}>
          {results.map((candidate) => (
            <li key={candidate.mbid}>
              <button className={s.card} onClick={() => void apply(candidate)} disabled={!!applying}>
                <img className={s.thumb} src={candidate.thumb ?? ""} alt="" width={132} height={132} />
                <span className={s.title}>{candidate.title}</span>
                <span className={s.meta}>{candidate.artist}</span>
                <span className={`mono ${s.spec}`}>
                  {[candidate.date?.slice(0, 4), candidate.format, candidate.trackCount ? `${candidate.trackCount} tracks` : null, candidate.country, candidate.label]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {applying === candidate.mbid && <span className={`mono ${s.spec}`}>Saving…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function findArtwork(album: Album) {
  const close = () => useUi.getState().setDialog(null);
  useUi.getState().setDialog(<Finder album={album} onClose={close} />);
}
