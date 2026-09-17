import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { useStageScroll } from "@/app/stageContext";
import { Artwork } from "@/components/Artwork";
import { plural } from "@/lib/format";
import { Loading, Page, PageHead } from "./Page";
import type { Artist } from "@/services/types";
import s from "./Artists.module.css";

type Row = { kind: "letter"; letter: string } | { kind: "artist"; a: Artist };

const letterOf = (name: string) => {
  const n = name.replace(/^the\s+/i, "").trim();
  const c = n.charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

/** Artist index: set like the index pages of a record shop catalogue, not a grid of circles. */
export function Artists() {
  const artists = useLibrary((l) => l.artists);
  const version = useLibrary((l) => l.version);
  const go = useNav((n) => n.go);
  const scroll = useStageScroll();
  const ref = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  useEffect(() => {
    void useLibrary.getState().loadArtists();
  }, [version]);

  const rows = useMemo<Row[]>(() => {
    if (!artists) return [];
    const out: Row[] = [];
    let last = "";
    for (const a of artists) {
      const l = letterOf(a.name);
      if (l !== last) {
        out.push({ kind: "letter", letter: l });
        last = l;
      }
      out.push({ kind: "artist", a });
    }
    return out;
  }, [artists]);
  const letters = useMemo(() => rows.flatMap((r, i) => (r.kind === "letter" ? [{ l: r.letter, i }] : [])), [rows]);

  useLayoutEffect(() => {
    const el = ref.current;
    const sc = scroll.current;
    if (!el || !sc) return;
    setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
  }, [scroll, artists]);

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: (i) => (rows[i].kind === "letter" ? 70 : 64), overscan: 10, scrollMargin: margin });

  if (!artists) return <Loading />;
  return (
    <Page>
      <PageHead label="Collection" title="Artists" meta={plural(artists.length, "artist")} />
      <nav className={s.jump} aria-label="Jump to letter">
        {letters.map(({ l, i }) => (
          <button key={l} onClick={() => v.scrollToIndex(i, { align: "start" })}>
            {l}
          </button>
        ))}
      </nav>
      <div ref={ref} className={s.list} style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => {
          const r = rows[vi.index];
          const y = vi.start - margin;
          if (r.kind === "letter")
            return (
              <div key={`l${r.letter}`} className={s.letter} style={{ transform: `translateY(${y}px)` }}>
                {r.letter}
              </div>
            );
          return (
            <button key={r.a.id} className={s.row} style={{ transform: `translateY(${y}px)` }} onClick={() => go({ name: "artist", id: r.a.id })}>
              <Artwork hash={r.a.art} size={160} seed={r.a.name} className={s.art} />
              <span className={`truncate ${s.name}`}>{r.a.name}</span>
              <span className={`mono ${s.count}`}>{r.a.albumCount ? plural(r.a.albumCount, "album") : ""}</span>
              <span className={`mono ${s.count}`}>{plural(r.a.trackCount, "track")}</span>
            </button>
          );
        })}
      </div>
    </Page>
  );
}
