import { Icon } from "@/components/Icon";
import { confirmAction, promptText } from "@/components/Dialog";
import { usePlayer } from "@/features/player/store";
import { library } from "@/services/library";
import type { Playlist } from "@/services/types";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { toast, toastError, type MenuItem } from "@/state/ui";
import { editSmartPlaylist } from "./SmartPlaylistEditor";
import { isTauri } from "@/services/platform";
import * as offline from "@/services/offline";

const I = (n: Parameters<typeof Icon>[0]["name"]) => <Icon name={n} size={16} />;

export async function playPlaylist(id: number, shuffle = false) {
  try {
    const d = await library.playlist(id);
    const tracks = d.entries.map((e) => e.track);
    if (!tracks.length) return toast("That playlist is empty.");
    usePlayer.getState().playTracks(tracks, 0, { shuffle, source: `playlist:${id}` });
  } catch (e) {
    toastError(e);
  }
}

export async function renamePlaylist(p: Pick<Playlist, "id" | "name" | "description">) {
  const name = await promptText("Rename playlist", { initial: p.name, confirm: "Rename" });
  if (!name || name === p.name) return;
  try {
    await library.renamePlaylist(p.id, name, p.description);
    await useLibrary.getState().loadPlaylists();
  } catch (e) {
    toastError(e);
  }
}

export async function deletePlaylist(p: Pick<Playlist, "id" | "name">) {
  const ok = await confirmAction("Delete playlist", `“${p.name}” will be deleted. The tracks stay in your library.`, "Delete", true);
  if (!ok) return;
  try {
    await library.deletePlaylist(p.id);
    await useLibrary.getState().loadPlaylists();
    const nav = useNav.getState();
    if (nav.route.name === "playlist" && nav.route.id === p.id) nav.go({ name: "playlists" });
  } catch (e) {
    toastError(e);
  }
}

export function playlistMenu(p: Playlist): MenuItem[] {
  return [
    { label: "Play", icon: I("play"), run: () => playPlaylist(p.id) },
    { label: "Shuffle", icon: I("shuffle"), run: () => playPlaylist(p.id, true) },
    {
      label: "Add to queue",
      icon: I("plus"),
      run: async () => usePlayer.getState().addToQueue((await library.playlist(p.id)).entries.map((e) => e.track)),
    },
    { label: "", separator: true },
    { label: "Rename…", icon: I("edit"), run: () => renamePlaylist(p) },
    ...(p.rules && isTauri ? [{ label: "Edit rules…", icon: I("settings"), run: () => editSmartPlaylist(p) } as MenuItem] : []),
    ...(!isTauri ? [{ label: "Save to this phone", icon: I("import"), run: async () => {
      try { const d = await library.playlist(p.id); if (await confirmAction("Save playlist", `Download ${d.entries.length} tracks from “${p.name}” to this phone?`, "Save")) { await offline.savePlaylist(d); toast("Playlist saved on this phone."); } } catch (e) { toastError(e); }
    } } as MenuItem] : []),
    {
      label: "Duplicate",
      icon: I("duplicate"),
      run: async () => {
        try {
          const id = await library.duplicatePlaylist(p.id);
          await useLibrary.getState().loadPlaylists();
          useNav.getState().go({ name: "playlist", id });
        } catch (e) {
          toastError(e);
        }
      },
    },
    { label: "", separator: true },
    { label: "Delete", icon: I("trash"), danger: true, run: () => deletePlaylist(p) },
  ];
}
