import { library } from "@/services/library";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { usePlayer } from "@/features/player/store";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Section, TextButton } from "@/components/Section";
import { Icon } from "@/components/Icon";
import { openMenuAt } from "@/components/ContextMenu";
import { duration, longDuration, relativeDay } from "@/lib/format";
import type { Album } from "@/services/types";
import { AlbumShelf } from "./AlbumGrid";
import { Page, Loading } from "./Page";
import { albumMenu, playAlbum, trackMenu } from "./actions";
import { chooseMusicFolder } from "./importMusic";
import { VideoShelf } from "@/features/videos/Videos";
import s from "./Home.module.css";

function Feature({ album, kicker, note }: { album: Album; kicker: string; note: string }) {
  const go = useNav((n) => n.go);
  return (
    <div className={s.feature} onContextMenu={(e) => openMenuAt(e, albumMenu(album))}>
      <button className={s.featureArt} onClick={() => go({ name: "album", id: album.id })} aria-label={album.title}>
        <Artwork hash={album.art} seed={album.title} eager />
      </button>
      <div className={s.featureText}>
        <span className="label">{kicker}</span>
        <button className={s.featureTitle} onClick={() => go({ name: "album", id: album.id })}>
          {album.title}
        </button>
        <button className={s.featureArtist} onClick={() => album.artistId && go({ name: "artist", id: album.artistId })}>
          {album.artist}
        </button>
        <div className={`mono ${s.featureMeta}`}>
          {[album.year, `${album.trackCount} tracks`, longDuration(album.durationMs), album.lastPlayedAt ? `last played ${relativeDay(album.lastPlayedAt)}` : null].filter(Boolean).join("  ·  ")}
        </div>
        <div className={s.featureActions}>
          <Button icon="play" onClick={() => playAlbum(album)}>
            Play
          </Button>
          <Button icon="shuffle" variant="secondary" onClick={() => playAlbum(album, { shuffle: true })}>
            Shuffle
          </Button>
          <p className={`hand ${s.featureNote}`}>{note}</p>
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const overview = useLibrary((l) => l.overview);
  const scan = useLibrary((l) => l.scan);
  const go = useNav((n) => n.go);
  const { data } = useLoad(() => library.home(), []);

  if (overview && overview.tracks === 0 && overview.videos === 0) {
    const scanning = scan && scan.phase !== "done";
    return (
      <Page>
        <EmptyState
          title={scanning ? "Reading your music" : "The shelf is empty"}
          body={
            scanning
              ? "FEEDBACK is going through your folders. Albums will appear here as they're read."
              : "Point FEEDBACK at the folder where your music lives. Files stay where they are — nothing gets uploaded, moved or converted."
          }
          action={
            !scanning && (
              <>
                <Button icon="folder" onClick={chooseMusicFolder}>
                  Import music
                </Button>
                <Button variant="secondary" onClick={() => go({ name: "settings", section: "library" })}>
                  Library settings
                </Button>
              </>
            )
          }
          note={scanning ? undefined : "louder things last longer."}
        />
      </Page>
    );
  }
  if (!data) return <Loading />;

  const resume = data.recentlyPlayed[0];
  const pick = data.randomAlbums[0];
  const featured = resume ?? pick;
  let n = 1;

  return (
    <Page>
      <div className={s.masthead}>
        {overview && (
          <span className="mono">
            {overview.tracks.toLocaleString()} tracks · {overview.albums.toLocaleString()} albums · {overview.artists.toLocaleString()} artists · {longDuration(overview.durationMs)}
          </span>
        )}
      </div>

      {featured && (
        <Feature
          album={featured}
          kicker={resume ? "Pick up where you left off" : "Pulled from the shelf"}
          note={resume ? "put it back on." : "when did you last hear this one?"}
        />
      )}

      {data.recentlyPlayed.length > 1 && (
        <Section index={n++} title="Recently played">
          <AlbumShelf albums={data.recentlyPlayed.slice(1)} />
        </Section>
      )}

      {data.recentlyAdded.length > 0 && (
        <Section index={n++} title="Recently added" action={<TextButton onClick={() => go({ name: "albums" })}>All albums</TextButton>}>
          <AlbumShelf albums={data.recentlyAdded} />
        </Section>
      )}

      {data.mostPlayed.length > 0 && (
        <Section index={n++} title="On repeat" action={<TextButton onClick={() => go({ name: "smart", which: "most-played" })}>Most played</TextButton>}>
          <ol className={s.setlist}>
            {data.mostPlayed.slice(0, 10).map((t, i) => (
              <li key={t.id}>
                <button
                  className={s.setItem}
                  onClick={() => usePlayer.getState().playTracks(data.mostPlayed, i, { source: "most-played" })}
                  onContextMenu={(e) => openMenuAt(e, trackMenu([t]))}
                >
                  <span className={s.setN}>{String(i + 1).padStart(2, "0")}</span>
                  <Artwork hash={t.art} size={160} seed={t.album} className={s.setArt} />
                  <span className={s.setMeta}>
                    <span className="truncate">{t.title}</span>
                    <span className={`truncate ${s.setArtist}`}>{t.artist}</span>
                  </span>
                  <span className={`mono ${s.setPlays}`}>{t.playCount}×</span>
                  <span className={`mono ${s.setDur}`}>{duration(t.durationMs)}</span>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {data.forgotten.length > 0 && (
        <Section index={n++} title="Haven't played in a while">
          <AlbumShelf albums={data.forgotten} sub="both" />
        </Section>
      )}

      {data.randomAlbums.length > 1 && (
        <Section
          index={n++}
          title="From the back of the shelf"
          action={
            <button className={s.dice} onClick={() => useLibrary.getState().invalidate()} title="Pull different albums">
              <Icon name="shuffle" size={14} /> Reshuffle
            </button>
          }
        >
          <AlbumShelf albums={data.randomAlbums.filter((a) => a.id !== featured?.id)} sub="both" />
        </Section>
      )}

      {data.genres.length > 0 && (
        <Section index={n++} title="Genres" action={<TextButton onClick={() => go({ name: "genres" })}>All genres</TextButton>}>
          <div className={s.genres}>
            {data.genres.slice(0, 14).map((g, i) => (
              <button key={g.name} className={s.genre} data-weight={i < 3 ? 1 : i < 7 ? 2 : 3} onClick={() => go({ name: "genre", genre: g.name })}>
                {g.name}
                <sup className="mono">{g.albumCount}</sup>
              </button>
            ))}
          </div>
        </Section>
      )}

      {data.videos.length > 0 && (
        <Section index={n++} title="Music videos" action={<TextButton onClick={() => go({ name: "videos" })}>All videos</TextButton>}>
          <VideoShelf videos={data.videos} />
        </Section>
      )}
    </Page>
  );
}
