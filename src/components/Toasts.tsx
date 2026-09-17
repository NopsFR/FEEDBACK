import { useUi } from "@/state/ui";
import s from "./Toasts.module.css";

export function Toasts() {
  const toasts = useUi((st) => st.toasts);
  const dismiss = useUi((st) => st.dismiss);
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${s.toast} ${t.tone === "error" ? s.error : ""}`}>
          <span className={s.msg}>{t.message}</span>
          {t.action && (
            <button
              className={s.action}
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
