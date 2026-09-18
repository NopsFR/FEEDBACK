import { library } from "@/services/library";
import { confirmAction } from "@/components/Dialog";
import { useLibrary } from "@/state/library";
import { toast, toastError } from "@/state/ui";
import { plural as count } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/features/player/store";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { longDuration, plural } from "@/lib/format";
import type { SmartList } from "@/services/types";
import { TrackList, type Column } from "./TrackList";
import { Loading, Page, PageHead } from "./Page";
import p from "./Page.module.css";

const META: Record<SmartList, { title: string; empty: string; body: string; cols: Column[] }> = {
  favourites: { title: "Favourites", empty: "No favourites yet", body: "Tap the heart on anything you want to keep close.", cols: ["index", "art", "title", "album", "duration", "fav"] },
  history: { title: "Recently played", empty: "Nothing played yet", body: "Tracks you listen to show up here, newest first.", cols: ["index", "art", "title", "album", "duration", "fav"] },
  "most-played": { title: "Most played", empty: "No plays counted yet", body: "A play counts once you've heard half a track (or four minutes).", cols: ["index", "art", "title", "album", "plays", "duration", "fav"] },
  "recently-added": { title: "Recently added", empty: "Nothing added yet", body: "New files from your folders land here.", cols: ["index", "art", "title", "album", "added", "duration", "fav"] },
  missing: { title: "Missing files", empty: "Nothing missing", body: "Every track in the library is where FEEDBACK expects it.", cols: ["index", "art", "title", "album", "added", "duration"] },
};

export function SmartPage({ which }: { which: SmartList }) {
  const version = useLibrary((l) => l.version);
  const { data, reload } = useLoad(() => library.smart(which, 500), [which, version]);
  const m = META[which];
  const missing = which === "missing";
  if (!data) return <Loading />;

  /** Files the scan couldn't find: they may be on a drive that's unplugged, so nothing goes automatically. */
  const forget = async () => {
    if (!(await confirmAction("Remove missing files from the library?", `${count(data.length, "track")} will be removed from FEEDBACK. The files themselves aren't touched — if they're on a drive that isn't plugged in, plug it in and rescan instead.`, "Remove", true))) return;
    try {
      await library.removeTracks(data.map((t) => t.id));
      useLibrary.getState().invalidate();
      await useLibrary.getState().loadOverview();
      toast(`Removed ${count(data.length, "track")} from the library.`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };

  const rescan = async () => {
    try {
      await library.rescan();
      toast("Looking again…");
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Page>
      <PageHead
        label={missing ? "Library" : "Kept"}
        title={m.title}
        meta={data.length ? (missing ? `${plural(data.length, "track")} the last scan couldn't find` : `${plural(data.length, "track")} · ${longDuration(data.reduce((a, t) => a + t.durationMs, 0))}`) : undefined}
        actions={
          data.length > 0 && (missing ? (
            <>
              <Button icon="history" variant="secondary" onClick={rescan}>Look again</Button>
              <Button icon="trash" variant="secondary" onClick={forget}>Remove from library</Button>
            </>
          ) : (
            <>
              <Button icon="play" onClick={() => usePlayer.getState().playTracks(data, 0, { source: which, shuffle: false })}>
                Play
              </Button>
              <Button icon="shuffle" variant="secondary" onClick={() => usePlayer.getState().playTracks(data, Math.floor(Math.random() * data.length), { source: which, shuffle: true })}>
                Shuffle
              </Button>
            </>
          ))
        }
      />
      {missing && data.length > 0 && (
        <p className={p.note}>These files were in the library but aren't at their old paths. An unplugged drive, a rename or a move will do it — look again once it's back, or remove them here.</p>
      )}
      <TrackList tracks={data} columns={m.cols} source={which} onChanged={reload} empty={<EmptyState compact title={m.empty} body={m.body} />} />
    </Page>
  );
}
