import { useState } from "react";
import { usePlayer } from "@/features/player/store";
import { Artwork } from "@/components/Artwork";
import { IconButton } from "@/components/IconButton";
import { Icon } from "@/components/Icon";
import { Playing } from "@/components/Playing";
import { openMenuAt } from "@/components/ContextMenu";
import { promptText } from "@/components/Dialog";
import { library } from "@/services/library";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { toast, toastError } from "@/state/ui";
import { duration, longDuration } from "@/lib/format";
import { useUi } from "@/state/ui";
import { trackMenu } from "@/features/library/actions";
import type { QueueItem } from "@/features/player/queue";
import s from "./QueuePanel.module.css";

function Item({ item, index, current, playing, dragging, over, onDragStart, onDragOver, onDrop }: {
  item: QueueItem; index: number; current: boolean; playing: boolean; dragging: boolean; over: boolean;
  onDragStart: (i: number) => void; onDragOver: (i: number) => void; onDrop: () => void;
}) {
  const { jumpTo, removeFromQueue } = usePlayer.getState();
  const t = item.track;
  return (
    <li
      className={`${s.item} ${current ? s.current : ""} ${dragging ? s.dragging : ""} ${over ? s.over : ""}`}
      draggable={!current}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.uid);
        onDragStart(index);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDoubleClick={() => jumpTo(index)}
      onContextMenu={(e) => openMenuAt(e, trackMenu([t]))}
    >
      <span className={s.grip} aria-hidden>
        {current ? <Playing active={playing} /> : <Icon name="grip" size={14} />}
      </span>
      <Artwork hash={t.art} size={160} seed={t.album} className={s.art} />
      <button className={s.meta} onClick={() => jumpTo(index)}>
        <span className={`truncate ${s.title}`}>{t.title}</span>
        <span className={`truncate ${s.artist}`}>{t.artist}</span>
      </button>
      <span className={`mono ${s.dur}`}>{duration(t.durationMs)}</span>
      {!current && <IconButton icon="close" label={`Remove ${t.title}`} size={14} className={s.remove} onClick={() => removeFromQueue([item.uid])} />}
    </li>
  );
}

export function QueuePanel() {
  const open = useUi((u) => u.queueOpen);
  const toggle = useUi((u) => u.toggleQueue);
  const queue = usePlayer((p) => p.queue);
  const playing = usePlayer((p) => p.playing);
  const { clearUpcoming, moveInQueue } = usePlayer.getState();
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  if (!open) return null;
  const up = queue.items.slice(queue.index + 1);
  const hist = queue.items.slice(0, Math.max(0, queue.index));
  const cur = queue.index >= 0 ? queue.items[queue.index] : null;
  const remaining = up.reduce((a, i) => a + i.track.durationMs, 0);

  const drop = () => {
    if (from !== null && over !== null && from !== over) moveInQueue(from, over);
    setFrom(null);
    setOver(null);
  };
  const props = (i: number) => ({ dragging: from === i, over: over === i && from !== i, onDragStart: setFrom, onDragOver: setOver, onDrop: drop });

  /** Keep a queue you like: everything still to play, in order, as a new playlist. */
  const keep = async () => {
    const tracks = [cur, ...up].filter(Boolean).map((i) => i!.track);
    const name = await promptText("Save queue as playlist", { placeholder: "Name", confirm: "Save" });
    if (!name) return;
    try {
      const id = await library.createPlaylist(name, tracks.map((t) => t.id));
      await useLibrary.getState().loadPlaylists();
      toast(`Saved ${tracks.length} tracks to “${name}”.`);
      useNav.getState().go({ name: "playlist", id });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <aside className={s.panel} aria-label="Queue">
      <header className={s.head}>
        <span className="label">Queue</span>
        <span className={`mono ${s.sum}`}>{up.length ? `${up.length} next · ${longDuration(remaining)}` : ""}</span>
        {(cur || up.length > 0) && <IconButton icon="playlist" label="Save queue as playlist" size={15} onClick={keep} />}
        <IconButton icon="close" label="Close queue" size={16} onClick={() => toggle(false)} />
      </header>
      <div className={s.scroll} onDragEnd={() => (setFrom(null), setOver(null))}>
        {hist.length > 0 && (
          <button className={s.histToggle} onClick={() => setShowHistory(!showHistory)}>
            <Icon name={showHistory ? "chevronDown" : "chevronRight"} size={14} /> Played ({hist.length})
          </button>
        )}
        {showHistory && (
          <ol className={`${s.list} ${s.history}`}>
            {hist.map((it, i) => (
              <Item key={it.uid} item={it} index={i} current={false} playing={false} {...props(i)} />
            ))}
          </ol>
        )}
        {cur && (
          <>
            <div className={s.sub}>Now</div>
            <ol className={s.list}>
              <Item item={cur} index={queue.index} current playing={playing} {...props(queue.index)} />
            </ol>
          </>
        )}
        <div className={s.sub}>
          Up next
          {up.length > 0 && (
            <button className={s.clear} onClick={clearUpcoming}>
              Clear
            </button>
          )}
        </div>
        {up.length ? (
          <ol className={s.list}>
            {up.map((it, k) => (
              <Item key={it.uid} item={it} index={queue.index + 1 + k} current={false} playing={false} {...props(queue.index + 1 + k)} />
            ))}
          </ol>
        ) : (
          <p className={s.empty}>Nothing queued. Right-click any track and pick “Play next”.</p>
        )}
      </div>
    </aside>
  );
}
