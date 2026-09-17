import { useEffect, useRef, useState } from "react";
import { Stage } from "../Stage";
import { Icon, type IconName } from "@/components/Icon";
import { Artwork } from "@/components/Artwork";
import { useNav, type Route } from "@/state/nav";
import { useUi } from "@/state/ui";
import { usePlayer } from "@/features/player/store";
import { usePosition } from "@/features/player/hooks";
import { MobilePlayer } from "./MobilePlayer";
import s from "./MobileShell.module.css";

const TABS: { icon: IconName; label: string; route: Route; match: (r: Route) => boolean }[] = [
  { icon: "home", label: "Home", route: { name: "home" }, match: (r) => r.name === "home" },
  { icon: "search", label: "Search", route: { name: "search" }, match: (r) => r.name === "search" },
  { icon: "albums", label: "Library", route: { name: "library" }, match: (r) => !["home", "search", "settings"].includes(r.name) },
  { icon: "settings", label: "Settings", route: { name: "settings" }, match: (r) => r.name === "settings" },
];

function MiniPlayer() {
  const current = usePlayer((p) => p.current);
  const playing = usePlayer((p) => p.playing);
  const { pos, dur } = usePosition();
  const open = useUi((u) => u.setNowPlaying);
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!current) return null;
  const pct = dur ? pos / dur : 0;
  return (
    <div
      className={s.mini}
      onTouchStart={(e) => (start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const st = start.current;
        if (!st) return;
        const dx = e.changedTouches[0].clientX - st.x;
        const dy = e.changedTouches[0].clientY - st.y;
        if (dy < -40 && Math.abs(dy) > Math.abs(dx)) open(true);
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? usePlayer.getState().next() : usePlayer.getState().prev());
        start.current = null;
      }}
    >
      <div className={s.miniProgress} style={{ transform: `scaleX(${pct})` }} />
      <button className={s.miniMain} onClick={() => open(true)} aria-label="Open player">
        <Artwork hash={current.art} size={160} seed={current.album} className={s.miniArt} />
        <span className={s.miniText}>
          <span className="truncate">{current.title}</span>
          <span className={`truncate ${s.miniArtist}`}>{current.artist}</span>
        </span>
      </button>
      <button className={s.miniBtn} onClick={() => usePlayer.getState().toggle()} aria-label={playing ? "Pause" : "Play"}>
        <Icon name={playing ? "pause" : "play"} size={22} />
      </button>
      <button className={s.miniBtn} onClick={() => usePlayer.getState().next()} aria-label="Next">
        <Icon name="next" size={20} />
      </button>
    </div>
  );
}

export function MobileShell() {
  const route = useNav((n) => n.route);
  const go = useNav((n) => n.go);
  const npOpen = useUi((u) => u.nowPlayingOpen);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = document.querySelector("main");
    if (!el) return;
    const on = () => setScrolled(el.scrollTop > 8);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);
  return (
    <div className={`${s.shell} ${scrolled ? s.scrolled : ""}`}>
      <div className={s.topbar}>
        {useNav.getState().canBack && !["home", "search", "library", "settings"].includes(route.name) ? (
          <button className={s.back} onClick={() => useNav.getState().back()} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className={s.stage}>
        <Stage />
      </div>
      <MiniPlayer />
      <nav className={s.tabs} aria-label="Sections">
        {TABS.map((t) => {
          const on = t.match(route);
          return (
            <button key={t.label} className={`${s.tab} ${on ? s.tabOn : ""}`} onClick={() => go(t.route)} aria-current={on ? "page" : undefined}>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
      {npOpen && <MobilePlayer />}
    </div>
  );
}
