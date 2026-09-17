import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/mobile.css";
import { App } from "./app/App";

if (import.meta.env.DEV) {
  // Dev-only handle for automated screenshot QA (tests/e2e/drive.mjs). Stripped from production builds.
  void Promise.all([import("./state/nav"), import("./features/player/store"), import("./state/ui"), import("./state/library"), import("./services/library"), import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi")]).then(
    ([nav, player, ui, lib, svc, win, dpi]) => {
      (window as unknown as { __feedback: unknown }).__feedback = { nav: nav.useNav, player: player.usePlayer, ui: ui.useUi, lib: lib.useLibrary, library: svc.library, win: { getCurrentWindow: win.getCurrentWindow, LogicalSize: dpi.LogicalSize } };
    },
  );
}

createRoot(document.getElementById("root")!).render(<App />);
