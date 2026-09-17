import { useState, type DragEvent } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { promptText } from "@/components/Dialog";
import { openMenuAt } from "@/components/ContextMenu";
import { useLibrary } from "@/state/library";
import { useNav, type Route } from "@/state/nav";
import { toast, toastError, useUi } from "@/state/ui";
import { library } from "@/services/library";
import { playlistMenu } from "@/features/playlists/actions";
import { editSmartPlaylist } from "@/features/playlists/SmartPlaylistEditor";
import s from "./Shelf.module.css";

interface Item {
  icon: IconName;
  label: string;
  route: Route;
  match: (r: Route) => boolean;
}

const LISTEN: Item[] = [
  { icon: "home", label: "Home", route: { name: "home" }, match: (r) => r.name === "home" },
  { icon: "search", label: "Search", route: { name: "search" }, match: (r) => r.name === "search" },
];
const COLLECTION: Item[] = [
  { icon: "albums", label: "Albums", route: { name: "albums" }, match: (r) => r.name === "albums" || r.name === "album" },
  { icon: "artists", label: "Artists", route: { name: "artists" }, match: (r) => r.name === "artists" || r.name === "artist" },
  { icon: "tracks", label: "Tracks", route: { name: "tracks" }, match: (r) => r.name === "tracks" },
  { icon: "genres", label: "Genres", route: { name: "genres" }, match: (r) => r.name === "genres" || r.name === "genre" || r.name === "year" },
  { icon: "videos", label: "Videos", route: { name: "videos" }, match: (r) => r.name === "videos" },
];
const KEPT: Item[] = [
  { icon: "heart", label: "Favourites", route: { name: "smart", which: "favourites" }, match: (r) => r.name === "smart" && r.which === "favourites" },
  { icon: "history", label: "Recently played", route: { name: "smart", which: "history" }, match: (r) => r.name === "smart" && r.which === "history" },
  { icon: "flame", label: "Most played", route: { name: "smart", which: "most-played" }, match: (r) => r.name === "smart" && r.which === "most-played" },
  { icon: "recent", label: "Recently added", route: { name: "smart", which: "recently-added" }, match: (r) => r.name === "smart" && r.which === "recently-added" },
];

