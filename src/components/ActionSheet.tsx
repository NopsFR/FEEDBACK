import { useUi, type MenuItem } from "@/state/ui";
import s from "./ActionSheet.module.css";

/** Touch replacement for context menus: a bottom sheet. Submenus open as a second sheet. */
export function openActionSheet(title: string, items: MenuItem[]) {
  const close = () => useUi.getState().setSheet(null);
  useUi.getState().setSheet(
    <div className={s.scrim} onClick={close}>
      <div className={s.sheet} onClick={(e) => e.stopPropagation()} role="menu" aria-label={title}>
        <div className={s.grab} />
        <div className={`truncate ${s.title}`}>{title}</div>
        {items
          .filter((it) => !it.disabled)
          .map((it, i) =>
            it.separator ? (
              <div key={i} className={s.sep} />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={`${s.item} ${it.danger ? s.danger : ""}`}
                onClick={() => {
                  if (it.submenu) openActionSheet(it.label, it.submenu);
                  else {
                    close();
                    it.run?.();
                  }
                }}
              >
                <span className={s.icon}>{it.icon}</span>
                {it.label}
              </button>
            ),
          )}
        <button className={s.cancel} onClick={close}>
          Cancel
        </button>
      </div>
    </div>,
  );
}

export function SheetHost() {
  const sheet = useUi((u) => u.sheet);
  return <>{sheet}</>;
}
