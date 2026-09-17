import { library } from "@/services/library";
import { useLoad } from "@/lib/useLoad";
import { useNav } from "@/state/nav";
import { plural } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { AlbumGrid } from "./AlbumGrid";
import { Loading, Page, PageHead } from "./Page";
import s from "./Genres.module.css";

export function Genres() {
  const { data } = useLoad(() => library.genres(), []);
  const { data: albums } = useLoad(() => library.albums(), []);
  const go = useNav((n) => n.go);
  if (!data || !albums) return <Loading />;
  const years = [...new Set(albums.map((a) => a.year).filter((y): y is number => !!y))].sort((a, b) => b - a);
  const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))];
  return (
    <Page>
      <PageHead label="Collection" title="Genres & years" meta={`${plural(data.length, "genre")} · ${plural(years.length, "year")}`} />
      {data.length ? (
        <ul className={s.list}>
          {data.map((g) => (
            <li key={g.name}>
              <button className={s.genre} onClick={() => go({ name: "genre", genre: g.name })}>
                <span className={s.name}>{g.name}</span>
                <span className={`mono ${s.count}`}>
                  {plural(g.albumCount, "album")} · {plural(g.trackCount, "track")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="No genres tagged" body="Genre tags from your files show up here." />
      )}
      {decades.length > 0 && (
        <div className={s.years}>
          {decades.map((d) => (
            <div key={d} className={s.decade}>
              <span className={s.dLabel}>{d}s</span>
              <div className={s.yearRow}>
                {years
                  .filter((y) => Math.floor(y / 10) * 10 === d)
                  .map((y) => (
                    <button key={y} className={`mono ${s.year}`} onClick={() => go({ name: "year", year: y })}>
                      {y}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

export function GenrePage({ genre, year }: { genre?: string; year?: number }) {
  const { data } = useLoad(() => library.albumsBy({ genre, year }), [genre, year]);
  if (!data) return <Loading />;
  return (
    <Page>
      <PageHead label={genre ? "Genre" : "Year"} title={genre ?? String(year)} meta={plural(data.length, "album")} />
      <AlbumGrid albums={data} sub={genre ? "both" : "artist"} />
    </Page>
  );
}
