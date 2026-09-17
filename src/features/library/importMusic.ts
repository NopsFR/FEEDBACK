import { open } from "@tauri-apps/plugin-dialog";
import { library } from "@/services/library";
import { toast, toastError } from "@/state/ui";
import { useLibrary } from "@/state/library";
import { isTauri } from "@/services/platform";

export async function chooseMusicFolder() {
  if (!isTauri) return toast("Folder import is available in the desktop app.");
  try {
    const dir = await open({ directory: true, multiple: false, title: "Choose a music folder" });
    if (!dir || Array.isArray(dir)) return;
    await library.addFolder(dir);
    toast("Folder added — scanning now.");
    void useLibrary.getState().loadOverview();
  } catch (e) {
    toastError(e);
  }
}

export async function chooseMusicFiles() {
  if (!isTauri) return;
  try {
    const files = await open({
      multiple: true,
      title: "Import music files",
      filters: [{ name: "Music & video", extensions: ["mp3", "flac", "wav", "aac", "m4a", "ogg", "oga", "opus", "aif", "aiff", "wv", "mp4", "m4v", "webm", "mkv", "mov"] }],
    });
    if (!files) return;
    await importDropped(Array.isArray(files) ? files : [files]);
  } catch (e) {
    toastError(e);
  }
}

export async function importDropped(paths: string[]) {
  try {
    const r = await library.importPaths(paths);
    const parts: string[] = [];
    if (r.foldersAdded) parts.push(`${r.foldersAdded} folder${r.foldersAdded === 1 ? "" : "s"} added`);
    if (r.copied) parts.push(`${r.copied} file${r.copied === 1 ? "" : "s"} imported`);
    if (r.skipped) parts.push(`${r.skipped} already there`);
    if (r.rejected) parts.push(`${r.rejected} not music`);
    toast(parts.length ? parts.join(" · ") : "Nothing to import.");
  } catch (e) {
    toastError(e);
  }
}
