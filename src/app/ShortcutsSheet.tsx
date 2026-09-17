import { Dialog } from "@/components/Dialog";
import { useUi } from "@/state/ui";
import s from "./ShortcutsSheet.module.css";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

/** The keyboard map, in the order people reach for it. Kept in step with app/shortcuts.ts. */
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Space", what: "Play or pause" },
  { keys: `${MOD} ←  /  →`, what: "Previous / next track" },
  { keys: `${MOD} ↑  /  ↓`, what: "Volume" },
  { keys: `${MOD} M`, what: "Mute" },
  { keys: `${MOD} S`, what: "Shuffle" },
  { keys: `${MOD} R`, what: "Repeat: off, all, one" },
  { keys: `${MOD} L`, what: "Favourite the playing track" },
  { keys: `${MOD} J`, what: "Show the queue" },
  { keys: `${MOD} K`, what: "Search" },
  { keys: "F11", what: "Now Playing" },
  { keys: "Alt ←  /  →", what: "Back / forward" },
  { keys: `${MOD} /`, what: "This list" },
  { keys: "Esc", what: "Close what's open" },
];

export function showShortcuts() {
  const close = () => useUi.getState().setDialog(null);
  useUi.getState().setDialog(
    <Dialog title="Keyboard" onClose={close} width={480}>
      <dl className={s.list}>
        {SHORTCUTS.map((row) => (
          <div className={s.row} key={row.keys}>
            <dt className={`mono ${s.keys}`}>{row.keys}</dt>
            <dd className={s.what}>{row.what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>,
  );
}
