import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon } from "@/components/Icon";
import { confirmAction, promptText } from "@/components/Dialog";
import { usePlayer } from "@/features/player/store";
import { library } from "@/services/library";
import type { Album, Track } from "@/services/types";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { toast, toastError, type MenuItem } from "@/state/ui";
import { isTauri } from "@/services/platform";
import * as offline from "@/services/offline";
import { bytes } from "@/lib/format";
import { editTracks } from "./MetadataEditor";

const I = (n: Parameters<typeof Icon>[0]["name"]) => <Icon name={n} size={16} />;

export async function toggleFavourite(t: Track, on?: boolean) {
  const next = on ?? !useLibrary.getState().favourites.has(t.id);
  useLibrary.getState().setFavourite(t.id, next);
  usePlayer.getState().patchTrack(t.id, { favourite: next });
  try {
    await library.setFavourite(t.id, next);
  } catch (e) {
    useLibrary.getState().setFavourite(t.id, !next);
    toastError(e);
  }
}

export function playlistSubmenu(source: Track[] | (() => Promise<Track[]>)): MenuItem[] {
  const pls = useLibrary.getState().playlists;
  const resolve = async () => (typeof source === "function" ? source() : source);
  return [
    {
      label: "New playlist…",
      icon: I("plus"),
      run: async () => {
        const name = await promptText("New playlist", { placeholder: "Name", confirm: "Create" });
        if (!name) return;
        try {
          const tracks = await resolve();
          const id = await library.createPlaylist(name, tracks.map((t) => t.id));
          await useLibrary.getState().loadPlaylists();
          toast(`Created “${name}”`, "info", { label: "Open", run: () => useNav.getState().go({ name: "playlist", id }) });
        } catch (e) {
          toastError(e);
        }
      },
    },
    ...(pls.length ? [{ label: "", separator: true } as MenuItem] : []),
    ...pls.slice(0, 30).map((p) => ({
      label: p.name,
      run: async () => {
        try {
          const tracks = await resolve();
          await library.addToPlaylist(p.id, tracks.map((t) => t.id));
          await useLibrary.getState().loadPlaylists();
          toast(tracks.length === 1 ? `Added to “${p.name}”` : `Added ${tracks.length} tracks to “${p.name}”`);
        } catch (e) {
          toastError(e);
        }
      },
    })),
  ];
}

export function trackMenu(tracks: Track[], opts: { playlistId?: number; entryIds?: number[]; onRemoved?: () => void; queueContext?: Track[] } = {}): MenuItem[] {
  const p = usePlayer.getState();
  const nav = useNav.getState();
  const one = tracks.length === 1 ? tracks[0] : null;
  const fav = one ? useLibrary.getState().favourites.has(one.id) || one.favourite : false;
  const items: MenuItem[] = [
    { label: tracks.length > 1 ? `Play ${tracks.length} tracks` : "Play", icon: I("play"), run: () => p.playTracks(tracks, 0) },
    { label: "Play next", icon: I("queue"), run: () => p.playNext(tracks) },
    { label: "Add to queue", icon: I("plus"), run: () => p.addToQueue(tracks) },
    { label: "Add to playlist", icon: I("playlist"), submenu: playlistSubmenu(tracks) },
    { label: "", separator: true },
  ];
  if (one) {
    items.push({ label: fav ? "Remove from favourites" : "Favourite", icon: I(fav ? "heartFill" : "heart"), run: () => toggleFavourite(one) });
    if (one.artistId) items.push({ label: `Go to ${one.artist}`, icon: I("artists"), run: () => nav.go({ name: "artist", id: one.artistId! }) });
    if (one.albumId) items.push({ label: "Go to album", icon: I("albums"), run: () => nav.go({ name: "album", id: one.albumId! }) });
    if (isTauri)
      items.push({
        label: "Show in folder",
        icon: I("reveal"),
        run: async () => {
          try {
            await revealItemInDir(await library.trackPath(one.id));
          } catch (e) {
            toastError(e);
          }
        },
      });
  } else {
    items.push({ label: "Favourite all", icon: I("heart"), run: () => tracks.forEach((t) => toggleFavourite(t, true)) });
  }
  if (isTauri) items.push({ label: tracks.length > 1 ? "Edit details…" : "Edit details…", icon: I("edit"), run: () => editTracks(tracks) });
  if (opts.playlistId && opts.entryIds?.length) {
    items.push({ label: "", separator: true });
    items.push({
      label: "Remove from this playlist",
      icon: I("close"),
      run: async () => {
        try {
          await library.removeFromPlaylist(opts.playlistId!, opts.entryIds!);
          await useLibrary.getState().loadPlaylists();
          opts.onRemoved?.();
        } catch (e) {
          toastError(e);
        }
      },
    });
  }
  items.push({ label: "", separator: true });
  items.push({
    label: "Remove from library",
    icon: I("trash"),
    danger: true,
    run: async () => {
      const ok = await confirmAction(
        "Remove from library",
        `${tracks.length === 1 ? `“${one!.title}”` : `${tracks.length} tracks`} will be removed from FEEDBACK. The files stay on disk and will come back if you rescan their folder.`,
        "Remove",
        true,
      );
      if (!ok) return;
      try {
        await library.removeTracks(tracks.map((t) => t.id));
        useLibrary.getState().invalidate();
        opts.onRemoved?.();
      } catch (e) {
        toastError(e);
      }
    },
  });
  return items;
}

