import s from "./Playing.module.css";

/** Three-bar level meter shown on the playing row. Paused = flat bars. */
export function Playing({ active }: { active: boolean }) {
  return (
    <span className={`${s.bars} ${active ? s.on : ""}`} role="img" aria-label={active ? "Playing" : "Paused"}>
      <i />
      <i />
      <i />
    </span>
  );
}
