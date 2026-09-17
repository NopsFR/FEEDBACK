import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "@/state/library";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import { usePlayer } from "@/features/player/store";
import { Segmented } from "@/components/Segmented";
import { longDuration, plural } from "@/lib/format";
import { TrackList } from "./TrackList";
import { Loading, Page, PageHead } from "./Page";
import s from "./Tracks.module.css";

type Sort = "album" | "title" | "artist" | "added" | "plays" | "length";

export function Tracks() {
  const tracks = useLibrary((l) => l.tracks);
  const version = useLibrary((l) => l.version);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("album");
  useEffect(() => {
    void useLibrary.getState().loadTracks();
  }, [version]);

  const shown = useMemo(() => {
    if (!tracks) return [];
    const q = filter.trim().toLowerCase();
    let list = q ? tracks.filter((t) => `${t.title} ${t.artist} ${t.album} ${t.genre ?? ""}`.toLowerCase().includes(q)) : tracks;
    const c = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    if (sort !== "album") list = [...list];
    if (sort === "title") list.sort((a, b) => c(a.title, b.title));
    if (sort === "artist") list.sort((a, b) => c(a.artist, b.artist) || c(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0));
    if (sort === "added") list.sort((a, b) => b.addedAt - a.addedAt);
    if (sort === "plays") list.sort((a, b) => b.playCount - a.playCount);
    if (sort === "length") list.sort((a, b) => b.durationMs - a.durationMs);
    return list;
  }, [tracks, filter, sort]);

  if (!tracks) return <Loading />;
  const total = shown.reduce((a, t) => a + t.durationMs, 0);
  return (
    <Page>
      <PageHead
        label="Collection"
        title="Tracks"
        meta={`${plural(shown.length, "track")} · ${longDuration(total)}`}
        actions={
          <>
            <label className={s.filter}>
              <Icon name="search" size={14} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tracks" spellCheck={false} />
            </label>
            <Segmented
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: "album", label: "Album" },
                { value: "title", label: "Title" },
                { value: "artist", label: "Artist" },
                { value: "added", label: "Added" },
                { value: "plays", label: "Plays" },
              ]}
            />
            <Button icon="shuffle" variant="secondary" disabled={!shown.length} onClick={() => usePlayer.getState().playTracks(shown, Math.floor(Math.random() * shown.length), { shuffle: true, source: "tracks" })}>
              Shuffle
            </Button>
          </>
        }
      />
      <TrackList tracks={shown} columns={sort === "added" ? ["index", "art", "title", "album", "added", "duration", "fav"] : ["index", "art", "title", "album", "plays", "duration", "fav"]} source="tracks" />
    </Page>
  );
}
