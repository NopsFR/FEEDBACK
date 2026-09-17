import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import s from "./IconButton.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  variant?: "ghost" | "solid" | "outline";
  badge?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ icon, label, size = 20, active, variant = "ghost", badge, className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} aria-pressed={active} className={`${s.btn} ${s[variant]} ${active ? s.active : ""} ${className ?? ""}`} {...rest}>
      <Icon name={icon} size={size} />
      {badge && <span className={s.badge}>{badge}</span>}
    </button>
  );
});
