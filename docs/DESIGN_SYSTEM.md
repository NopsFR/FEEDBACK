# FEEDBACK — Design System

Implementation lives in `src/styles/tokens.css` (tokens) and `src/styles/base.css` (resets, utilities). Components use CSS
modules next to their TSX. No `!important`, no `transition: all`.

## Layout
```
┌ Titlebar 36 ───────────────────────────────────────────────┐
│ Shelf 236 (64) │ Stage (scroll)            │ Queue 360 (opt) │
│                │  └ Now Playing overlays   │                 │
├────────────────┴───────────────────────────┴─────────────────┤
│ Transport 88                                                 │
└──────────────────────────────────────────────────────────────┘
```
- **Shelf**: numbered groups (01 Listen, 02 Collection, 03 Kept, 04 Playlists). Active item: ink-3 fill + 2 px red tick.
  Playlists accept dragged tracks.
- **Stage**: page padding `36px clamp(24px, 3.4vw, 56px)`, max width 1680. Scroll position is stored per history entry.
- **Now Playing**: covers the Stage only, so the shelf and transport stay reachable.

## Tokens
- Ink: `--ink-0 … --ink-5` (#050505 → #262626). Lines: `--line-1/2/3`. Text: `--paper-1…4`.
- Accent: `--red` (signal), `--burgundy` (selected/toggles), `--wine` (drop targets). `--ambient-a/b` are set from artwork.
- Space: 4 px base (`--s-1` 4 … `--s-20` 80).
- Radius: `--r-1` 2 px (default), `--r-2` 4 px, `--r-3` 8 px. Circles only for play buttons and toggles.
- Motion: `--t-micro` 140 ms, `--t-ui` 240 ms, `--t-edit` 560 ms; `--ease-out`, `--ease-in-out`, `--ease-snap`.
- Z: shelf 10, transport 30, now playing 40, menus/dialogs 60, toasts 70, intro 100.

## Type scale
10 · 11 · 12.5 · 14 (body) · 16 · 20 · 28 · 40 · 60 · 88. Display sizes use `clamp()` against viewport width.
Utilities: `.label` (spaced caps), `.mono` (tabular figures), `.display`, `.hand`, `.truncate`.

## Components
| Component | Notes |
|---|---|
| `Icon` | Custom 24-grid set. Transport glyphs solid, others 1.6 stroke, square caps |
| `IconButton` | ghost / solid / outline; `active` shows a red dot, not a colour flood |
| `Button` | primary (paper), secondary (hairline), quiet. Spaced-caps label |
| `Slider` | Pointer-captured, keyboard steps, hover time preview, rail thickens on hover |
| `Artwork` | Square, never cropped, jewel-case sheen; fallback is a printed blank sleeve seeded by title |
| `Section` | `01 — TITLE ————— action` insert-style header |
| `TrackList` | Virtualised grid rows 46 px; multi-select (Ctrl/Shift), Enter plays, drag to playlists, playlist reorder, disc headers, container-query columns |
| `AlbumGrid` / `AlbumShelf` | Virtualised grid / horizontal shelf |
| `ContextMenu` | Positioned in-viewport, keyboard navigable, submenus |
| `Dialog` | prompt / confirm with a burgundy top rule |
| `EmptyState` | Open jewel case + one handwritten line |
| `Segmented`, `Toasts`, `Playing` (level meter) | |

## Patterns
- Pages open with a small `.label`, then a big display title. Metadata in mono below.
- Ambient artwork colour: radial washes at the top of album/artist pages and behind Now Playing, masked to fade.
- Hover reveals (play buttons, favourite hearts) never shift layout.
- Focus: 1.5 px paper outline, 2 px offset. Inputs rely on their own underline/border.
- Empty, loading and error states exist for every data view; loading is three bars, not a spinner.

## Responsive
- Desktop minimum window 980×640. Transport compresses below 1180; Now Playing drops the side panel below 1100;
  track lists hide the album column below 720 px container width.
- Mobile/PWA layouts are a separate composition (see `docs/MOBILE.md`), not a squashed desktop.

## Accessibility
Roles on sliders, menus, dialogs, tabs and grids; `aria-live` for scan status, toasts and the track that just
started; keyboard shortcuts (Space, Ctrl+K, Ctrl+←/→, Ctrl+↑/↓, Alt+←/→, Ctrl+M/S/R/J/L, Ctrl+/, F11) with a
sheet on Ctrl+/; `prefers-reduced-motion` respected everywhere. Dialogs trap Tab and return focus where it was;
a route change puts the keyboard in the new page unless something else has taken it.

Contrast is a token rule, not a per-screen judgement: `--paper-1` and `--paper-2` are body text, `--paper-3` is
the floor for anything readable (4.6:1 or better on every ink), and `--paper-4` is for counts, placeholders and
disabled text only. `--red-soft` marks the playing row and stays legible over hover and selected rows; full
`--red` is for marks and accents, not small text on light backgrounds.

`node tests/e2e/a11y.mjs` runs axe-core over the main screens against the dev app and fails on serious or
critical violations. Run it after layout or colour changes.
