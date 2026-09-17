import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { library } from "@/services/library";
import type { Track } from "@/services/types";
import { trackUrl } from "@/services/platform";
import { useLoad } from "@/lib/useLoad";
import { duration, plural } from "@/lib/format";
import { useNav } from "@/state/nav";
import { usePlayer } from "@/features/player/store";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { Slider } from "@/components/Slider";
import { EmptyState } from "@/components/EmptyState";
import { Loading, Page, PageHead } from "@/features/library/Page";
import { videoThumb } from "./thumbs";
import s from "./Videos.module.css";

interface VideoState {
  list: Track[];
  index: number;
  open: (list: Track[], index: number) => void;
  close: () => void;
  step: (d: number) => void;
}
export const useVideo = create<VideoState>((set, get) => ({
  list: [],
  index: -1,
  open: (list, index) => {
    usePlayer.getState().pause();
    set({ list, index });
  },
  close: () => set({ index: -1 }),
  step: (d) => {
    const { list, index } = get();
    const n = index + d;
    if (n >= 0 && n < list.length) set({ index: n });
  },
}));

function Thumb({ v }: { v: Track }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        io.disconnect();
        void videoThumb(v.id).then((u) => alive && setUrl(u));
      }
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [v.id]);
  return (
    <div ref={ref} className={s.thumb}>
      {url ? <img src={url} alt="" /> : <div className={s.thumbBlank}><Icon name="videos" size={28} /></div>}
      <span className={`mono ${s.len}`}>{duration(v.durationMs)}</span>
      <span className={s.playIcon}>
        <Icon name="play" size={20} />
      </span>
    </div>
  );
}

function VideoCard({ v, list, i }: { v: Track; list: Track[]; i: number }) {
  const go = useNav((n) => n.go);
  return (
    <div className={s.card}>
      <button className={s.cardBtn} onClick={() => useVideo.getState().open(list, i)} aria-label={`Play ${v.title}`}>
        <Thumb v={v} />
      </button>
      <div className={`truncate ${s.title}`}>{v.title}</div>
      <button className={`truncate ${s.artist}`} onClick={() => v.artistId && go({ name: "artist", id: v.artistId })}>
        {v.artist}
      </button>
    </div>
  );
}

export function VideoShelf({ videos }: { videos: Track[] }) {
  return (
    <div className={s.shelf}>
      {videos.map((v, i) => (
        <VideoCard key={v.id} v={v} list={videos} i={i} />
      ))}
    </div>
  );
}

export function Videos() {
  const { data } = useLoad(() => library.tracks("video"), []);
  if (!data) return <Loading />;
  return (
    <Page>
      <PageHead label="Collection" title="Music videos" meta={plural(data.length, "video")} />
      {data.length ? (
        <div className={s.grid}>
          {data.map((v, i) => (
            <VideoCard key={v.id} v={v} list={data} i={i} />
          ))}
        </div>
      ) : (
        <EmptyState compact title="No videos" body="MP4, WebM, MKV and MOV files in your music folders appear here. Name them “Artist - Title.mp4” and they'll be matched to the artist." />
      )}
    </Page>
  );
}

export function VideoPlayer() {
  const { list, index, close, step } = useVideo();
  const v = index >= 0 ? list[index] : null;
  const el = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.9);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(0);

  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else close();
      } else if (e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const x = el.current;
        if (x) x.paused ? void x.play() : x.pause();
      } else if (e.key === "ArrowRight") el.current && (el.current.currentTime += 5);
      else if (e.key === "ArrowLeft") el.current && (el.current.currentTime -= 5);
      else if (e.key === "f") toggleFs();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [v, close]);

  useEffect(() => () => {
    // dispose element resources when closing
    if (el.current) {
      el.current.pause();
      el.current.removeAttribute("src");
      el.current.load();
    }
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen();
  };
  const poke = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
  };

  if (!v) return null;
  return (
    <div ref={root} className={`${s.player} ${idle && playing ? s.idle : ""}`} onMouseMove={poke} role="dialog" aria-label={`Video: ${v.title}`}>
      <video
        key={v.id}
        ref={el}
        className={s.video}
        src={trackUrl(v.id)}
        autoPlay
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration * 1000);
          e.currentTarget.volume = vol;
        }}
        onEnded={() => (index < list.length - 1 ? step(1) : setPlaying(false))}
        onClick={() => (el.current?.paused ? void el.current.play() : el.current?.pause())}
        onDoubleClick={toggleFs}
      />
      <header className={s.pTop}>
        <div>
          <div className={s.pTitle}>{v.title}</div>
          <div className={s.pArtist}>{v.artist}</div>
        </div>
        <IconButton icon="close" label="Close video" onClick={close} />
      </header>
      <footer className={s.pBar}>
        <Slider label="Seek video" value={dur ? pos / dur : 0} onChange={(x) => el.current && (el.current.currentTime = (x * dur) / 1000)} preview={(x) => duration(x * dur)} />
        <div className={s.pControls}>
          <IconButton icon="prev" label="Previous video" disabled={index === 0} onClick={() => step(-1)} />
          <IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} size={24} onClick={() => (el.current?.paused ? void el.current.play() : el.current?.pause())} />
          <IconButton icon="next" label="Next video" disabled={index >= list.length - 1} onClick={() => step(1)} />
          <span className={`mono ${s.pTime}`}>
            {duration(pos)} / {duration(dur)}
          </span>
          <span style={{ flex: 1 }} />
          <IconButton icon={vol === 0 ? "mute" : "volume2"} label="Mute" onClick={() => { const nv = vol === 0 ? 0.9 : 0; setVol(nv); if (el.current) el.current.volume = nv; }} />
          <Slider label="Video volume" variant="volume" value={vol} onChange={(x) => { setVol(x); if (el.current) el.current.volume = x; }} className={s.pVol} />
          <IconButton icon="expand" label="Fullscreen" onClick={toggleFs} />
        </div>
      </footer>
    </div>
  );
}
