import { useEffect, useMemo, useRef, useState } from "react";
import { library } from "@/services/library";
import type { Lyrics as LyricsData, Track } from "@/services/types";
import { activeLine, parseLyrics } from "@/lib/lrc";
import { usePosition } from "./hooks";
import { usePlayer } from "./store";
import s from "./Lyrics.module.css";

export function Lyrics({ track }: { track: Track }) {
  const [data, setData] = useState<LyricsData | null | "loading">("loading");
  const { pos } = usePosition();
  const seek = usePlayer((p) => p.seek);
  const box = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(0);

  useEffect(() => {
    let alive = true;
    setData("loading");
    library
      .lyrics(track.id)
      .then((l) => alive && setData(l))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [track.id]);

  const lines = useMemo(() => (data && data !== "loading" ? parseLyrics(data.text, data.synced) : []), [data]);
  const synced = data && data !== "loading" && data.synced;
  const active = synced ? activeLine(lines, pos + 250) : -1;

  useEffect(() => {
    if (!synced || active < 0 || Date.now() - userScrolled.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (el && box.current) {
      box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight * 0.38, behavior: "smooth" });
    }
  }, [active, synced]);

  if (data === "loading") return <div className={s.state} />;
  if (!data || !lines.length)
    return (
      <div className={s.state}>
        <p className={s.none}>No lyrics for this one.</p>
        <p className={s.hint}>
          Drop a <code>.lrc</code> or <code>.txt</code> file with the same name next to the track, or embed lyrics in its tags.
        </p>
      </div>
    );

  return (
    <div ref={box} className={`${s.lyrics} ${synced ? s.synced : ""}`} onWheel={() => (userScrolled.current = Date.now())}>
      {lines.map((l, i) => (
        <p
          key={i}
          data-i={i}
          className={`${s.line} ${i === active ? s.active : ""} ${i < active ? s.past : ""} ${!l.text ? s.gap : ""}`}
          onClick={synced && l.time >= 0 ? () => seek(l.time) : undefined}
        >
          {l.text || "·"}
        </p>
      ))}
      <p className={s.source}>{data.source === "lrc" ? "Synced lyrics from .lrc" : data.source === "txt" ? "Lyrics from .txt" : "Lyrics from file tags"}</p>
    </div>
  );
}
