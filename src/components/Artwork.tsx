import { memo, useState } from "react";
import { artUrl } from "@/services/platform";
import s from "./Artwork.module.css";

interface Props {
  hash: string | null | undefined;
  size?: 160 | 480 | 0;
  alt?: string;
  /** Seed for the fallback sleeve so each album without art still looks distinct. */
  seed?: string;
  className?: string;
  rounded?: boolean;
  eager?: boolean;
}

function hashString(v: string): number {
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Album art, square, never cropped. Missing art renders a printed "blank sleeve" instead of a grey box. */
export const Artwork = memo(function Artwork({ hash, size = 480, alt = "", seed = "", className, rounded, eager }: Props) {
  const [failed, setFailed] = useState(false);
  const url = artUrl(hash, size);
  const cls = [s.art, rounded ? s.rounded : "", className ?? ""].join(" ");
  if (!url || failed) {
    const h = hashString(seed || "feedback");
    const variant = h % 4;
    const rot = (h % 7) - 3;
    return (
      <div className={`${cls} ${s.fallback}`} data-variant={variant} aria-label={alt || "No artwork"} role="img">
        <span className={s.fbLine} style={{ transform: `rotate(${rot}deg)` }} />
        <span className={s.fbTitle}>{(seed || "").slice(0, 28)}</span>
      </div>
    );
  }
  return (
    <div className={cls}>
      <img src={url} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} crossOrigin="anonymous" onError={() => setFailed(true)} />
    </div>
  );
});