function Group({ n, title, items }: { n: string; title: string; items: Item[] }) {
  const route = useNav((x) => x.route);
  const go = useNav((x) => x.go);
  const collapsed = useUi((u) => u.shelfCollapsed);
  return (
    <div className={s.group}>
      <div className={s.groupHead}>
        <span className={s.n}>{n}</span>
        {!collapsed && <span>{title}</span>}
      </div>
      {items.map((it) => {
        const active = it.match(route);
        return (
          <button key={it.label} className={`${s.item} ${active ? s.active : ""}`} onClick={() => go(it.route)} title={collapsed ? it.label : undefined} aria-current={active ? "page" : undefined}>
            <Icon name={it.icon} size={18} />
            {!collapsed && <span className="truncate">{it.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Shelf() {
  const collapsed = useUi((u) => u.shelfCollapsed);
  const toggle = useUi((u) => u.toggleShelf);
  const playlists = useLibrary((l) => l.playlists);
  const scan = useLibrary((l) => l.scan);
  const overview = useLibrary((l) => l.overview);
  const route = useNav((x) => x.route);
  const go = useNav((x) => x.go);
  const [dropId, setDropId] = useState<number | null>(null);

  const create = async () => {
    const name = await promptText("New playlist", { placeholder: "Name", confirm: "Create" });
    if (!name) return;
    try {
      const id = await library.createPlaylist(name);
      await useLibrary.getState().loadPlaylists();
      go({ name: "playlist", id });
    } catch (e) {
      toastError(e);
    }
  };

  const onDrop = async (e: DragEvent, id: number, name: string) => {
    setDropId(null);
    const raw = e.dataTransfer.getData("application/x-feedback-tracks");
    if (!raw) return;
    e.preventDefault();
    try {
      const ids = JSON.parse(raw) as number[];
      await library.addToPlaylist(id, ids);
      await useLibrary.getState().loadPlaylists();
      toast(ids.length === 1 ? `Added to “${name}”` : `Added ${ids.length} tracks to “${name}”`);
    } catch (err) {
      toastError(err);
    }
  };

  const scanning = scan && scan.phase !== "done";
  return (
    <nav className={`${s.shelf} ${collapsed ? s.collapsed : ""}`} aria-label="Library">
      <div className={s.scroll}>
        <Group n="01" title="Listen" items={LISTEN} />
        <Group n="02" title="Collection" items={COLLECTION} />
        <Group n="03" title="Kept" items={KEPT} />
        <div className={s.group}>
          <div className={s.groupHead}>
            <span className={s.n}>04</span>
            {!collapsed && <span>Playlists</span>}
            {!collapsed && (
              <button className={s.add} onClick={create} aria-label="New playlist" title="New playlist">
                <Icon name="plus" size={14} />
              </button>
            )}
          </div>
          {collapsed && (
            <button className={s.item} onClick={() => go({ name: "playlists" })} title="Playlists">
              <Icon name="playlist" size={18} />
            </button>
          )}
          {!collapsed &&
            playlists.map((p) => {
              const active = route.name === "playlist" && route.id === p.id;
              return (
                <button
                  key={p.id}
                  className={`${s.pl} ${active ? s.active : ""} ${dropId === p.id ? s.drop : ""}`}
                  onClick={() => go({ name: "playlist", id: p.id })}
                  onContextMenu={(e) => openMenuAt(e, playlistMenu(p))}
                  onDragOver={(e) => {
                    if (p.rules) return;
                    if (e.dataTransfer.types.includes("application/x-feedback-tracks")) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setDropId(p.id);
                    }
                  }}
                  onDragLeave={() => setDropId(null)}
                  onDrop={(e) => onDrop(e, p.id, p.name)}
                >
                  <span className="truncate">{p.name}</span>
                  <span className={s.count}>{p.rules ? "AUTO" : p.trackCount}</span>
                </button>
              );
            })}
          {!collapsed && <button className={s.emptyPl} onClick={() => editSmartPlaylist()}><Icon name="playlist" size={14} /> New smart playlist</button>}
          {!collapsed && !playlists.length && (
            <button className={s.emptyPl} onClick={create}>
              Make your first playlist
            </button>
          )}
        </div>
      </div>
      <div className={s.foot}>
        {!collapsed && (
          <div className={s.status} aria-live="polite">
            {scanning ? (
              <>
                <span className={s.scanDot} />
                <span className="truncate">
                  {scan.phase === "walking" ? "Looking for music…" : scan.phase === "reading" ? `Reading ${scan.done.toLocaleString()} / ${scan.total.toLocaleString()}` : "Tidying up…"}
                </span>
              </>
            ) : overview ? (
              <span className="truncate mono">
                {overview.tracks.toLocaleString()} tracks · {overview.albums.toLocaleString()} albums
              </span>
            ) : null}
          </div>
        )}
        <div className={s.footBtns}>
          <button className={`${s.item} ${route.name === "settings" ? s.active : ""}`} onClick={() => go({ name: "settings" })} title="Settings">
            <Icon name="settings" size={18} />
            {!collapsed && <span>Settings</span>}
          </button>
          <button className={s.collapse} onClick={toggle} aria-label={collapsed ? "Expand shelf" : "Collapse shelf"} title={collapsed ? "Expand" : "Collapse"}>
            <Icon name="sidebar" size={16} />
          </button>
        </div>
        {scanning && scan.total > 0 && <div className={s.progress} style={{ transform: `scaleX(${scan.done / Math.max(1, scan.total)})` }} />}
      </div>
    </nav>
  );
}
