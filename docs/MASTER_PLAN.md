# FEEDBACK — Master Plan

Status key: `[x]` done & verified · `[~]` partial · `[ ]` not started. Keep this file compact: collapse finished phases to one line each.

## Phase 0 — Environment
- [x] Inspect Windows machine & tooling (see CLAUDE.md)
- [x] Git repo at `C:\Users\nator\FEEDBACK`
- [x] Plan + CLAUDE.md
- [ ] Minimal Tauri app builds and launches; React → Rust IPC verified

## Phase 1 — Brand foundation
- [x] Direction locked from user's reference boards (waveform-A wordmark, spike symbol, worn black/red materials)
- [x] Wordmark (clean + worn) as generated vectors
- [x] Symbol, small symbol, emblem (disc), icon glyph, favicon glyph
- [x] App icon masters (dark + red, rounded + full-bleed) 1024px
- [ ] Lockups: horizontal, stacked, with tagline
- [ ] Texture set: grain, scratches, paper, toner (PNG + source)
- [ ] `brand/BRAND_GUIDE.md`, `docs/DESIGN_SYSTEM.md`
- [ ] Brand sheet render

## Phase 2 — Technical design foundation
- [ ] Tokens (colour, type, space, radius, motion, elevation)
- [ ] Fonts bundled locally
- [ ] Icon set (SVG, consistent stroke) for transport/nav
- [ ] Shell layout: Shelf / Stage / Transport
- [ ] Motion + focus primitives, reduced motion

## Phase 3 — Library engine (Rust)
- [ ] SQLite + migrations (app data dir)
- [ ] Library folders add/remove
- [ ] Recursive scan, background thread, progress events
- [ ] Tag reading (lofty): title/artist/album/albumartist/track/disc/year/genre/duration/codec/bitrate/sample rate/channels
- [ ] Embedded + folder artwork → hashed cache + thumbnails
- [ ] Duplicate handling (path unique; content signature)
- [ ] Incremental rescan (mtime/size), removed files
- [ ] FTS5 search index
- [ ] Media protocol with Range (by track id)
- [ ] Folder watching (notify)

## Phase 4 — Playback
- [ ] Engine: HTMLAudio + WebAudio graph (gain, analyser, EQ)
- [ ] Queue service: play/pause/seek/next/prev/shuffle/repeat(off/all/one)/volume/mute
- [ ] Play next / add to queue / reorder / remove / clear / history
- [ ] Persist queue + position + settings; restore without autoplay
- [ ] Media Session (OS media controls, media keys)
- [ ] Error handling: missing file / unsupported codec → skip with notice

## Phase 5 — Core UI
- [ ] Home (recently added, played, forgotten, random album)
- [ ] Albums, Artists, Tracks (virtualised), Genres, Years
- [ ] Album page, Artist page
- [ ] Search (grouped, instant, Ctrl+K)
- [ ] Playlists list + page
- [ ] Queue panel
- [ ] Transport bar
- [ ] Context menus
- [ ] Empty states, loading, errors

## Phase 6 — Now Playing
- [ ] Expanded view, artwork ambient colour extraction
- [ ] Lyrics (embedded, .lrc synced, .txt)
- [ ] Visualiser
- [ ] Transitions mini ↔ full

## Phase 7 — Graphics / 3D
- [ ] Blender: disc, jewel case, cable + jack (headless scripts, .blend + .glb)
- [ ] Renders for brand/marketing, lazy-loaded runtime model where it adds value

## Phase 8 — Startup
- [ ] FULL / FAST / OFF intro; app initialises in parallel

## Phase 9 — Advanced library
- [ ] Playlist CRUD, reorder, duplicate, multi-select, drag & drop
- [ ] Favourites, history, play counts, smart views
- [ ] Metadata editor (safe writes via lofty)
- [ ] Drag-drop import, file import
- [ ] Music videos (library, thumbnails, playback)
- [ ] Legal direct URL downloader (validated)

## Phase 10 — Audio enhancements
- [ ] EQ + presets, ReplayGain, crossfade, gapless-ish preload, sleep timer

## Phase 11–12 — PWA / mobile
- [ ] Touch-first layouts, safe areas, mini player, gestures
- [ ] Manifest, icons, service worker, offline shell
- [ ] Offline albums in OPFS/IndexedDB with capability detection + quota display
- [ ] iPhone Safari test notes

## Phase 13 — Device sync
- [ ] LAN server (opt-in), pairing token/QR, scoped media only, revoke
- [ ] Transfer media/artwork/metadata/playlists, resume

## Phase 14 — Native iOS prep
- [ ] `docs/IOS.md`: macOS/Xcode requirement, Personal Team limits, steps

## Phase 15 — Marketing
- [ ] Screenshots, logo sheet, icon presentation, hero art, social, press kit, landing page, copy

## Phase 16 — Windows release
- [ ] NSIS installer, icons everywhere, metadata, AppData paths, unsigned-warning docs

## Phase 17 — QA
- [ ] Visual QA at 1366×768 / 1920×1080 / 2560×1440, 100/125/150%
- [ ] Mobile viewports
- [ ] Large library perf (10k+ tracks)
