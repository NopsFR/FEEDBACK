import { useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Album } from "@/services/types";
import { useStageScroll } from "@/app/stageContext";
import { AlbumCard } from "./AlbumCard";
import s from "./AlbumGrid.module.css";

/** Virtualised responsive album grid. */
export function AlbumGrid({ albums, min = 176, sub = "artist" }: { albums: Album[]; min?: number; sub?: "artist" | "year" | "both" }) {
  const scroll = useStageScroll();
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(5);
  const [width, setWidth] = useState(1000);
  const [margin, setMargin] = useState(0);
  const gap = 28;

  useLayoutEffect(() => {
    const el = ref.current;
    const sc = scroll.current;
    if (!el || !sc) return;
    const measure = () => {
      const w = el.clientWidth;
      setWidth(w);
      setCols(Math.max(2, Math.floor((w + gap) / (min + gap))));
      setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroll, min]);

  const colW = (width - gap * (cols - 1)) / cols;
  const rowH = colW + 58 + gap;
  const rows = Math.ceil(albums.length / cols);
  const v = useVirtualizer({ count: rows, getScrollElement: () => scroll.current, estimateSize: () => rowH, overscan: 3, scrollMargin: margin });
  useLayoutEffect(() => v.measure(), [rowH, v]);

  return (
    <div ref={ref} className={s.grid} style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((row) => (
        <div key={row.index} className={s.row} style={{ transform: `translateY(${row.start - margin}px)`, gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
          {albums.slice(row.index * cols, row.index * cols + cols).map((a) => (
            <AlbumCard key={a.id} album={a} sub={sub} size={colW > 170 ? 480 : 160} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Horizontal shelf row (non-virtualised; for short lists on Home/Artist). */
export function AlbumShelf({ albums, sub = "artist" }: { albums: Album[]; sub?: "artist" | "year" | "both" }) {
  return (
    <div className={s.shelf}>
      {albums.map((a) => (
        <div key={a.id} className={s.shelfItem}>
          <AlbumCard album={a} sub={sub} />
        </div>
      ))}
    </div>
  );
}
