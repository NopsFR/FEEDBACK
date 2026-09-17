import { library } from "@/services/library";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/features/player/store";
import { useAmbient } from "@/features/player/ambient";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Section } from "@/components/Section";
import { openMenuFrom } from "@/components/ContextMenu";
import { EmptyState } from "@/components/EmptyState";
import { audioSpec, longDuration, plural } from "@/lib/format";
import { useNav } from "@/state/nav";
import { AlbumShelf } from "./AlbumGrid";
import { TrackList } from "./TrackList";
import { Loading, Page } from "./Page";
import { albumMenu } from "./actions";
import s from "./AlbumPage.module.css";

export function AlbumPage({ id }: { id: number }) {
  const { data, error } = useLoad(() => library.album(id), [id]);
  const go = useNav((n) => n.go);
  const amb = useAmbient(data?.album.art);
  const playing = usePlayer((p) => p.queue.source === `album:${id}` && p.playing);

  if (error) return <Page><EmptyState compact title="Album not found" body={error} /></Page>;
  if (!data) return <Loading />;
  const { album, tracks, moreByArtist } = data;
  const specs = [...new Set(tracks.map((t) => t.codec).filter(Boolean))];
  const first = tracks[0];
  const discs = new Set(tracks.map((t) => t.discNo ?? 1)).size;

  return (
    <div className={s.wrap} style={{ ["--a" as string]: amb.a, ["--b" as string]: amb.b }}>
      <div className={s.glow} aria-hidden />
      <Page>
        <header className={s.head}>
          <div className={s.art}>
            <Artwork hash={album.art} seed={album.title} eager />
          </div>
          <div className={s.text}>
            <div className="label">Album{album.year ? ` · ${album.year}` : ""}{album.genre ? ` · ${album.genre}` : ""}</div>
            <h1 className={s.title} data-long={album.title.length > 22 ? "" : undefined}>
              {album.title}
            </h1>
            <button className={s.artist} onClick={() => album.artistId && go({ name: "artist", id: album.artistId })}>
              {album.artist}
            </button>
            <div className={`mono ${s.meta}`}>
              {plural(album.trackCount, "track")} · {longDuration(album.durationMs)}
              {discs > 1 ? ` · ${discs} discs` : ""}
              {specs.length === 1 && first ? ` · ${audioSpec(first)}` : specs.length > 1 ? ` · ${specs.join(" / ")}` : ""}
            </div>
            <div className={s.actions}>
              <Button icon={playing ? "pause" : "play"} onClick={() => (playing ? usePlayer.getState().pause() : usePlayer.getState().playTracks(tracks, 0, { source: `album:${id}`, shuffle: false }))}>
                {playing ? "Pause" : "Play"}
              </Button>
              <Button icon="shuffle" variant="secondary" onClick={() => usePlayer.getState().playTracks(tracks, Math.floor(Math.random() * tracks.length), { source: `album:${id}`, shuffle: true })}>
                Shuffle
              </Button>
              <IconButton icon="more" label="More" variant="outline" onClick={(e) => openMenuFrom(e.currentTarget, albumMenu(album))} />
            </div>
          </div>
        </header>

        <TrackList tracks={tracks} columns={["index", "title", "duration", "fav"]} numbering="track" source={`album:${id}`} discHeaders albumArtist={album.artist} />

        {moreByArtist.length > 0 && (
          <Section index={1} title={`More by ${album.artist}`} className={s.more}>
            <AlbumShelf albums={moreByArtist} sub="year" />
          </Section>
        )}
      </Page>
    </div>
  );
}
