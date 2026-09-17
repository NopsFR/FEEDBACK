import type { ReactNode } from "react";
import s from "./Page.module.css";

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`${s.page} ${wide ? s.wide : ""}`}>{children}</div>;
}

/** Plain page header: small label + big display title + optional meta/actions. */
export function PageHead({ label, title, meta, actions }: { label?: string; title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={s.head}>
      {label && <div className="label">{label}</div>}
      <h1 className={s.title}>{title}</h1>
      {(meta || actions) && (
        <div className={s.bottom}>
          {meta && <div className={`mono ${s.meta}`}>{meta}</div>}
          {actions && <div className={s.actions}>{actions}</div>}
        </div>
      )}
    </header>
  );
}

export function Loading() {
  return (
    <div className={s.loading} aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}
