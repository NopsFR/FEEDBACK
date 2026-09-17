import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "@/state/library";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { plural } from "@/lib/format";
import { AlbumGrid } from "./AlbumGrid";
import { Loading, Page, PageHead } from "./Page";
import { Segmented } from "@/components/Segmented";
import { chooseMusicFolder } from "./importMusic";

type Sort = "artist" | "title" | "year" | "added" | "played";

export function Albums() {
  const albums = useLibrary((l) => l.albums);
  const version = useLibrary((l) => l.version);
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("feedback.albums.sort") as Sort) || "artist");
  useEffect(() => {
    void useLibrary.getState().loadAlbums();
  }, [version]);
  useEffect(() => {
    try {
      localStorage.setItem("feedback.albums.sort", sort);
    } catch {
      /* ignore */
    }
  }, [sort]);

  const sorted = useMemo(() => {
    if (!albums) return [];
    const a = [...albums];
    const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base" });
    if (sort === "title") a.sort((x, y) => cmp(x.title, y.title));
    else if (sort === "year") a.sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || cmp(x.artist, y.artist));
    else if (sort === "added") a.sort((x, y) => y.addedAt - x.addedAt);
    else if (sort === "played") a.sort((x, y) => (y.lastPlayedAt ?? 0) - (x.lastPlayedAt ?? 0));
    return a;
  }, [albums, sort]);

  if (!albums) return <Loading />;
  return (
    <Page>
      <PageHead
        label="Collection"
        title="Albums"
        meta={plural(albums.length, "album")}
        actions={
          <Segmented
            label="Sort albums"
            value={sort}
            onChange={setSort}
            options={[
              { value: "artist", label: "Artist" },
              { value: "title", label: "Title" },
              { value: "year", label: "Year" },
              { value: "added", label: "Added" },
              { value: "played", label: "Played" },
            ]}
          />
        }
      />
      {albums.length ? (
        <AlbumGrid albums={sorted} sub={sort === "year" ? "both" : "artist"} />
      ) : (
        <EmptyState compact title="No albums yet" body="Add a music folder and albums will be put on the shelf." action={<Button icon="folder" onClick={chooseMusicFolder}>Import music</Button>} />
      )}
    </Page>
  );
}
