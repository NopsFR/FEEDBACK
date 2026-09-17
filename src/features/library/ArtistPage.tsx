import { library } from "@/services/library";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/features/player/store";
import { useAmbient } from "@/features/player/ambient";
import { Button } from "@/components/Button";
import { Section } from "@/components/Section";
import { EmptyState } from "@/components/EmptyState";
import { AlbumCard } from "./AlbumCard";
import { AlbumShelf } from "./AlbumGrid";
import { TrackList } from "./TrackList";
import { Loading, Page } from "./Page";
import { longDuration, plural } from "@/lib/format";
import { toastError } from "@/state/ui";
import { VideoShelf } from "@/features/videos/Videos";
import s from "./ArtistPage.module.css";

export function ArtistPage({ id }: { id: number }) {
  const { data, error } = useLoad(() => library.artist(id), [id]);
  const art = data?.albums.find((a) => a.art)?.art ?? data?.appearsOn.find((a) => a.art)?.art;
  const amb = useAmbient(art);

  if (error) return <Page><EmptyState compact title="Artist not found" body={error} /></Page>;
  if (!data) return <Loading />;

  const playAll = async (shuffle: boolean) => {
    try {
      const details = await Promise.all(data.albums.map((a) => library.album(a.id)));
      const tracks = details.flatMap((d) => d.tracks);
      const all = tracks.length ? tracks : data.topTracks;
      usePlayer.getState().playTracks(all, shuffle ? Math.floor(Math.random() * all.length) : 0, { shuffle, source: `artist:${id}` });
    } catch (e) {
      toastError(e);
    }
  };

  const byYear = [...data.albums].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  return (
    <div className={s.wrap} style={{ ["--a" as string]: amb.a }}>
      <div className={s.glow} aria-hidden />
      <Page>
        <header className={s.head}>
          <div className="label">Artist</div>
          <h1 className={s.name} data-len={data.name.length > 18 ? "long" : data.name.length > 11 ? "mid" : "short"}>
            {data.name}
          </h1>
          <div className={s.rule}>
            <span className="mono">
              {data.albums.length ? `${plural(data.albums.length, "album")} · ` : ""}
              {plural(data.trackCount, "track")} · {longDuration(data.durationMs)}
            </span>
          </div>
          <div className={s.actions}>
            <Button icon="play" onClick={() => playAll(false)}>
              Play
            </Button>
            <Button icon="shuffle" variant="secondary" onClick={() => playAll(true)}>
              Shuffle
            </Button>
          </div>
        </header>

        {data.topTracks.length > 0 && (
          <Section index={1} title="Most played">
            <TrackList tracks={data.topTracks.slice(0, 5)} columns={["index", "art", "title", "album", "duration", "fav"]} source={`artist:${id}`} />
          </Section>
        )}

        {byYear.length > 0 && (
          <Section index={2} title="Discography">
            <ol className={s.timeline}>
              {byYear.map((a) => (
                <li key={a.id} className={s.release}>
                  <span className={s.year}>{a.year ?? "—"}</span>
                  <AlbumCard album={a} sub="year" />
                </li>
              ))}
            </ol>
          </Section>
        )}

        {data.appearsOn.length > 0 && (
          <Section index={3} title="Appears on">
            <AlbumShelf albums={data.appearsOn} sub="both" />
          </Section>
        )}

        {data.videos.length > 0 && (
          <Section index={4} title="Videos">
            <VideoShelf videos={data.videos} />
          </Section>
        )}
      </Page>
    </div>
  );
}
