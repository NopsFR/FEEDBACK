import { useState } from "react";
import { usePlayer } from "./store";
import { usePosition } from "./hooks";
import { Artwork } from "@/components/Artwork";
import { IconButton } from "@/components/IconButton";
import { Slider } from "@/components/Slider";
import { Icon } from "@/components/Icon";
import { openMenuAt } from "@/components/ContextMenu";
import { duration } from "@/lib/format";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";
import { toggleFavourite, trackMenu } from "@/features/library/actions";
import s from "./Transport.module.css";

function Timeline() {
  const { pos, dur } = usePosition();
  const seek = usePlayer((p) => p.seek);
  const current = usePlayer((p) => p.current);
  const total = dur || current?.durationMs || 0;
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? (total ? pos / total : 0);
  return (
    <div className={s.timeline}>
      <span className="mono">{duration(scrub != null ? scrub * total : pos)}</span>
      <Slider
        label="Seek"
        value={shown}
        valueText={`${duration(pos)} of ${duration(total)}`}
        onChange={setScrub}
        onCommit={(v) => {
          setScrub(null);
          seek(v * total);
        }}
        preview={(v) => duration(v * total)}
        step={total ? 5000 / total : 0.02}
      />
      <span className="mono">{duration(total)}</span>
    </div>
  );
}

function Volume() {
  const volume = usePlayer((p) => p.volume);
  const muted = usePlayer((p) => p.muted);
  const setVolume = usePlayer((p) => p.setVolume);
  const toggleMute = usePlayer((p) => p.toggleMute);
  const v = muted ? 0 : volume;
  const icon = v === 0 ? "mute" : v < 0.34 ? "volume0" : v < 0.67 ? "volume1" : "volume2";
  return (
    <div className={s.volume}>
      <IconButton icon={icon} label={muted ? "Unmute" : "Mute"} onClick={toggleMute} size={19} />
      <Slider label="Volume" variant="volume" value={v} onChange={setVolume} valueText={`${Math.round(v * 100)}%`} step={0.05} className={s.volSlider} />
    </div>
  );
}

export function Transport() {
  const current = usePlayer((p) => p.current);
  const playing = usePlayer((p) => p.playing);
  const buffering = usePlayer((p) => p.buffering);
  const queue = usePlayer((p) => p.queue);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const favs = useLibrary((l) => l.favourites);
  const go = useNav((n) => n.go);
  const { queueOpen, toggleQueue, nowPlayingOpen, setNowPlaying } = useUi();
  const fav = current ? favs.has(current.id) || current.favourite : false;

  return (
    <footer className={`${s.bar} ${current ? "" : s.idle}`}>
      <div className={s.now}>
        {current ? (
          <>
            <button className={s.artBtn} onClick={() => setNowPlaying(!nowPlayingOpen)} aria-label="Open now playing">
              <Artwork key={current.art ?? current.album} hash={current.art} size={160} seed={current.album} className={s.art} />
              <span className={s.artHint}>
                <Icon name={nowPlayingOpen ? "chevronDown" : "chevronUp"} size={16} />
              </span>
            </button>
            <div className={s.meta} onContextMenu={(e) => openMenuAt(e, trackMenu([current]))}>
              <button className={`truncate ${s.title}`} onClick={() => current.albumId && go({ name: "album", id: current.albumId })}>
                {current.title}
              </button>
              <button className={`truncate ${s.artist}`} onClick={() => current.artistId && go({ name: "artist", id: current.artistId })}>
                {current.artist}
              </button>
            </div>
            <IconButton icon={fav ? "heartFill" : "heart"} label={fav ? "Remove from favourites" : "Favourite"} size={17} className={fav ? s.favOn : ""} onClick={() => void toggleFavourite(current, !fav)} />
          </>
        ) : (
          <div className={s.nothing}>
            <span className="label">Nothing playing</span>
          </div>
        )}
      </div>

      <div className={s.center}>
        <div className={s.controls}>
          <IconButton icon="shuffle" label={queue.shuffle ? "Shuffle on" : "Shuffle off"} active={queue.shuffle} onClick={toggleShuffle} size={18} />
          <IconButton icon="prev" label="Previous" onClick={prev} size={20} disabled={!current} />
          <button className={`${s.play} ${buffering ? s.buffering : ""}`} onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!current && !queue.items.length}>
            <Icon name={playing ? "pause" : "play"} size={20} />
          </button>
          <IconButton icon="next" label="Next" onClick={next} size={20} disabled={!current} />
          <IconButton
            icon={queue.repeat === "one" ? "repeatOne" : "repeat"}
            label={queue.repeat === "off" ? "Repeat off" : queue.repeat === "all" ? "Repeat all" : "Repeat one"}
            active={queue.repeat !== "off"}
            onClick={cycleRepeat}
            size={18}
          />
        </div>
        <Timeline />
      </div>

      <div className={s.right}>
        <IconButton icon="lyrics" label="Lyrics" size={19} disabled={!current} active={nowPlayingOpen} onClick={() => setNowPlaying(!nowPlayingOpen)} />
        <IconButton icon="queue" label="Queue" size={19} active={queueOpen} onClick={() => toggleQueue()} badge={queue.items.length - queue.index - 1 > 0 ? String(Math.min(99, queue.items.length - queue.index - 1)) : undefined} />
        <Volume />
        <IconButton icon={nowPlayingOpen ? "collapse" : "expand"} label={nowPlayingOpen ? "Close now playing" : "Now playing"} size={17} disabled={!current} onClick={() => setNowPlaying(!nowPlayingOpen)} />
      </div>
    </footer>
  );
}
