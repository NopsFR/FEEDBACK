import type { ReactNode } from "react";
import s from "./Section.module.css";

/** Numbered section header in the style of a printed insert: "01 — RECENTLY ADDED ———— see all" */
export function Section({ index, title, action, children, className }: { index?: number; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${s.section} ${className ?? ""}`}>
      <header className={s.head}>
        {index != null && <span className={s.num}>{String(index).padStart(2, "0")}</span>}
        <h2 className={s.title}>{title}</h2>
        <span className={s.rule} />
        {action && <div className={s.action}>{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className={s.textBtn} onClick={onClick}>
      {children}
    </button>
  );
}
