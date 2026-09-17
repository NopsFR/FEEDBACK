import type { ReactNode } from "react";
import s from "./EmptyState.module.css";

/** Empty states are an empty jewel case, not a smiling illustration. */
export function EmptyState({ title, body, note, action, compact }: { title: string; body?: ReactNode; note?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`${s.wrap} ${compact ? s.compact : ""}`}>
      <div className={s.case} aria-hidden>
        <div className={s.tray}>
          <div className={s.hub} />
        </div>
        <div className={s.hinge} />
      </div>
      <div className={s.copy}>
        <h3 className={s.title}>{title}</h3>
        {body && <p className={s.body}>{body}</p>}
        {action && <div className={s.action}>{action}</div>}
        {note && <p className={`hand ${s.note}`}>{note}</p>}
      </div>
    </div>
  );
}
