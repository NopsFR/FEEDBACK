import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Titlebar } from "./Titlebar";
import { Shelf } from "./Shelf";
import { Stage } from "./Stage";
import { Intro } from "./Intro";
import { useShortcuts } from "./shortcuts";
import { Transport } from "@/features/player/Transport";
import { NowPlaying } from "@/features/player/NowPlaying";
import { usePlayer } from "@/features/player/store";
import { QueuePanel } from "@/features/queue/QueuePanel";
import { VideoPlayer } from "@/features/videos/Videos";
import { importDropped } from "@/features/library/importMusic";
import { ContextMenuHost } from "@/components/ContextMenu";
import { DialogHost } from "@/components/Dialog";
import { Toasts } from "@/components/Toasts";
import { Icon } from "@/components/Icon";
import { useLibrary } from "@/state/library";
import { useSettings } from "@/state/settings";
import { isTauri } from "@/services/platform";
import type { ScanProgress } from "@/services/types";
import { log } from "@/lib/log";
import s from "./App.module.css";

function useBackendEvents() {
  useEffect(() => {
    if (!isTauri) return;
    const uns: Promise<() => void>[] = [];
    let changeTimer = 0;
    uns.push(
      listen<ScanProgress>("scan-progress", (e) => {
        useLibrary.getState().setScan(e.payload);
      }),
    );
    uns.push(
      listen("library-changed", () => {
        clearTimeout(changeTimer);
        changeTimer = window.setTimeout(() => useLibrary.getState().invalidate(), 250);
      }),
    );
    return () => uns.forEach((u) => void u.then((f) => f()));
  }, []);
}

function useDropImport() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter") setOver(p.paths.length > 0);
      else if (p.type === "leave") setOver(false);
      else if (p.type === "drop") {
        setOver(false);
        if (p.paths.length) void importDropped(p.paths);
      }
    });
    return () => void un.then((f) => f());
  }, []);
  return over;
}

export function App() {
  const [booted, setBooted] = useState(false);
  const introMode = useSettings((st) => st.intro);
  const [introDone, setIntroDone] = useState(introMode === "off");
  useBackendEvents();
  useShortcuts();
  const dropping = useDropImport();

  useEffect(() => {
    // Load everything in parallel with the intro — the intro never delays readiness.
    Promise.allSettled([useSettings.getState().load(), useLibrary.getState().loadOverview(), useLibrary.getState().loadPlaylists()])
      .then(() => usePlayer.getState().restore())
      .catch((e) => log.error("UI", "boot", e))
      .finally(() => setBooted(true));
  }, []);

  return (
    <div className={`${s.app} grain`}>
      {isTauri && <Titlebar />}
      <div className={s.body}>
        <Shelf />
        <div className={s.center}>
          <Stage />
          <NowPlaying />
        </div>
        <QueuePanel />
      </div>
      <Transport />
      <VideoPlayer />
      <ContextMenuHost />
      <DialogHost />
      <Toasts />
      {dropping && (
        <div className={s.drop}>
          <div className={s.dropBox}>
            <Icon name="import" size={40} />
            <span className="display">Drop to import</span>
            <span className={s.dropHint}>Folders are added to your library. Files are copied into FEEDBACK Imports.</span>
          </div>
        </div>
      )}
      {!introDone && <Intro mode={introMode} ready={booted} onDone={() => setIntroDone(true)} />}
    </div>
  );
}
