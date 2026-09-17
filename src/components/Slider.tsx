import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import s from "./Slider.module.css";

interface Props {
  value: number; // 0..1
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  valueText?: string;
  step?: number;
  className?: string;
  /** Show hover preview position (e.g. timeline) */
  preview?: (v: number) => string;
  buffered?: number;
  variant?: "timeline" | "volume";
}

/** Pointer-captured slider. Responds immediately while dragging; commits on release. */
export function Slider({ value, onChange, onCommit, label, valueText, step = 0.02, className, preview, variant = "timeline" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const posFrom = useCallback((e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }, []);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = posFrom(e);
    setDrag(v);
    onChange(v);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const v = posFrom(e);
    if (drag !== null) {
      setDrag(v);
      onChange(v);
    }
    if (preview) setHover(v);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = posFrom(e);
    setDrag(null);
    onCommit?.(v);
  };
  const onKey = (e: KeyboardEvent) => {
    let v = value;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") v = Math.min(1, value + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = Math.max(0, value - step);
    else if (e.key === "Home") v = 0;
    else if (e.key === "End") v = 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange(v);
    onCommit?.(v);
  };

  const shown = drag ?? value;
  return (
    <div
      ref={ref}
      className={`${s.slider} ${s[variant]} ${drag !== null ? s.dragging : ""} ${className ?? ""}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      aria-valuetext={valueText}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
    >
      <div className={s.rail}>
        <div className={s.fill} style={{ transform: `scaleX(${shown})` }} />
      </div>
      <div className={s.thumb} style={{ left: `${shown * 100}%` }} />
      {preview && hover !== null && drag === null && (
        <div className={s.tip} style={{ left: `${hover * 100}%` }}>
          {preview(hover)}
        </div>
      )}
      {preview && drag !== null && (
        <div className={s.tip} style={{ left: `${drag * 100}%` }}>
          {preview(drag)}
        </div>
      )}
    </div>
  );
}
