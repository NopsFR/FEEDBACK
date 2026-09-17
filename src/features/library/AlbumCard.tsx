import { memo } from "react";
import type { Album } from "@/services/types";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { openMenuAt } from "@/components/ContextMenu";
import { useNav } from "@/state/nav";
import { usePlayer } from "@/features/player/store";
import { albumMenu, playAlbum } from "./actions";
import s from "./AlbumCard.module.css";

export const AlbumCard = memo(function AlbumCard({ album, sub = "artist", size = 480 }: { album: Album; sub?: "artist" | "year" | "both"; size?: 160 | 480 }) {
  const go = useNav((n) => n.go);
  const playingHere = usePlayer((p) => p.queue.source === `album:${album.id}` && p.playing);
  const subline = sub === "year" ? album.year ?? "" : sub === "both" ? [album.artist, album.year].filter(Boolean).join(" · ") : album.artist;
  return (
    <div className={s.card} onContextMenu={(e) => openMenuAt(e, albumMenu(album))}>
      <button className={s.artBtn} onClick={() => go({ name: "album", id: album.id })} aria-label={`${album.title} by ${album.artist}`}>
        <Artwork hash={album.art} size={size} seed={album.title} className={s.art} />
      </button>
      <button
        className={`${s.play} ${playingHere ? s.playing : ""}`}
        aria-label={playingHere ? "Pause" : `Play ${album.title}`}
        onClick={(e) => {
          e.stopPropagation();
          if (playingHere) usePlayer.getState().pause();
          else void playAlbum(album);
        }}
      >
        <Icon name={playingHere ? "pause" : "play"} size={16} />
      </button>
      <button className={s.text} onClick={() => go({ name: "album", id: album.id })}>
        <span className={`truncate ${s.title}`}>{album.title}</span>
        <span className={`truncate ${s.sub}`}>{subline}</span>
      </button>
    </div>
  );
});
