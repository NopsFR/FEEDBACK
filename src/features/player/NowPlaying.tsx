import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./store";
import { usePosition } from "./hooks";
import { useAmbient } from "./ambient";
import { Lyrics } from "./Lyrics";
import { Visualiser } from "./Visualiser";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { Slider } from "@/components/Slider";
import { Playing } from "@/components/Playing";
import { openMenuAt, openMenuFrom } from "@/components/ContextMenu";
import { artUrl } from "@/services/platform";
import { audioSpec, duration } from "@/lib/format";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { useUi, type MenuItem } from "@/state/ui";
import { useSettings } from "@/state/settings";
import { toggleFavourite, trackMenu } from "@/features/library/actions";
import s from "./NowPlaying.module.css";

type Tab = "lyrics" | "queue" | "details";

function BigTimeline() {
  const { pos, dur } = usePosition();
  const seek = usePlayer((p) => p.seek);
  const cur = usePlayer((p) => p.current);
  const total = dur || cur?.durationMs || 0;
  const [scrub, setScrub] = useState<number | null>(null);
  return (
    <div className={s.timeline}>
      <Slider
        label="Seek"
        value={scrub ?? (total ? pos / total : 0)}
        onChange={setScrub}
        onCommit={(v) => {
          setScrub(null);
          seek(v * total);
        }}
        preview={(v) => duration(v * total)}
        step={total ? 5000 / total : 0.02}
      />
      <div className={s.times}>
        <span className="mono">{duration(scrub != null ? scrub * total : pos)}</span>
        <span className="mono">-{duration(Math.max(0, total - (scrub != null ? scrub * total : pos)))}</span>
      </div>
    </div>
  );
}

function sleepMenu(): MenuItem[] {
  const { setSleep, sleepAt } = usePlayer.getState();
  return [
    ...[15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, run: () => setSleep(m) })),
    { label: "End of this track", run: () => setSleep("track") },
    ...(sleepAt ? [{ label: "", separator: true }, { label: "Cancel sleep timer", danger: true, run: () => setSleep(null) }] : []),
  ];
}

