import { useEffect } from "react";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { openMenuAt } from "@/components/ContextMenu";
import { promptText } from "@/components/Dialog";
import { library } from "@/services/library";
import { longDuration, plural, relativeDay } from "@/lib/format";
import { toastError } from "@/state/ui";
import type { Playlist } from "@/services/types";
import { Page, PageHead } from "@/features/library/Page";
import { playlistMenu } from "./actions";
import s from "./Playlists.module.css";

/** Four-up collage like a mixtape insert. Falls back to a printed blank. */
export function Collage({ p, className }: { p: Pick<Playlist, "arts" | "name">; className?: string }) {
  const arts = p.arts.slice(0, 4);
  if (arts.length < 4) return <Artwork hash={arts[0] ?? null} seed={p.name} className={className} />;
  return (
    <div className={`${s.collage} ${className ?? ""}`}>
      {arts.map((a) => (
        <Artwork key={a} hash={a} size={160} />
      ))}
    </div>
  );
}

export async function createPlaylistFlow() {
  const name = await promptText("New playlist", { placeholder: "Name", confirm: "Create" });
  if (!name) return;
  try {
    const id = await library.createPlaylist(name);
    await useLibrary.getState().loadPlaylists();
    useNav.getState().go({ name: "playlist", id });
  } catch (e) {
    toastError(e);
  }
}

export function Playlists() {
  const playlists = useLibrary((l) => l.playlists);
  const go = useNav((n) => n.go);
  useEffect(() => {
    void useLibrary.getState().loadPlaylists();
  }, []);
  return (
    <Page>
      <PageHead label="Kept" title="Playlists" meta={plural(playlists.length, "playlist")} actions={<Button icon="plus" onClick={createPlaylistFlow}>New playlist</Button>} />
      {playlists.length ? (
        <div className={s.grid}>
          {playlists.map((p) => (
            <button key={p.id} className={s.card} onClick={() => go({ name: "playlist", id: p.id })} onContextMenu={(e) => openMenuAt(e, playlistMenu(p))}>
              <Collage p={p} className={s.art} />
              <span className={`truncate ${s.name}`}>{p.name}</span>
              <span className={`mono ${s.meta}`}>
                {plural(p.trackCount, "track")} · {longDuration(p.durationMs)} · {relativeDay(p.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No playlists" body="Make one here, or right-click any track and choose “Add to playlist”. You can also drag tracks onto a playlist in the shelf." action={<Button icon="plus" onClick={createPlaylistFlow}>New playlist</Button>} note="side a, side b." />
      )}
    </Page>
  );
}
