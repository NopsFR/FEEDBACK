import { useRef, useState, type TouchEvent } from "react";
import { usePlayer } from "@/features/player/store";
import { usePosition } from "@/features/player/hooks";
import { useAmbient } from "@/features/player/ambient";
import { Lyrics } from "@/features/player/Lyrics";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { Slider } from "@/components/Slider";
import { duration, audioSpec } from "@/lib/format";
import { useLibrary } from "@/state/library";
import { useUi } from "@/state/ui";
import { toggleFavourite, trackMenu } from "@/features/library/actions";
import { openActionSheet } from "@/components/ActionSheet";
import s from "./MobilePlayer.module.css";

type Panel = "art" | "lyrics" | "queue";

/** Full-screen touch player: swipe the art for next/previous, drag down to close. */
export function MobilePlayer() {
  const current = usePlayer((p) => p.current);
  const playing = usePlayer((p) => p.playing);
  const queue = usePlayer((p) => p.queue);
  const { toggle, next, prev, seek, toggleShuffle, cycleRepeat, jumpTo } = usePlayer.getState();
  const { pos, dur } = usePosition();
  const favs = useLibrary((l) => l.favourites);
  const favOverrides = useLibrary((l) => l.favouriteOverrides);
  const close = () => useUi.getState().setNowPlaying(false);
  const amb = useAmbient(current?.art);
  const [panel, setPanel] = useState<Panel>("art");
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const t0 = useRef<{ x: number; y: number; time: number; axis: "x" | "y" | null } | null>(null);

  if (!current) return null;
  const total = dur || current.durationMs;
  const fav = favOverrides[current.id] ?? (favs.has(current.id) || current.favourite);

  const onStart = (e: TouchEvent) => {
    t0.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now(), axis: null };
  };
  const onMove = (e: TouchEvent) => {
    const st = t0.current;
    if (!st) return;
    const dx = e.touches[0].clientX - st.x;
    const dy = e.touches[0].clientY - st.y;
    if (!st.axis && Math.hypot(dx, dy) > 10) st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (st.axis === "x" && panel === "art") setDrag({ x: dx, y: 0 });
    if (st.axis === "y" && dy > 0) setDrag({ x: 0, y: dy });
  };
  const onEnd = () => {
    const st = t0.current;
    t0.current = null;
    if (!st) return;
    const fast = Date.now() - st.time < 250;
    if (st.axis === "y" && (drag.y > 140 || (fast && drag.y > 50))) close();
    else if (st.axis === "x" && (Math.abs(drag.x) > 90 || (fast && Math.abs(drag.x) > 40))) (drag.x < 0 ? next() : prev());
    setDrag({ x: 0, y: 0 });
  };

  return (
    <div
      className={s.sheet}
      style={{ transform: drag.y ? `translateY(${drag.y}px)` : undefined, ["--a" as string]: amb.a, ["--b" as string]: amb.b }}
      role="dialog"
      aria-label="Now playing"
    >
      <div className={s.bg} aria-hidden />
      <header className={s.head} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
        <IconButton icon="chevronDown" label="Close player" onClick={close} size={24} />
        <div className={s.grab} />
        <IconButton icon="more" label="More" size={22} onClick={() => openActionSheet(current.title, trackMenu([current]))} />
      </header>

      <div className={s.body}>
        {panel === "art" && (
          <div className={s.artZone} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
            <div className={s.art} style={{ transform: drag.x ? `translateX(${drag.x}px) rotate(${drag.x / 40}deg)` : undefined }}>
              <Artwork key={current.id} hash={current.art} seed={current.album} eager className={playing ? "" : s.paused} />
            </div>
          </div>
        )}
        {panel === "lyrics" && (
          <div className={s.panel}>
            <Lyrics track={current} />
          </div>
        )}
        {panel === "queue" && (
          <ol className={`${s.panel} ${s.queue}`}>
            {queue.items.slice(queue.index + 1, queue.index + 60).map((it, k) => (
              <li key={it.uid}>
                <button className={s.qItem} onClick={() => jumpTo(queue.index + 1 + k)}>
                  <Artwork hash={it.track.art} size={160} seed={it.track.album} className={s.qArt} />
                  <span className={s.qText}>
                    <span className="truncate">{it.track.title}</span>
                    <span className={`truncate ${s.qArtist}`}>{it.track.artist}</span>
                  </span>
                </button>
              </li>
            ))}
            {queue.items.length - queue.index - 1 <= 0 && <p className={s.empty}>Nothing up next.</p>}
          </ol>
        )}
      </div>

      <div className={s.meta}>
        <div className={s.titles}>
          <h1 className={s.title}>{current.title}</h1>
          <p className={`truncate ${s.artist}`}>{current.artist}</p>
        </div>
        <button className={`${s.fav} ${fav ? s.favOn : ""}`} onClick={() => void toggleFavourite(current, !fav)} aria-label="Favourite">
          <Icon name={fav ? "heartFill" : "heart"} size={26} />
        </button>
      </div>

      <div className={s.time}>
        <Slider
          label="Seek"
          value={scrub ?? (total ? pos / total : 0)}
          onChange={setScrub}
          onCommit={(v) => {
            setScrub(null);
            seek(v * total);
          }}
          step={total ? 5000 / total : 0.02}
          className={s.slider}
        />
        <div className={s.times}>
          <span className="mono">{duration(scrub != null ? scrub * total : pos)}</span>
          <span className={`mono ${s.spec}`}>{audioSpec(current)}</span>
          <span className="mono">-{duration(Math.max(0, total - pos))}</span>
        </div>
      </div>

      <div className={s.controls}>
        <IconButton icon="shuffle" label="Shuffle" active={queue.shuffle} onClick={toggleShuffle} size={22} className={s.side} />
        <button className={s.skip} onClick={prev} aria-label="Previous">
          <Icon name="prev" size={32} />
        </button>
        <button className={s.play} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} size={34} />
        </button>
        <button className={s.skip} onClick={next} aria-label="Next">
          <Icon name="next" size={32} />
        </button>
        <IconButton icon={queue.repeat === "one" ? "repeatOne" : "repeat"} label="Repeat" active={queue.repeat !== "off"} onClick={cycleRepeat} size={22} className={s.side} />
      </div>

      <nav className={s.switch}>
        <button className={panel === "lyrics" ? s.on : ""} onClick={() => setPanel(panel === "lyrics" ? "art" : "lyrics")} aria-pressed={panel === "lyrics"}>
          <Icon name="lyrics" size={22} />
        </button>
        <button className={panel === "queue" ? s.on : ""} onClick={() => setPanel(panel === "queue" ? "art" : "queue")} aria-pressed={panel === "queue"}>
          <Icon name="queue" size={22} />
        </button>
      </nav>
    </div>
  );
}