export function NowPlaying() {
  const open = useUi((u) => u.nowPlayingOpen);
  const setOpen = useUi((u) => u.setNowPlaying);
  const current = usePlayer((p) => p.current);
  const playing = usePlayer((p) => p.playing);
  const queue = usePlayer((p) => p.queue);
  const sleepAt = usePlayer((p) => p.sleepAt);
  const { toggle, next, prev, toggleShuffle, cycleRepeat, jumpTo } = usePlayer.getState();
  const favs = useLibrary((l) => l.favourites);
  const go = useNav((n) => n.go);
  const showVis = useSettings((st) => st.visualiser);
  const ambientOn = useSettings((st) => st.ambientArtwork);
  const amb = useAmbient(ambientOn ? current?.art : null);
  const [tab, setTab] = useState<Tab>("lyrics");
  const [artFull, setArtFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--ambient-a", amb.a);
    document.documentElement.style.setProperty("--ambient-b", amb.b);
  }, [amb]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useUi.getState().menu && !useUi.getState().dialog) {
        if (artFull) setArtFull(false);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, artFull, setOpen]);

  useEffect(() => {
    if (current && !current.hasLyrics && tab === "lyrics") setTab("queue");
    if (current?.hasLyrics) setTab("lyrics");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!open || !current) return null;
  const fav = favs.has(current.id) || current.favourite;
  const upNext = queue.items.slice(queue.index + 1, queue.index + 30);
  const source = queue.source?.startsWith("album:") ? "Album" : queue.source?.startsWith("playlist:") ? "Playlist" : null;
  const bg = artUrl(current.art, 160);

  return (
    <div ref={root} className={s.root} style={{ ["--a" as string]: amb.a, ["--b" as string]: amb.b }} role="dialog" aria-label="Now playing">
      <div className={s.bg} aria-hidden>
        {bg && <div className={s.blur} style={{ backgroundImage: `url(${bg})` }} key={bg} />}
        <div className={s.wash} />
        <div className={s.scratch} />
      </div>

      <header className={s.top}>
        <IconButton icon="chevronDown" label="Close now playing" onClick={() => setOpen(false)} />
        <div className={s.from}>
          {source && <span className="label">Playing from {source}</span>}
          <button className={`truncate ${s.fromName}`} onClick={() => (current.albumId ? (setOpen(false), go({ name: "album", id: current.albumId })) : undefined)}>
            {current.album}
          </button>
        </div>
        <div className={s.topRight}>
          <IconButton icon="moon" label={sleepAt ? "Sleep timer on" : "Sleep timer"} active={!!sleepAt} onClick={(e) => openMenuFrom(e.currentTarget, sleepMenu())} />
          <IconButton icon="more" label="More" onClick={(e) => openMenuFrom(e.currentTarget, trackMenu([current]))} />
        </div>
      </header>

      <div className={s.stage}>
        <section className={s.left}>
          <button className={s.artWrap} onClick={() => setArtFull(true)} aria-label="View full artwork" onContextMenu={(e) => openMenuAt(e, trackMenu([current]))}>
            <Artwork key={current.id} hash={current.art} size={480} seed={current.album} className={`${s.art} ${playing ? s.artPlaying : ""}`} eager />
          </button>

          <div className={s.meta}>
            <h1 className={s.title}>{current.title}</h1>
            <div className={s.byline}>
              <button onClick={() => current.artistId && (setOpen(false), go({ name: "artist", id: current.artistId }))}>{current.artist}</button>
              {current.year && <span className={s.dot}>{current.year}</span>}
            </div>
            <div className={`mono ${s.spec}`}>{audioSpec(current)}</div>
          </div>

          <BigTimeline />

          <div className={s.controls}>
            <IconButton icon="shuffle" label="Shuffle" active={queue.shuffle} onClick={toggleShuffle} size={20} />
            <IconButton icon="prev" label="Previous" onClick={prev} size={26} className={s.skip} />
            <button className={s.play} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
              <Icon name={playing ? "pause" : "play"} size={28} />
            </button>
            <IconButton icon="next" label="Next" onClick={next} size={26} className={s.skip} />
            <IconButton icon={queue.repeat === "one" ? "repeatOne" : "repeat"} label="Repeat" active={queue.repeat !== "off"} onClick={cycleRepeat} size={20} />
            <span className={s.spacer} />
            <IconButton icon={fav ? "heartFill" : "heart"} label="Favourite" className={fav ? s.favOn : ""} onClick={() => void toggleFavourite(current, !fav)} size={20} />
          </div>
        </section>

        <section className={s.right}>
          <nav className={s.tabs} role="tablist">
            {(["lyrics", "queue", "details"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`${s.tab} ${tab === t ? s.tabOn : ""}`} onClick={() => setTab(t)}>
                {t === "lyrics" ? "Lyrics" : t === "queue" ? "Up next" : "Details"}
              </button>
            ))}
          </nav>
          <div className={s.panel}>
            {tab === "lyrics" && <Lyrics track={current} />}
            {tab === "queue" && (
              <ol className={s.upnext}>
                {upNext.length ? (
                  upNext.map((it, k) => (
                    <li key={it.uid}>
                      <button className={s.upItem} onClick={() => jumpTo(queue.index + 1 + k)} onContextMenu={(e) => openMenuAt(e, trackMenu([it.track]))}>
                        <span className={`mono ${s.upN}`}>{String(k + 1).padStart(2, "0")}</span>
                        <Artwork hash={it.track.art} size={160} seed={it.track.album} className={s.upArt} />
                        <span className={s.upMeta}>
                          <span className="truncate">{it.track.title}</span>
                          <span className={`truncate ${s.upArtist}`}>{it.track.artist}</span>
                        </span>
                        <span className={`mono ${s.upDur}`}>{duration(it.track.durationMs)}</span>
                      </button>
                    </li>
                  ))
                ) : (
                  <p className={s.nothing}>End of the queue{queue.repeat === "all" ? " — it'll start again from the top." : "."}</p>
                )}
              </ol>
            )}
            {tab === "details" && (
              <dl className={s.details}>
                {[
                  ["Title", current.title],
                  ["Artist", current.artist],
                  ["Album", current.album],
                  ["Album artist", current.albumArtist],
                  ["Track", current.trackNo ? `${current.trackNo}${current.discNo ? ` · disc ${current.discNo}` : ""}` : "—"],
                  ["Year", current.year ?? "—"],
                  ["Genre", current.genre ?? "—"],
                  ["Length", duration(current.durationMs)],
                  ["Format", audioSpec(current) || "—"],
                  ["Channels", current.channels === 1 ? "Mono" : current.channels === 2 ? "Stereo" : current.channels ?? "—"],
                  ["Plays", current.playCount],
                  ["ReplayGain", current.rgTrack != null ? `${current.rgTrack.toFixed(2)} dB track${current.rgAlbum != null ? ` · ${current.rgAlbum.toFixed(2)} dB album` : ""}` : "—"],
                ].map(([k, v]) => (
                  <div key={k as string} className={s.row}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>
      </div>

      {showVis && (
        <div className={s.vis}>
          <Visualiser className={s.visCanvas} bars={120} />
          <span className={s.visPlaying}>
            <Playing active={playing} />
          </span>
        </div>
      )}

      {artFull && (
        <div className={s.full} onClick={() => setArtFull(false)} role="dialog" aria-label="Artwork">
          {artUrl(current.art, 0) ? <img src={artUrl(current.art, 0)!} alt={`${current.album} artwork`} crossOrigin="anonymous" /> : <Artwork hash={null} seed={current.album} className={s.fullFallback} />}
        </div>
      )}
    </div>
  );
}
