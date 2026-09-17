import { useEffect } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useLibrary } from "@/state/library";
import { useNav, type Route } from "@/state/nav";
import { Collage } from "@/features/playlists/Playlists";
import { Page, PageHead } from "./Page";
import { isTauri } from "@/services/platform";
import s from "./LibraryIndex.module.css";

const ROWS: { icon: IconName; label: string; route: Route }[] = [
  { icon: "playlist", label: "Playlists", route: { name: "playlists" } },
  { icon: "albums", label: "Albums", route: { name: "albums" } },
  { icon: "artists", label: "Artists", route: { name: "artists" } },
  { icon: "tracks", label: "Tracks", route: { name: "tracks" } },
  { icon: "genres", label: "Genres & years", route: { name: "genres" } },
  { icon: "videos", label: "Videos", route: { name: "videos" } },
  { icon: "heart", label: "Favourites", route: { name: "smart", which: "favourites" } },
  { icon: "history", label: "Recently played", route: { name: "smart", which: "history" } },
  { icon: "flame", label: "Most played", route: { name: "smart", which: "most-played" } },
];

/** Mobile "Library" tab: a plain index, like the spine labels on a shelf. */
export function LibraryIndex() {
  const go = useNav((n) => n.go);
  const overview = useLibrary((l) => l.overview);
  const playlists = useLibrary((l) => l.playlists);
  useEffect(() => {
    void useLibrary.getState().loadPlaylists();
  }, []);
  return (
    <Page>
      <PageHead label="Your music" title="Library" meta={overview ? `${overview.tracks.toLocaleString()} tracks · ${overview.albums.toLocaleString()} albums` : undefined} />
      <ul className={s.list}>
        {(isTauri ? ROWS : [{ icon: "import" as IconName, label: "On this phone", route: { name: "offline" } as Route }, ...ROWS]).map((r) => (
          <li key={r.label}>
            <button className={s.row} onClick={() => go(r.route)}>
              <Icon name={r.icon} size={22} />
              <span>{r.label}</span>
              <Icon name="chevronRight" size={18} className={s.chev} />
            </button>
          </li>
        ))}
      </ul>
      {playlists.length > 0 && (
        <div className={s.recent}>
          <div className="label">Playlists</div>
          <div className={s.pls}>
            {playlists.slice(0, 6).map((p) => (
              <button key={p.id} className={s.pl} onClick={() => go({ name: "playlist", id: p.id })}>
                <Collage p={p} className={s.plArt} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
