import { useEffect, useRef, useState } from "react";
import { library } from "@/services/library";
import type { SearchResult } from "@/services/types";
import { useNav } from "@/state/nav";
import { useLibrary } from "@/state/library";
import { Icon } from "@/components/Icon";
import { Artwork } from "@/components/Artwork";
import { Section } from "@/components/Section";
import { AlbumShelf } from "@/features/library/AlbumGrid";
import { TrackList } from "@/features/library/TrackList";
import { Page } from "@/features/library/Page";
import { VideoShelf } from "@/features/videos/Videos";
import { usePlayer } from "@/features/player/store";
import { playAlbum } from "@/features/library/actions";
import { plural } from "@/lib/format";
import { CatalogueResults } from "./Catalogue";
import s from "./Search.module.css";

export function Search({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? "");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const go = useNav((n) => n.go);
  const version = useLibrary((l) => l.version);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRes(null);
      return;
    }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      library
        .search(term)
        .then((r) => alive && setRes(r))
        .catch(() => alive && setRes(null))
        .finally(() => alive && setBusy(false));
    }, 70);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, version]);

  const term = q.trim().toLowerCase();
  const topArtist = res?.artists.find((a) => a.name.toLowerCase() === term) ?? (res && !res.tracks.length ? res.artists[0] : undefined);
  const topAlbum = !topArtist ? res?.albums.find((a) => a.title.toLowerCase().startsWith(term)) : undefined;
  const nothing = res && !res.tracks.length && !res.albums.length && !res.artists.length && !res.playlists.length && !res.videos.length && !res.genres.length;

  return (
    <Page>
      <div className={s.box}>
        <Icon name="search" size={26} className={s.icon} />
        <input
          ref={input}
          className={s.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Artists, albums, tracks, genres"
          spellCheck={false}
          autoComplete="off"
          aria-label="Search"
          onKeyDown={(e) => {
            if (e.key === "Escape") setQ("");
            if (e.key === "Enter" && res?.tracks.length) usePlayer.getState().playTracks(res.tracks, 0, { source: "search" });
          }}
        />
        {q && (
          <button className={s.clear} onClick={() => (setQ(""), input.current?.focus())} aria-label="Clear search">
            <Icon name="close" size={18} />
          </button>
        )}
        <span className={`${s.busy} ${busy ? s.on : ""}`} />
      </div>

      {!q && <p className={`hand ${s.hint}`}>type anything. it's all local, it's instant.</p>}
      {nothing && (
        <p className={s.none}>
          Nothing in your library matches <strong>“{q}”</strong>.
        </p>
      )}

      {res && !nothing && (
        <div className={s.results}>
          {(topArtist || topAlbum || res.tracks.length > 0) && (
            <div className={s.top}>
              {(topArtist || topAlbum) && (
                <div className={s.topHit}>
                  <div className="label">Top result</div>
                  {topArtist ? (
                    <button className={s.topCard} onClick={() => go({ name: "artist", id: topArtist.id })}>
                      <Artwork hash={topArtist.art} size={160} seed={topArtist.name} className={s.topArt} />
                      <span className={s.topName}>{topArtist.name}</span>
                      <span className="mono">Artist · {plural(topArtist.trackCount, "track")}</span>
                    </button>
                  ) : (
                    topAlbum && (
                      <div className={s.topCard}>
                        <button onClick={() => go({ name: "album", id: topAlbum.id })}>
                          <Artwork hash={topAlbum.art} size={160} seed={topAlbum.title} className={s.topArt} />
                        </button>
                        <button className={s.topName} onClick={() => go({ name: "album", id: topAlbum.id })}>
                          {topAlbum.title}
                        </button>
                        <span className="mono">Album · {topAlbum.artist}</span>
                        <button className={s.topPlay} onClick={() => playAlbum(topAlbum)} aria-label="Play album">
                          <Icon name="play" size={18} />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
              {res.tracks.length > 0 && (
                <div className={s.topTracks}>
                  <div className="label">Tracks</div>
                  <TrackList tracks={res.tracks.slice(0, 6)} columns={["art", "title", "album", "duration", "fav"]} source="search" />
                </div>
              )}
            </div>
          )}

          {res.artists.length > 0 && (
            <Section index={1} title="Artists">
              <div className={s.artists}>
                {res.artists.map((a) => (
                  <button key={a.id} className={s.artist} onClick={() => go({ name: "artist", id: a.id })}>
                    <Artwork hash={a.art} size={160} seed={a.name} className={s.artistArt} />
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            </Section>
          )}
          {res.albums.length > 0 && (
            <Section index={2} title="Albums">
              <AlbumShelf albums={res.albums} sub="both" />
            </Section>
          )}
          {res.tracks.length > 6 && (
            <Section index={3} title={`All matching tracks (${res.tracks.length})`}>
              <TrackList tracks={res.tracks} columns={["index", "art", "title", "album", "duration", "fav"]} source="search" />
            </Section>
          )}
          {res.playlists.length > 0 && (
            <Section index={4} title="Playlists">
              <div className={s.chips}>
                {res.playlists.map((p) => (
                  <button key={p.id} className={s.chip} onClick={() => go({ name: "playlist", id: p.id })}>
                    <Icon name="playlist" size={15} /> {p.name}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {res.genres.length > 0 && (
            <Section index={5} title="Genres">
              <div className={s.chips}>
                {res.genres.map((g) => (
                  <button key={g} className={s.chip} onClick={() => go({ name: "genre", genre: g })}>
                    {g}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {res.videos.length > 0 && (
            <Section index={6} title="Videos">
              <VideoShelf videos={res.videos} />
            </Section>
          )}
          <CatalogueResults query={q} index={7} />
        </div>
      )}
      {nothing && <CatalogueResults query={q} index={1} />}
    </Page>
  );
}
