import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUi, type MenuItem } from "@/state/ui";
import { Icon } from "./Icon";
import { openActionSheet } from "./ActionSheet";
import s from "./ContextMenu.module.css";

function MenuList({ items, x, y, onClose, depth = 0 }: { items: MenuItem[]; x: number; y: number; onClose: () => void; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, originX: "left", originY: "top" });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    let originX = "left";
    let originY = "top";
    if (x + r.width > vw - 8) {
      nx = depth ? x - r.width - (r.width ? 4 : 0) - 180 : vw - r.width - 8;
      originX = "right";
    }
    if (y + r.height > vh - 8) {
      ny = Math.max(8, vh - r.height - 8);
      originY = "bottom";
    }
    setPos({ x: Math.max(8, nx), y: ny, originX, originY });
  }, [x, y, depth]);

  useEffect(() => {
    if (depth) return;
    ref.current?.focus();
  }, [depth]);

  const activate = (item: MenuItem, i: number, el?: HTMLElement) => {
    if (item.disabled || item.separator) return;
    if (item.submenu) {
      const r = (el ?? ref.current!.children[i] as HTMLElement).getBoundingClientRect();
      setSub({ index: i, x: r.right + 2, y: r.top - 5 });
      return;
    }
    onClose();
    item.run?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const enabled = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const cur = enabled.indexOf(focus);
      const next = e.key === "ArrowDown" ? enabled[(cur + 1) % enabled.length] : enabled[(cur - 1 + enabled.length) % enabled.length];
      setFocus(next);
    } else if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      if (focus >= 0) activate(items[focus], focus);
    } else if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <div
        ref={ref}
        className={s.menu}
        role="menu"
        tabIndex={-1}
        onKeyDown={onKey}
        style={{ left: pos.x, top: pos.y, transformOrigin: `${pos.originX} ${pos.originY}` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className={s.sep} role="separator" />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`${s.item} ${it.danger ? s.danger : ""} ${focus === i ? s.focused : ""}`}
              disabled={it.disabled}
              onMouseEnter={(e) => {
                setFocus(i);
                if (it.submenu) activate(it, i, e.currentTarget);
                else setSub(null);
              }}
              onClick={(e) => activate(it, i, e.currentTarget)}
            >
              <span className={s.icon}>{it.icon}</span>
              <span className={s.text}>{it.label}</span>
              {it.hint && <span className={s.hint}>{it.hint}</span>}
              {it.submenu && <Icon name="chevronRight" size={14} />}
            </button>
          ),
        )}
      </div>
      {sub && items[sub.index]?.submenu && <MenuList items={items[sub.index].submenu!} x={sub.x} y={sub.y} onClose={onClose} depth={depth + 1} />}
    </>
  );
}

export function ContextMenuHost() {
  const menu = useUi((st) => st.menu);
  const close = useUi((st) => st.closeMenu);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`.${s.menu}`)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onBlur = () => close();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [menu, close]);
  if (!menu) return null;
  return (
    <div className={s.layer}>
      <MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} onClose={close} />
    </div>
  );
}

/** Helper for onContextMenu / "more" buttons */
const touchLayout = () => window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;

export function openMenuAt(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[], title = "") {
  e.preventDefault?.();
  e.stopPropagation?.();
  if (touchLayout()) return openActionSheet(title, items);
  useUi.getState().openMenu(e.clientX, e.clientY, items);
}

export function openMenuFrom(el: HTMLElement, items: MenuItem[], title = "") {
  if (touchLayout()) return openActionSheet(title, items);
  const r = el.getBoundingClientRect();
  useUi.getState().openMenu(r.left, r.bottom + 4, items);
}