export async function playAlbum(album: Pick<Album, "id" | "title">, opts: { shuffle?: boolean; start?: number } = {}) {
  try {
    const d = await library.album(album.id);
    usePlayer.getState().playTracks(d.tracks, opts.start ?? 0, { shuffle: opts.shuffle, source: `album:${album.id}` });
  } catch (e) {
    toastError(e);
  }
}

export function albumMenu(album: Album): MenuItem[] {
  const nav = useNav.getState();
  const withTracks = (fn: (t: Track[]) => void) => async () => {
    try {
      fn((await library.album(album.id)).tracks);
    } catch (e) {
      toastError(e);
    }
  };
  const saved = !isTauri && offline.savedAlbumIds().includes(album.id);
  const offlineItems: MenuItem[] = isTauri
    ? []
    : [
        { label: "", separator: true },
        saved
          ? { label: "Remove from this phone", icon: I("trash"), run: () => offline.removeAlbum(album.id).then(() => toast("Removed from this phone.")).catch(toastError) }
          : { label: "Save to this phone", icon: I("import"), run: () => saveAlbumOffline(album.id) },
      ];
  return [
    { label: "Play", icon: I("play"), run: () => playAlbum(album) },
    { label: "Shuffle", icon: I("shuffle"), run: () => playAlbum(album, { shuffle: true }) },
    { label: "Play next", icon: I("queue"), run: withTracks((t) => usePlayer.getState().playNext(t)) },
    { label: "Add to queue", icon: I("plus"), run: withTracks((t) => usePlayer.getState().addToQueue(t)) },
    { label: "Add to playlist", icon: I("playlist"), submenu: playlistSubmenu(async () => (await library.album(album.id)).tracks) },
    { label: "", separator: true },
    ...(album.artistId ? [{ label: `Go to ${album.artist}`, icon: I("artists"), run: () => nav.go({ name: "artist", id: album.artistId! }) }] : []),
    ...(isTauri
      ? [{ label: "Edit album…", icon: I("edit"), run: async () => editTracks((await library.album(album.id)).tracks, album) } as MenuItem]
      : []),
    ...offlineItems,
  ];
}

export async function saveAlbumOffline(albumId: number) {
  try {
    const d = await library.album(albumId);
    const size = d.tracks.reduce((a, t) => a + t.fileSize, 0);
    const info = await offline.storageInfo();
    if (!info.secure) return toast("Saving needs the secure (https) address — see the setup page on your computer.", "error");
    if (info.quota && info.usage + size > info.quota * 0.9) return toast(`Not enough space allowed for ${bytes(size)}.`, "error");
    if (size > 150 * 1024 * 1024 && !(await confirmAction("Save album", `“${d.album.title}” is ${bytes(size)}. Use Wi-Fi for this.`, "Save"))) return;
    toast(`Saving “${d.album.title}” (${bytes(size)})…`);
    await offline.saveAlbum(d);
    toast(`“${d.album.title}” is on this phone.`);
  } catch (e) {
    toastError(e);
  }
}
