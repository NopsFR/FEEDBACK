import { useEffect, useLayoutEffect, useRef } from "react";
import { routeKey, useNav } from "@/state/nav";
import { StageScrollContext } from "./stageContext";
import { Home } from "@/features/library/Home";
import { Albums } from "@/features/library/Albums";
import { AlbumPage } from "@/features/library/AlbumPage";
import { Artists } from "@/features/library/Artists";
import { ArtistPage } from "@/features/library/ArtistPage";
import { Tracks } from "@/features/library/Tracks";
import { GenrePage, Genres } from "@/features/library/Genres";
import { SmartPage } from "@/features/library/SmartPage";
import { Search } from "@/features/search/Search";
import { Playlists } from "@/features/playlists/Playlists";
import { PlaylistPage } from "@/features/playlists/PlaylistPage";
import { Videos } from "@/features/videos/Videos";
import { Settings } from "@/features/settings/Settings";
import s from "./App.module.css";

function View() {
  const r = useNav((n) => n.route);
  switch (r.name) {
    case "home":
      return <Home />;
    case "search":
      return <Search initial={r.q} />;
    case "albums":
      return <Albums />;
    case "album":
      return <AlbumPage id={r.id} />;
    case "artists":
      return <Artists />;
    case "artist":
      return <ArtistPage id={r.id} />;
    case "tracks":
      return <Tracks />;
    case "genres":
      return <Genres />;
    case "genre":
      return <GenrePage genre={r.genre} />;
    case "year":
      return <GenrePage year={r.year} />;
    case "videos":
      return <Videos />;
    case "playlists":
      return <Playlists />;
    case "playlist":
      return <PlaylistPage id={r.id} />;
    case "smart":
      return <SmartPage which={r.which} />;
    case "settings":
      return <Settings section={r.section} />;
  }
}

/** Scrollable content region. Saves scroll per history entry and restores it on back/forward. */
export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const route = useNav((n) => n.route);
  const index = useNav((n) => n.index);
  const key = routeKey(route);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const entry = useNav.getState().stack[index];
    const target = entry?.scroll ?? 0;
    // Wait a frame for lists to size themselves, then restore.
    el.scrollTop = target;
    const raf = requestAnimationFrame(() => (el.scrollTop = target));
    return () => cancelAnimationFrame(raf);
  }, [key, index]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t = 0;
    const onScroll = () => {
      cancelAnimationFrame(t);
      t = requestAnimationFrame(() => useNav.getState().saveScroll(el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <StageScrollContext.Provider value={ref}>
      <main ref={ref} className={s.stage} tabIndex={-1}>
        <div key={key}>
          <View />
        </div>
      </main>
    </StageScrollContext.Provider>
  );
}
