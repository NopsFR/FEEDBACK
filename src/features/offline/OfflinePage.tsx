import { useEffect, useState } from "react";
import * as offline from "@/services/offline";
import { library } from "@/services/library";
import { useNav } from "@/state/nav";
import { usePlayer } from "@/features/player/store";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { EmptyState } from "@/components/EmptyState";
import { Artwork } from "@/components/Artwork";
import { bytes, plural } from "@/lib/format";
import { Page, PageHead } from "@/features/library/Page";
import { toast, toastError } from "@/state/ui";
import s from "./OfflinePage.module.css";

export function useOfflineVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const un = offline.onChange(() => setV((x) => x + 1));
    return () => {
      un();
    };
  }, []);
  return v;
}

/** What's physically on this phone, how much space it takes, and what the browser allows. */
export function OfflinePage() {
  const v = useOfflineVersion();
  const go = useNav((n) => n.go);
  const [info, setInfo] = useState<offline.StorageInfo | null>(null);
  const [albums, setAlbums] = useState<Awaited<ReturnType<typeof offline.albums>>>([]);
  useEffect(() => {
    void offline.storageInfo().then(setInfo);
    void offline.albums().then(setAlbums);
  }, [v]);
  const playlists = offline.savedPlaylists();
  const used = offline.savedBytes();

  return (
    <Page>
      <PageHead label="Library" title="On this phone" meta={`${bytes(used)} saved${info?.quota ? ` · ${bytes(info.quota)} allowed by the browser` : ""}`} />

      {info && !info.secure && (
        <p className={s.warn}>This page isn't on a secure connection, so nothing can be saved offline. Finish the certificate step from the setup page on your computer, then open the https:// address.</p>
      )}
      {info && info.secure && !info.opfs && !info.cacheApi && <p className={s.warn}>This browser doesn't offer offline storage.</p>}
      {info?.secure && (
        <div className={s.meter}>
          <div className={s.bar}>
            <span style={{ width: `${info.quota ? Math.min(100, (info.usage / info.quota) * 100) : 0}%` }} />
          </div>
          <div className={`mono ${s.meterText}`}>
            {bytes(info.usage)} used of {info.quota ? bytes(info.quota) : "unknown"} · {info.persisted ? "kept by the browser" : "may be cleared by iOS if storage runs low"}
          </div>
          {!info.persisted && (
            <Button variant="secondary" onClick={() => offline.requestPersistence().then((ok) => toast(ok ? "The browser will keep these files." : "The browser didn't agree — add FEEDBACK to your Home Screen and try again."))}>
              Ask to keep files
            </Button>
          )}
        </div>
      )}

      {!albums.length && !playlists.length ? (
        <EmptyState compact title="Nothing saved yet" body="Open an album or playlist while you're on the same Wi-Fi as your computer and choose “Save to this phone”. Saved music plays with no signal." />
      ) : (
        <>
          <ul className={s.list}>
            {albums.map((a) => (
              <li key={a.id} className={s.item}>
                <button className={s.itemMain} onClick={() => go({ name: "album", id: a.id })}>
                  <Artwork hash={a.art} size={160} seed={a.title} className={s.art} />
                  <span className={s.text}>
                    <span className="truncate">{a.title}</span>
                    <span className={`truncate ${s.sub}`}>{a.artist} · {plural(a.trackCount, "track")}</span>
                  </span>
                </button>
                <IconButton icon="play" label={`Play ${a.title}`} onClick={async () => usePlayer.getState().playTracks((await library.album(a.id)).tracks, 0, { source: `album:${a.id}` })} />
                <IconButton icon="trash" label={`Remove ${a.title} from phone`} onClick={() => offline.removeAlbum(a.id).catch(toastError)} />
              </li>
            ))}
            {playlists.map((p) => (
              <li key={`p${p.id}`} className={s.item}>
                <button className={s.itemMain} onClick={() => go({ name: "playlist", id: p.id })}>
                  <Artwork hash={null} size={160} seed={p.name} className={s.art} />
                  <span className={s.text}>
                    <span className="truncate">{p.name}</span>
                    <span className={`truncate ${s.sub}`}>Playlist · {plural(p.trackIds.length, "track")}</span>
                  </span>
                </button>
                <IconButton icon="trash" label={`Remove ${p.name} from phone`} onClick={() => offline.removePlaylist(p.id).catch(toastError)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
