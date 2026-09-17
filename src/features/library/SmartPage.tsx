import { library } from "@/services/library";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/features/player/store";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { longDuration, plural } from "@/lib/format";
import type { SmartList } from "@/services/types";
import { TrackList, type Column } from "./TrackList";
import { Loading, Page, PageHead } from "./Page";

const META: Record<SmartList, { title: string; empty: string; body: string; cols: Column[] }> = {
  favourites: { title: "Favourites", empty: "No favourites yet", body: "Tap the heart on anything you want to keep close.", cols: ["index", "art", "title", "album", "duration", "fav"] },
  history: { title: "Recently played", empty: "Nothing played yet", body: "Tracks you listen to show up here, newest first.", cols: ["index", "art", "title", "album", "duration", "fav"] },
  "most-played": { title: "Most played", empty: "No plays counted yet", body: "A play counts once you've heard half a track (or four minutes).", cols: ["index", "art", "title", "album", "plays", "duration", "fav"] },
  "recently-added": { title: "Recently added", empty: "Nothing added yet", body: "New files from your folders land here.", cols: ["index", "art", "title", "album", "added", "duration", "fav"] },
};

export function SmartPage({ which }: { which: SmartList }) {
  const { data, reload } = useLoad(() => library.smart(which, 500), [which]);
  const m = META[which];
  if (!data) return <Loading />;
  return (
    <Page>
      <PageHead
        label="Kept"
        title={m.title}
        meta={data.length ? `${plural(data.length, "track")} · ${longDuration(data.reduce((a, t) => a + t.durationMs, 0))}` : undefined}
        actions={
          data.length > 0 && (
            <>
              <Button icon="play" onClick={() => usePlayer.getState().playTracks(data, 0, { source: which, shuffle: false })}>
                Play
              </Button>
              <Button icon="shuffle" variant="secondary" onClick={() => usePlayer.getState().playTracks(data, Math.floor(Math.random() * data.length), { source: which, shuffle: true })}>
                Shuffle
              </Button>
            </>
          )
        }
      />
      <TrackList tracks={data} columns={m.cols} source={which} onChanged={reload} empty={<EmptyState compact title={m.empty} body={m.body} />} />
    </Page>
  );
}
