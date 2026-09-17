import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Track } from "@/services/types";
import { usePlayer } from "@/features/player/store";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { useStageScroll } from "@/app/stageContext";
import { openMenuAt } from "@/components/ContextMenu";
import { Icon } from "@/components/Icon";
import { Artwork } from "@/components/Artwork";
import { Playing } from "@/components/Playing";
import { duration } from "@/lib/format";
import { toggleFavourite, trackMenu } from "./actions";
import { useLongPress } from "@/lib/useLongPress";
import s from "./TrackList.module.css";

export type Column = "index" | "art" | "title" | "album" | "plays" | "added" | "duration" | "fav";

interface Props {
  tracks: Track[];
  columns?: Column[];
  /** Source label for the queue ("album:12", "playlist:3") */
  source?: string;
  /** Use track numbers from tags for the index column (album view) */
  numbering?: "position" | "track";
  /** Playlist mode: entry ids parallel to tracks + reorder */
  entryIds?: number[];
  playlistId?: number;
  onReorder?: (entryIds: number[]) => void;
  onChanged?: () => void;
  discHeaders?: boolean;
  empty?: React.ReactNode;
  /** Hide the per-row artist when it matches this name (album pages) */
  albumArtist?: string;
}

const ROW = 46;

export function TrackList({ tracks, columns = ["index", "title", "album", "duration", "fav"], source, numbering = "position", entryIds, playlistId, onReorder, onChanged, discHeaders, empty, albumArtist }: Props) {
  const scroll = useStageScroll();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number>(-1);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const currentId = usePlayer((p) => p.current?.id);
  const playing = usePlayer((p) => p.playing);
  const favs = useLibrary((l) => l.favourites);

  // Rows: optionally interleave disc headers
  const rows = useMemo(() => {
    const out: ({ kind: "track"; i: number } | { kind: "disc"; disc: number })[] = [];
    const multiDisc = discHeaders && new Set(tracks.map((t) => t.discNo ?? 1)).size > 1;
    let lastDisc = -1;
    tracks.forEach((t, i) => {
      const d = t.discNo ?? 1;
      if (multiDisc && d !== lastDisc) {
        out.push({ kind: "disc", disc: d });
        lastDisc = d;
      }
      out.push({ kind: "track", i });
    });
    return out;
  }, [tracks, discHeaders]);

  useLayoutEffect(() => {
    const el = listRef.current;
    const sc = scroll.current;
    if (!el || !sc) return;
    const measure = () => setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc.firstElementChild ?? sc);
    return () => ro.disconnect();
  }, [scroll]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: (i) => (rows[i].kind === "disc" ? 40 : ROW),
    overscan: 12,
    scrollMargin: margin,
  });

  useEffect(() => setSelected(new Set()), [tracks]);

  const play = useCallback(
    (i: number) => {
      usePlayer.getState().playTracks(tracks, i, { source });
    },
    [tracks, source],
  );

  const onRowClick = (e: MouseEvent, i: number) => {
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      const next = new Set<number>(e.ctrlKey || e.metaKey ? selected : []);
      for (let k = a; k <= b; k++) next.add(k);
      setSelected(next);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      setSelected(next);
      anchor.current = i;
    } else {
      setSelected(new Set([i]));
      anchor.current = i;
    }
  };

  const onContext = (e: MouseEvent, i: number) => {
    let sel = selected;
    if (!selected.has(i)) {
      sel = new Set([i]);
      setSelected(sel);
      anchor.current = i;
    }
    const idx = [...sel].sort((a, b) => a - b);
    const ts = idx.map((k) => tracks[k]);
    openMenuAt(e, trackMenu(ts, { playlistId, entryIds: entryIds ? idx.map((k) => entryIds[k]) : undefined, onRemoved: onChanged }));
  };

  const onKey = (e: KeyboardEvent) => {
    const idx = [...selected].sort((a, b) => a - b);
    const last = idx.at(-1) ?? -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.min(tracks.length - 1, Math.max(0, last + (e.key === "ArrowDown" ? 1 : -1)));
      setSelected(new Set([n]));
      anchor.current = n;
      const rowIndex = rows.findIndex((r) => r.kind === "track" && r.i === n);
      v.scrollToIndex(rowIndex, { align: "auto" });
    } else if (e.key === "Enter" && last >= 0) {
      e.preventDefault();
      play(last);
    } else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected(new Set(tracks.map((_, i) => i)));
    } else if (e.key === "Escape") setSelected(new Set());
  };

  // Drag: reorder within playlists; otherwise drag tracks out (to playlists in the shelf)
  const onDragStart = (e: DragEvent, i: number) => {
    let sel = selected;
    if (!selected.has(i)) {
      sel = new Set([i]);
      setSelected(sel);
    }
    const ids = [...sel].sort((a, b) => a - b).map((k) => tracks[k].id);
    e.dataTransfer.setData("application/x-feedback-tracks", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = onReorder ? "copyMove" : "copy";
    const ghost = document.createElement("div");
    ghost.className = s.ghost;
    ghost.textContent = ids.length === 1 ? tracks[i].title : `${ids.length} tracks`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 16);
    setTimeout(() => ghost.remove(), 0);
    if (onReorder) setDragFrom(i);
  };
  const onDragOverRow = (e: DragEvent, i: number) => {
    if (dragFrom === null || !onReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOver(e.clientY < r.top + r.height / 2 ? i : i + 1);
  };
  const onDrop = (e: DragEvent) => {
    if (dragFrom === null || dragOver === null || !onReorder || !entryIds) return;
    e.preventDefault();
    const moving = [...selected].sort((a, b) => a - b);
    const order = entryIds.map((id, i) => ({ id, i }));
    const moved = order.filter((o) => moving.includes(o.i));
    const rest = order.filter((o) => !moving.includes(o.i));
    const insertAt = rest.filter((o) => o.i < dragOver).length;
    const final = [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)].map((o) => o.id);
    onReorder(final);
    setDragFrom(null);
    setDragOver(null);
  };

  if (!tracks.length) return <>{empty ?? null}</>;

  const W: Record<Column, string> = { index: "44px", art: "40px", title: "minmax(180px, 1.6fr)", album: "minmax(120px, 1fr)", plays: "56px", added: "110px", duration: "64px", fav: "36px" };
  const cols = columns.map((c) => W[c]).join(" ");
  const narrow = columns.filter((c) => c !== "album" && c !== "added" && c !== "plays").map((c) => W[c]).join(" ");
  return (
    <div className={s.list} style={{ ["--cols" as string]: cols, ["--cols-narrow" as string]: narrow }}>
      <div className={s.header} role="row">
        {columns.includes("index") && <span className={s.idx}>#</span>}
        {columns.includes("art") && <span />}
        <span>Title</span>
        {columns.includes("album") && <span className={s.wide}>Album</span>}
        {columns.includes("plays") && <span className={`${s.right} ${s.wide}`}>Plays</span>}
        {columns.includes("added") && <span className={s.wide}>Added</span>}
        {columns.includes("duration") && (
          <span className={s.right}>
            <Icon name="history" size={14} />
          </span>
        )}
        {columns.includes("fav") && <span />}
      </div>
      <div
        ref={listRef}
        role="grid"
        aria-rowcount={tracks.length}
        tabIndex={0}
        className={s.body}
        onKeyDown={onKey}
        onDrop={onDrop}
        onDragEnd={() => {
          setDragFrom(null);
          setDragOver(null);
        }}
        style={{ height: v.getTotalSize() }}
      >
        {v.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          const top = vi.start - margin;
          if (row.kind === "disc")
            return (
              <div key={`d${row.disc}`} className={s.disc} style={{ transform: `translateY(${top}px)` }}>
                <Icon name="disc" size={14} /> Disc {row.disc}
              </div>
            );
          const t = tracks[row.i];
          return (
            <Row
              key={entryIds ? entryIds[row.i] : `${t.id}-${row.i}`}
              t={t}
              i={row.i}
              top={top}
              columns={columns}
              number={numbering === "track" ? t.trackNo : row.i + 1}
              selected={selected.has(row.i)}
              current={t.id === currentId}
              playing={playing}
              fav={favs.has(t.id) || t.favourite}
              hideArtist={!!albumArtist && t.artist === albumArtist}
              dropBefore={dragOver === row.i}
              dropAfter={dragOver === row.i + 1 && row.i === tracks.length - 1}
              onClick={onRowClick}
              onDouble={play}
              onContext={onContext}
              onDragStart={onDragStart}
              onDragOver={onDragOverRow}
            />
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  t: Track;
  i: number;
  top: number;
  columns: Column[];
  number?: number;
  selected: boolean;
  current: boolean;
  playing: boolean;
  fav: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  hideArtist?: boolean;
  onClick: (e: MouseEvent, i: number) => void;
  onDouble: (i: number) => void;
  onContext: (e: MouseEvent, i: number) => void;
  onDragStart: (e: DragEvent, i: number) => void;
  onDragOver: (e: DragEvent, i: number) => void;
}

const Row = memo(function Row({ t, i, top, columns, number, selected, current, playing, fav, dropBefore, dropAfter, hideArtist, onClick, onDouble, onContext, onDragStart, onDragOver }: RowProps) {
  const go = useNav((n) => n.go);
  const long = useLongPress((x, y) => onContext({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent, i));
  return (
    <div
      {...long}
      role="row"
      aria-selected={selected}
      className={`${s.row} ${selected ? s.selected : ""} ${current ? s.current : ""} ${t.missing ? s.missing : ""} ${dropBefore ? s.dropBefore : ""} ${dropAfter ? s.dropAfter : ""}`}
      style={{ transform: `translateY(${top}px)` }}
      onClick={(e) => onClick(e, i)}
      onDoubleClick={() => onDouble(i)}
      onContextMenu={(e) => onContext(e, i)}
      draggable
      onDragStart={(e) => onDragStart(e, i)}
      onDragOver={(e) => onDragOver(e, i)}
    >
      {columns.includes("index") && (
        <span className={s.idx}>
          <span className={s.num}>{current ? <Playing active={playing} /> : number ?? "–"}</span>
          <button
            className={s.playBtn}
            aria-label={`Play ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              if (current) usePlayer.getState().toggle();
              else onDouble(i);
            }}
          >
            <Icon name={current && playing ? "pause" : "play"} size={14} />
          </button>
        </span>
      )}
      {columns.includes("art") && <Artwork hash={t.art} size={160} seed={t.album} className={s.thumb} />}
      <span className={s.titleCell}>
        <span className={`truncate ${s.title}`}>{t.title}</span>
        {!hideArtist && <span className={`truncate ${s.artist}`}>
          {t.artistId ? (
            <a
              onClick={(e) => {
                e.stopPropagation();
                go({ name: "artist", id: t.artistId! });
              }}
            >
              {t.artist}
            </a>
          ) : (
            t.artist
          )}
        </span>}
      </span>
      {columns.includes("album") && (
        <span className={`truncate ${s.album} ${s.wide}`}>
          {t.albumId ? (
            <a
              onClick={(e) => {
                e.stopPropagation();
                go({ name: "album", id: t.albumId! });
              }}
            >
              {t.album}
            </a>
          ) : (
            t.album
          )}
        </span>
      )}
      {columns.includes("plays") && <span className={`mono ${s.right} ${s.dim} ${s.wide}`}>{t.playCount || ""}</span>}
      {columns.includes("added") && <span className={`mono ${s.dim} ${s.wide}`}>{new Date(t.addedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</span>}
      {columns.includes("duration") && <span className={`mono ${s.right} ${s.dim}`}>{duration(t.durationMs)}</span>}
      {columns.includes("fav") && (
        <button
          className={`${s.fav} ${fav ? s.favOn : ""}`}
          aria-label={fav ? "Remove from favourites" : "Favourite"}
          aria-pressed={fav}
          onClick={(e) => {
            e.stopPropagation();
            void toggleFavourite(t, !fav);
          }}
        >
          <Icon name={fav ? "heartFill" : "heart"} size={15} />
        </button>
      )}
    </div>
  );
});
