import type { SVGProps } from "react";

/**
 * FEEDBACK icon set. 24px grid, 1.6 stroke, square-ish terminals.
 * Transport glyphs are solid for instant recognition; everything else is line work.
 * Motif: a small cut ("the gap") on library/brand glyphs, never on transport controls.
 */
const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
};

const paths = {
  play: <path d="M7.5 4.8v14.4a.6.6 0 0 0 .9.5l11.1-7.2a.6.6 0 0 0 0-1L8.4 4.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />,
  pause: (
    <g fill="currentColor">
      <rect x="6" y="4.5" width="4" height="15" rx=".6" />
      <rect x="14" y="4.5" width="4" height="15" rx=".6" />
    </g>
  ),
  next: (
    <g fill="currentColor">
      <path d="M5 5.4v13.2a.6.6 0 0 0 .92.5L15.5 12.5a.6.6 0 0 0 0-1L5.92 4.9A.6.6 0 0 0 5 5.4Z" />
      <rect x="16.4" y="5" width="2.6" height="14" rx=".5" />
    </g>
  ),
  prev: (
    <g fill="currentColor">
      <path d="M19 5.4v13.2a.6.6 0 0 1-.92.5L8.5 12.5a.6.6 0 0 1 0-1l9.58-6.6a.6.6 0 0 1 .92.5Z" />
      <rect x="5" y="5" width="2.6" height="14" rx=".5" />
    </g>
  ),
  shuffle: (
    <g {...P}>
      <path d="M3.5 7h3.2c2.6 0 3.6 1.4 5.3 5s2.7 5 5.3 5h2.2" />
      <path d="M3.5 17h3.2c1.5 0 2.4-.5 3.2-1.4M14 8.4c.8-.9 1.7-1.4 3.2-1.4h2.2" />
      <path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />
    </g>
  ),
  repeat: (
    <g {...P}>
      <path d="M4.5 11V9.5A2.5 2.5 0 0 1 7 7h12" />
      <path d="M16.5 4.5 19 7l-2.5 2.5" />
      <path d="M19.5 13v1.5A2.5 2.5 0 0 1 17 17H5" />
      <path d="M7.5 19.5 5 17l2.5-2.5" />
    </g>
  ),
  repeatOne: (
    <g {...P}>
      <path d="M4.5 11V9.5A2.5 2.5 0 0 1 7 7h12" />
      <path d="M16.5 4.5 19 7l-2.5 2.5" />
      <path d="M19.5 13v1.5A2.5 2.5 0 0 1 17 17H5" />
      <path d="M7.5 19.5 5 17l2.5-2.5" />
      <path d="M11.2 10.6 12.4 10v4.2" strokeWidth="1.5" />
    </g>
  ),
  queue: (
    <g {...P}>
      <path d="M4 6h11M4 11h11M4 16h6" />
      <path d="M15 14v6.5" />
      <path d="M15 14.2c1.6-.4 3.2.2 4.5 1.2" />
    </g>
  ),
  volume0: (
    <g {...P}>
      <path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" />
    </g>
  ),
  volume1: (
    <g {...P}>
      <path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
    </g>
  ),
  volume2: (
    <g {...P}>
      <path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M17.5 6.5a7.5 7.5 0 0 1 0 11" />
    </g>
  ),
  mute: (
    <g {...P}>
      <path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" />
      <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
    </g>
  ),
  lyrics: (
    <g {...P}>
      <path d="M4 5.5h12M4 10h9M4 14.5h6" />
      <circle cx="17" cy="17" r="2.4" />
      <path d="M19.4 17V9.5l1.6.8" />
    </g>
  ),
  expand: (
    <g {...P}>
      <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6" />
    </g>
  ),
  collapse: (
    <g {...P}>
      <path d="M19 10h-5V5M5 14h5v5M14 10l6-6M10 14l-6 6" />
    </g>
  ),
  heart: <path {...P} d="M12 19.5s-7.5-4.4-7.5-9.7A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4c0 5.3-7.5 9.7-7.5 9.7Z" />,
  heartFill: <path fill="currentColor" d="M12 19.5s-7.5-4.4-7.5-9.7A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4c0 5.3-7.5 9.7-7.5 9.7Z" />,
  home: (
    <g {...P}>
      <path d="M4.5 10.5 12 4.5l7.5 6V19.5h-5v-5h-5v5h-5z" />
    </g>
  ),
  search: (
    <g {...P}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </g>
  ),
  albums: (
    <g {...P}>
      <rect x="3.5" y="5.5" width="13" height="13" />
      <path d="M19.5 7v11a3 3 0 0 1-3 3H6" />
      <circle cx="10" cy="12" r="2.2" />
    </g>
  ),
  artists: (
    <g {...P}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6" />
    </g>
  ),
  tracks: (
    <g {...P}>
      <path d="M9 17.5V5.5l10-1.5v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </g>
  ),
  genres: (
    <g {...P}>
      <path d="M4.5 4.5h7l8 8-7 7-8-8z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </g>
  ),
  videos: (
    <g {...P}>
      <rect x="3.5" y="5.5" width="17" height="13" />
      <path d="M10.2 9.2v5.6l4.6-2.8z" fill="currentColor" stroke="none" />
    </g>
  ),
  history: (
    <g {...P}>
      <path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1" />
      <path d="M4.5 4.5v3.5H8" />
      <path d="M12 8.5V12l2.5 2" />
    </g>
  ),
  flame: <path {...P} d="M12 20.5c3.6 0 6-2.4 6-5.6 0-3.9-3.5-5.4-3.5-9.4-2.7 1.4-4 3.7-4 6-.9-.6-1.6-1.6-1.8-2.8C7.2 10 6 12 6 14.9c0 3.2 2.4 5.6 6 5.6Z" />,
  recent: (
    <g {...P}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2.5v3" />
    </g>
  ),
  playlist: (
    <g {...P}>
      <path d="M4 6h12M4 10.5h12M4 15h7" />
      <path d="M17.5 13v7M14 16.5h7" />
    </g>
  ),
  settings: (
    <g {...P}>
      <path d="M5 7h6M15 7h4M5 17h2M11 17h8M5 12h10M19 12h0" />
      <path d="M13 5v4M9 15v4M17 10v4" />
    </g>
  ),
  plus: <path {...P} d="M12 5v14M5 12h14" />,
  more: (
    <g fill="currentColor">
      <circle cx="5.5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18.5" cy="12" r="1.5" />
    </g>
  ),
  close: <path {...P} d="m6 6 12 12M18 6 6 18" />,
  chevronLeft: <path {...P} d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  chevronRight: <path {...P} d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronDown: <path {...P} d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  chevronUp: <path {...P} d="m5.5 14.5 6.5-6.5 6.5 6.5" />,
  folder: <path {...P} d="M3.5 6.5h6l2 2h9v10h-17z" />,
  disc: (
    <g {...P}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 4a8 8 0 0 1 8 8" strokeDasharray="2 3" />
    </g>
  ),
  grip: (
    <g fill="currentColor">
      <circle cx="9" cy="7" r="1.2" />
      <circle cx="15" cy="7" r="1.2" />
      <circle cx="9" cy="12" r="1.2" />
      <circle cx="15" cy="12" r="1.2" />
      <circle cx="9" cy="17" r="1.2" />
      <circle cx="15" cy="17" r="1.2" />
    </g>
  ),
  check: <path {...P} d="m5 12.5 4.5 4.5L19 7.5" />,
  minimize: <path {...P} strokeWidth="1.2" d="M6 12h12" />,
  maximize: <rect {...P} strokeWidth="1.2" x="6.5" y="6.5" width="11" height="11" />,
  restore: (
    <g {...P} strokeWidth="1.2">
      <rect x="6.5" y="8.5" width="9" height="9" />
      <path d="M9 8.5V6.5h8.5V15h-2" />
    </g>
  ),
  import: (
    <g {...P}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 15v4.5h15V15" />
    </g>
  ),
  moon: <path {...P} d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z" />,
  sliders: (
    <g {...P}>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <path d="M4 14h4M10 8h4M16 16h4" strokeWidth="2.4" />
    </g>
  ),
  trash: (
    <g {...P}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
    </g>
  ),
  reveal: (
    <g {...P}>
      <path d="M3.5 6.5h6l2 2h9v10h-17z" />
      <path d="M12 16v-5M9.8 13 12 10.8l2.2 2.2" />
    </g>
  ),
  edit: <path {...P} d="M4.5 19.5h4l10-10-4-4-10 10zM13 7l4 4" />,
  arrowLeft: <path {...P} d="M19 12H6M11 6.5 5.5 12l5.5 5.5" />,
  arrowRight: <path {...P} d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" />,
  signal: (
    <g fill="currentColor">
      <path d="M2 12h3.5l.8-1.6.9 3 1-5.2 1.1 7.3 1.1-9.5L11.5 18l1.1-12.6 1.1 10.1 1-6.4 1 4.4.9-2.4.8 1H22v.8h-6.1l-.4-.5-1.1 3-1-4.3-1 6.3-1.1-10-1.1 12.3L9 8.7l-1.1 8-1-6.4-.9 3.2-.9-1.8H2Z" />
    </g>
  ),
  cast: (
    <g {...P}>
      <rect x="6" y="3.5" width="12" height="17" />
      <path d="M10 17.5h4" />
    </g>
  ),
  duplicate: (
    <g {...P}>
      <rect x="8.5" y="8.5" width="11" height="11" />
      <path d="M15.5 8.5v-4h-11v11h4" />
    </g>
  ),
  sort: <path {...P} d="M7 4.5v15M4 16.5l3 3 3-3M17 19.5v-15M14 7.5l3-3 3 3" />,
  sidebar: (
    <g {...P}>
      <rect x="3.5" y="4.5" width="17" height="15" />
      <path d="M9.5 4.5v15" />
    </g>
  ),
  wifi: (
    <g {...P}>
      <path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.8 7.8 0 0 1 11 0M9.5 15.5a3.5 3.5 0 0 1 5 0" />
      <circle cx="12" cy="18.5" r=".6" fill="currentColor" />
    </g>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, title, ...rest }: { name: IconName; size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  );
}
