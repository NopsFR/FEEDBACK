import { useMemo, useState } from "react";
import { library } from "@/services/library";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/features/player/store";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/EmptyState";
import { Segmented } from "@/components/Segmented";
import { openMenuFrom } from "@/components/ContextMenu";
import { longDuration, plural } from "@/lib/format";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { toastError } from "@/state/ui";
import { Loading, Page } from "@/features/library/Page";
import { TrackList } from "@/features/library/TrackList";
import { Collage } from "./Playlists";
import { playlistMenu, renamePlaylist } from "./actions";
import s from "./PlaylistPage.module.css";
import ts from "@/features/library/Tracks.module.css";

type Sort = "custom" | "title" | "artist" | "album" | "duration";

export function PlaylistPage({ id }: { id: number }) {
  const { data, error, reload } = useLoad(() => library.playlist(id), [id]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("custom");
  const go = useNav((n) => n.go);

  const view = useMemo(() => {
    if (!data) return { tracks: [], entryIds: [] };
    let entries = data.entries;
    const q = filter.trim().toLowerCase();
    if (q) entries = entries.filter((e) => `${e.track.title} ${e.track.artist} ${e.track.album}`.toLowerCase().includes(q));
    const c = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    if (sort !== "custom") entries = [...entries];
    if (sort === "title") entries.sort((a, b) => c(a.track.title, b.track.title));
    if (sort === "artist") entries.sort((a, b) => c(a.track.artist, b.track.artist));
    if (sort === "album") entries.sort((a, b) => c(a.track.album, b.track.album) || (a.track.trackNo ?? 0) - (b.track.trackNo ?? 0));
    if (sort === "duration") entries.sort((a, b) => b.track.durationMs - a.track.durationMs);
    return { tracks: entries.map((e) => e.track), entryIds: entries.map((e) => e.entryId) };
  }, [data, filter, sort]);

  if (error) return <Page><EmptyState compact title="Playlist not found" body={error} action={<Button onClick={() => go({ name: "playlists" })}>All playlists</Button>} /></Page>;
  if (!data) return <Loading />;
  const p = data.playlist;
  const canReorder = sort === "custom" && !filter.trim();

  const reorder = async (entryIds: number[]) => {
    try {
      await library.reorderPlaylist(id, entryIds);
      reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Page>
      <header className={s.head}>
        <Collage p={p} className={s.art} />
        <div className={s.text}>
          <div className="label">Playlist</div>
          <button className={s.title} onClick={() => renamePlaylist(p).then(reload)} title="Rename">
            {p.name}
            <Icon name="edit" size={18} className={s.editIcon} />
          </button>
          <div className={`mono ${s.meta}`}>
            {plural(p.trackCount, "track")} · {longDuration(p.durationMs)}
          </div>
          <div className={s.actions}>
            <Button icon="play" disabled={!view.tracks.length} onClick={() => usePlayer.getState().playTracks(view.tracks, 0, { source: `playlist:${id}`, shuffle: false })}>
              Play
            </Button>
            <Button icon="shuffle" variant="secondary" disabled={!view.tracks.length} onClick={() => usePlayer.getState().playTracks(view.tracks, Math.floor(Math.random() * view.tracks.length), { source: `playlist:${id}`, shuffle: true })}>
              Shuffle
            </Button>
            <IconButton
              icon="more"
              label="Playlist options"
              variant="outline"
              onClick={(e) => openMenuFrom(e.currentTarget, playlistMenu(p))}
            />
          </div>
        </div>
      </header>

      {data.entries.length > 0 && (
        <div className={s.tools}>
          <label className={ts.filter}>
            <Icon name="search" size={14} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in playlist" spellCheck={false} />
          </label>
          <Segmented
            label="Sort playlist"
            value={sort}
            onChange={setSort}
            options={[
              { value: "custom", label: "Custom" },
              { value: "title", label: "Title" },
              { value: "artist", label: "Artist" },
              { value: "album", label: "Album" },
            ]}
          />
          {!canReorder && <span className={`mono ${s.note}`}>Switch to Custom order to drag tracks</span>}
        </div>
      )}

      <TrackList
        tracks={view.tracks}
        entryIds={view.entryIds}
        playlistId={id}
        columns={["index", "art", "title", "album", "duration", "fav"]}
        source={`playlist:${id}`}
        onReorder={canReorder ? reorder : undefined}
        onChanged={() => {
          reload();
          void useLibrary.getState().loadPlaylists();
        }}
        empty={<EmptyState compact title="Empty playlist" body="Right-click tracks anywhere and choose “Add to playlist”, or drag them onto this playlist in the shelf." />}
      />
    </Page>
  );
}
