import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUi } from "@/state/ui";
import s from "./Dialog.module.css";

export function DialogHost() {
  const dialog = useUi((st) => st.dialog);
  if (!dialog) return null;
  return <div className={s.scrim}>{dialog}</div>;
}

export function Dialog({ title, children, onClose, width = 440 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,button,select,textarea");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div ref={ref} className={s.dialog} role="dialog" aria-modal="true" aria-label={title} style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
      <div className={`label ${s.title}`}>{title}</div>
      {children}
    </div>
  );
}

const close = () => useUi.getState().setDialog(null);

export function promptText(title: string, opts: { initial?: string; placeholder?: string; confirm?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    function Prompt() {
      const [v, setV] = useState(opts.initial ?? "");
      const done = (val: string | null) => {
        close();
        resolve(val);
      };
      return (
        <Dialog title={title} onClose={() => done(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              done(v.trim() || null);
            }}
          >
            <input className={s.input} value={v} placeholder={opts.placeholder} onChange={(e) => setV(e.target.value)} maxLength={120} spellCheck={false} />
            <div className={s.actions}>
              <button type="button" className={s.secondary} onClick={() => done(null)}>
                Cancel
              </button>
              <button type="submit" className={s.primary} disabled={!v.trim()}>
                {opts.confirm ?? "Save"}
              </button>
            </div>
          </form>
        </Dialog>
      );
    }
    useUi.getState().setDialog(<Prompt />);
  });
}

export function confirmAction(title: string, body: string, confirm = "Confirm", danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      close();
      resolve(v);
    };
    useUi.getState().setDialog(
      <Dialog title={title} onClose={() => done(false)}>
        <p className={s.body}>{body}</p>
        <div className={s.actions}>
          <button className={s.secondary} onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`${s.primary} ${danger ? s.danger : ""}`} onClick={() => done(true)}>
            {confirm}
          </button>
        </div>
      </Dialog>,
    );
  });
}
