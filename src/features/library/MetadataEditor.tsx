import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/Button";
import { Artwork } from "@/components/Artwork";
import { call } from "@/services/ipc";
import type { Album, Track } from "@/services/types";
import { useUi, toast, toastError } from "@/state/ui";
import s from "./MetadataEditor.module.css";

type Field = "title" | "artist" | "album" | "albumArtist" | "trackNo" | "discNo" | "year" | "genre";
const LABELS: Record<Field, string> = { title: "Title", artist: "Artist", album: "Album", albumArtist: "Album artist", trackNo: "Track", discNo: "Disc", year: "Year", genre: "Genre" };

function common<T>(values: T[]): T | "" {
  return values.every((v) => v === values[0]) ? values[0] : "";
}

/** Edit tags for one or many tracks. Only fields you touch are written; files are edited via a verified temp copy. */
function Editor({ tracks, album, onClose }: { tracks: Track[]; album?: Album; onClose: () => void }) {
  const many = tracks.length > 1;
  const fields: Field[] = many ? ["artist", "album", "albumArtist", "year", "genre", "discNo"] : ["title", "artist", "album", "albumArtist", "trackNo", "discNo", "year", "genre"];
  const initial: Record<Field, string> = {
    title: String(common(tracks.map((t) => t.title)) ?? ""),
    artist: String(common(tracks.map((t) => t.artist)) ?? ""),
    album: String(common(tracks.map((t) => t.album)) ?? ""),
    albumArtist: String(common(tracks.map((t) => t.albumArtist)) ?? ""),
    trackNo: String(common(tracks.map((t) => t.trackNo ?? "")) ?? ""),
    discNo: String(common(tracks.map((t) => t.discNo ?? "")) ?? ""),
    year: String(common(tracks.map((t) => t.year ?? "")) ?? ""),
    genre: String(common(tracks.map((t) => t.genre ?? "")) ?? ""),
  };
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Set<Field>>(new Set());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const edit: Record<string, unknown> = {};
    for (const f of touched) {
      const v = values[f].trim();
      if (f === "trackNo" || f === "discNo" || f === "year") {
        const n = v === "" ? 0 : parseInt(v, 10);
        if (Number.isNaN(n) || n < 0) return toast(`${LABELS[f]} must be a number.`, "error");
        edit[f] = n;
      } else edit[f] = v;
    }
    if (!Object.keys(edit).length) return onClose();
    setBusy(true);
    try {
      const r = await call<{ written: number; failed: string[] }>("edit_tracks", { ids: tracks.map((t) => t.id), edit });
      onClose();
      toast(r.failed.length ? `Saved ${r.written}; couldn't write ${r.failed.length} (${r.failed.slice(0, 2).join(", ")})` : `Saved ${r.written === 1 ? "tags" : `${r.written} files`}.`, r.failed.length ? "error" : "info");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const changeArt = async () => {
    if (!album) return;
    const file = await open({ multiple: false, title: "Choose album artwork", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    if (!file || Array.isArray(file)) return;
    try {
      await call("set_album_art", { albumId: album.id, imagePath: file });
      toast("Artwork updated.");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Dialog title={many ? `Edit ${tracks.length} tracks` : "Edit track"} onClose={onClose} width={560}>
      {album && (
        <div className={s.art}>
          <Artwork hash={album.art} size={160} seed={album.title} className={s.thumb} />
          <div>
            <p className={s.hint}>Custom artwork is kept in FEEDBACK's library; your files aren't changed.</p>
            <Button variant="secondary" icon="albums" onClick={changeArt}>
              Change artwork
            </Button>
          </div>
        </div>
      )}
      <form
        className={s.grid}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {fields.map((f) => (
          <label key={f} className={`${s.field} ${f === "trackNo" || f === "discNo" || f === "year" ? s.short : ""}`}>
            <span className="label">{LABELS[f]}</span>
            <input
              value={values[f]}
              placeholder={many && initial[f] === "" ? "Mixed — leave to keep" : ""}
              inputMode={f === "trackNo" || f === "discNo" || f === "year" ? "numeric" : undefined}
              onChange={(e) => {
                setValues({ ...values, [f]: e.target.value });
                setTouched(new Set(touched).add(f));
              }}
              spellCheck={false}
            />
          </label>
        ))}
        <p className={s.hint}>Writes standard tags into the {many ? "files" : "file"}. A copy is edited and checked before it replaces the original.</p>
        <div className={s.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !touched.size}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function editTracks(tracks: Track[], album?: Album) {
  const close = () => useUi.getState().setDialog(null);
  useUi.getState().setDialog(<Editor tracks={tracks} album={album} onClose={close} />);
}
