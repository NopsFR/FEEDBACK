import { useEffect } from "react";
import { usePlayer } from "@/features/player/store";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";
import { useVideo } from "@/features/videos/Videos";
import { showShortcuts } from "./ShortcutsSheet";

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

/**
 * Space play/pause · Ctrl/Cmd+K search · Ctrl+←/→ prev/next · Ctrl+↑/↓ volume · Alt+←/→ back/forward
 * Ctrl+L favourite · Ctrl+/ shows the full list (also in Settings → About)
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useVideo.getState().index >= 0) return; // video player owns the keyboard
      const mod = e.ctrlKey || e.metaKey;
      const p = usePlayer.getState();
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUi.getState().setNowPlaying(false);
        useNav.getState().go({ name: "search" });
        return;
      }
      if (typing(e.target) || useUi.getState().dialog) return;
      if (e.key === " " && !mod) {
        const tgt = e.target as HTMLElement;
        if (tgt.tagName === "BUTTON" || tgt.getAttribute("role") === "slider") return;
        e.preventDefault();
        p.toggle();
      } else if (mod && e.key === "ArrowRight") {
        e.preventDefault();
        p.next();
      } else if (mod && e.key === "ArrowLeft") {
        e.preventDefault();
        p.prev();
      } else if (mod && e.key === "ArrowUp") {
        e.preventDefault();
        p.setVolume(Math.min(1, p.volume + 0.05));
      } else if (mod && e.key === "ArrowDown") {
        e.preventDefault();
        p.setVolume(Math.max(0, p.volume - 0.05));
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        useNav.getState().back();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        useNav.getState().forward();
      } else if (mod && e.key.toLowerCase() === "m") {
        e.preventDefault();
        p.toggleMute();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        p.toggleShuffle();
      } else if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        p.cycleRepeat();
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        useUi.getState().toggleQueue();
      } else if ((mod && e.key === "/") || (e.key === "?" && !mod)) {
        e.preventDefault();
        showShortcuts();
      } else if (e.key === "F11" || (mod && e.key.toLowerCase() === "f" && e.shiftKey)) {
        e.preventDefault();
        useUi.getState().setNowPlaying(!useUi.getState().nowPlayingOpen);
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) useNav.getState().back();
      if (e.button === 4) useNav.getState().forward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    const noContext = (e: MouseEvent) => {
      if (!typing(e.target)) e.preventDefault();
    };
    window.addEventListener("contextmenu", noContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("contextmenu", noContext);
    };
  }, []);
}
