import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";
import { IconButton } from "@/components/IconButton";
import { isTauri, modKey } from "@/services/platform";
import { useNav } from "@/state/nav";
import s from "./Titlebar.module.css";

export function Titlebar() {
  const { back, forward, canBack, canForward, go } = useNav();
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    void w.isMaximized().then(setMax);
    const un = w.onResized(() => void w.isMaximized().then(setMax));
    return () => {
      void un.then((f) => f());
    };
  }, []);
  const w = isTauri ? getCurrentWindow() : null;
  return (
    <header className={s.bar} data-tauri-drag-region>
      <div className={s.left}>
        <Wordmark className={s.mark} />
        <div className={s.nav}>
          <IconButton icon="chevronLeft" label="Back" size={18} disabled={!canBack} onClick={back} />
          <IconButton icon="chevronRight" label="Forward" size={18} disabled={!canForward} onClick={forward} />
        </div>
      </div>
      <button className={s.search} onClick={() => go({ name: "search" })}>
        <Icon name="search" size={15} />
        <span>Search your library</span>
        <kbd>{modKey} K</kbd>
      </button>
      <div className={s.right} data-tauri-drag-region>
        {w && (
          <div className={s.win}>
            <button aria-label="Minimise" onClick={() => void w.minimize()}>
              <Icon name="minimize" size={16} />
            </button>
            <button aria-label={max ? "Restore" : "Maximise"} onClick={() => void w.toggleMaximize()}>
              <Icon name={max ? "restore" : "maximize"} size={16} />
            </button>
            <button aria-label="Close" className={s.close} onClick={() => void w.close()}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
