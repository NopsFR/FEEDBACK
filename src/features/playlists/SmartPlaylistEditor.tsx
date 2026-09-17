import { useState } from "react";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { library } from "@/services/library";
import type { Playlist, SmartPlaylistCondition, SmartPlaylistField, SmartPlaylistRules } from "@/services/types";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { toastError, useUi } from "@/state/ui";
import s from "./SmartPlaylistEditor.module.css";

const FIELDS: { value: SmartPlaylistField; label: string }[] = [
  { value: "genre", label: "Genre" }, { value: "artist", label: "Artist" }, { value: "album", label: "Album" },
  { value: "year", label: "Year" }, { value: "plays", label: "Play count" }, { value: "added", label: "Date added" },
  { value: "lastPlayed", label: "Last played" }, { value: "favourite", label: "Favourite" }, { value: "codec", label: "Codec" },
  { value: "duration", label: "Duration" },
];
/** Kept in step with the Rust compiler (src-tauri/src/library/smart.rs); tests/unit/smart-ops.test.ts guards it. */
export const OPS: Record<SmartPlaylistField, { value: string; label: string; valueless?: boolean }[]> = {
  genre: textOps(), artist: textOps(), album: textOps(), codec: [{ value: "is", label: "is" }],
  year: numberOps("is"), plays: numberOps("is exactly"), duration: numberOps().slice(1), added: [{ value: "within", label: "within the last" }],
  lastPlayed: [{ value: "within", label: "within the last" }, { value: "notWithin", label: "not within the last" }, { value: "never", label: "never", valueless: true }],
  favourite: [{ value: "true", label: "is favourite", valueless: true }, { value: "false", label: "is not favourite", valueless: true }],
};
function textOps() { return [{ value: "is", label: "is" }, { value: "contains", label: "contains" }, { value: "not", label: "is not" }]; }
function numberOps(eq = "equals") { return [{ value: "eq", label: eq }, { value: "gte", label: "is at least" }, { value: "lte", label: "is at most" }]; }
function newCondition(field: SmartPlaylistField = "genre"): SmartPlaylistCondition {
  return { field, op: OPS[field][0].value, value: "" };
}
const DEFAULT_RULES: SmartPlaylistRules = { match: "all", conditions: [newCondition()], sort: "added_desc", limit: null };

function Editor({ playlist, onClose }: { playlist?: Playlist; onClose: () => void }) {
  const [name, setName] = useState(playlist?.name ?? "");
  const [rules, setRules] = useState<SmartPlaylistRules>(() => playlist?.rules ? structuredClone(playlist.rules) : structuredClone(DEFAULT_RULES));
  const [busy, setBusy] = useState(false);
  const patchCondition = (index: number, patch: Partial<SmartPlaylistCondition>) => setRules((r) => ({ ...r, conditions: r.conditions.map((c, i) => i === index ? { ...c, ...patch } : c) }));
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (playlist) await library.setPlaylistRules(playlist.id, rules);
      else {
        const id = await library.createSmartPlaylist(name.trim(), rules);
        useNav.getState().go({ name: "playlist", id });
      }
      await useLibrary.getState().loadPlaylists();
      useLibrary.getState().invalidate();
      onClose();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return (
    <Dialog title={playlist ? "Edit smart playlist" : "New smart playlist"} onClose={onClose} width={720}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!playlist && <label className={s.name}><span className="label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Late-night favourites" maxLength={120} /></label>}
        <div className={s.match}>Match <select value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value as "all" | "any" })}><option value="all">all</option><option value="any">any</option></select> of these rules:</div>
        <div className={s.rules}>
          {rules.conditions.map((condition, index) => {
            const op = OPS[condition.field].find((o) => o.value === condition.op) ?? OPS[condition.field][0];
            const unit = condition.field === "added" || condition.field === "lastPlayed" ? "days" : condition.field === "duration" ? "seconds" : null;
            return <div className={s.rule} key={index}>
              <select value={condition.field} aria-label="Rule field" onChange={(e) => { const field = e.target.value as SmartPlaylistField; patchCondition(index, newCondition(field)); }}>
                {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select value={condition.op} aria-label="Rule comparison" onChange={(e) => patchCondition(index, { op: e.target.value })}>
                {OPS[condition.field].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {!op.valueless && <input aria-label="Rule value" type={["year", "plays", "added", "lastPlayed", "duration"].includes(condition.field) ? "number" : "text"} min="0" value={String(condition.value ?? "")} onChange={(e) => patchCondition(index, { value: e.target.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value })} required />}
              {unit && !op.valueless && <span className={s.unit}>{unit}</span>}
              <button type="button" className={s.remove} onClick={() => setRules({ ...rules, conditions: rules.conditions.filter((_, i) => i !== index) })} disabled={rules.conditions.length === 1} aria-label="Remove rule">×</button>
            </div>;
          })}
        </div>
        <Button type="button" variant="quiet" icon="plus" onClick={() => setRules({ ...rules, conditions: [...rules.conditions, newCondition()] })}>Add rule</Button>
        <div className={s.options}>
          <label><span className="label">Order by</span><select value={rules.sort} onChange={(e) => setRules({ ...rules, sort: e.target.value as SmartPlaylistRules["sort"] })}><option value="added_desc">Recently added</option><option value="plays_desc">Most played</option><option value="last_played_desc">Recently played</option><option value="year_desc">Newest year</option><option value="title">Title</option><option value="artist">Artist</option><option value="random">Random</option></select></label>
          <label><span className="label">Limit</span><input type="number" min="1" max="10000" placeholder="No limit" value={rules.limit ?? ""} onChange={(e) => setRules({ ...rules, limit: e.target.value ? Number(e.target.value) : null })} /></label>
        </div>
        <div className={s.actions}><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : playlist ? "Save rules" : "Create"}</Button></div>
      </form>
    </Dialog>
  );
}

export function editSmartPlaylist(playlist?: Playlist) {
  const close = () => useUi.getState().setDialog(null);
  useUi.getState().setDialog(<Editor playlist={playlist} onClose={close} />);
}
