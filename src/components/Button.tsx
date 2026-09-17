import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import s from "./Button.module.css";

export function Button({ children, icon, variant = "primary", className, ...rest }: { children: ReactNode; icon?: IconName; variant?: "primary" | "secondary" | "quiet" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${s.btn} ${s[variant]} ${className ?? ""}`} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </button>
  );
}
