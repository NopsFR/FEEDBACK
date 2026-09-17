# FEEDBACK — Master Plan

`[x]` done & verified · `[~]` partial / needs real-device check · `[ ]` open. Finished phases are collapsed.

## Done
- [x] **0 Environment** — Windows toolchain (portable MSVC), git, Tauri 2 + React 19 + TS + Vite + pnpm, IPC verified
- [x] **1 Brand** — wordmark (clean/worn), symbol, small symbol, emblem, icon & favicon glyphs, lockups, app icons, textures, brand sheet, BRAND_GUIDE, motion sting
- [x] **2 Design foundation** — tokens, fonts bundled, custom icon set, shell (Titlebar/Shelf/Stage/Transport), motion + reduced motion, DESIGN_SYSTEM
- [x] **3 Library engine** — SQLite migrations (v3), folders, incremental parallel scan, tags, artwork cache + palette, missing-file handling, FTS5, folder watching, fbmedia protocol with Range; 20k-track perf test (all tracks 55 ms, search 7 ms)
- [x] **4 Playback** — two-deck engine + Web Audio graph, authoritative queue (unit tested), shuffle/repeat/seek/volume/mute, play next/add/reorder/remove/clear/history, persistence + paused restore, Media Session, error skip; ALAC/AIFF via on-the-fly PCM
- [x] **5 Core UI** — Home, Albums, Album, Artists index, Artist, Tracks, Genres & years, Search, Playlists, Queue, context menus, dialogs, toasts, empty/loading/error states
- [x] **6 Now Playing** — artwork ambient colour, synced lyrics, up next, details, visualiser signal line, sleep timer, full artwork view
- [x] **7 3D** — Blender family built by script (disc, jewel case, cable + jack), renders, `.blend`, GLB exports
- [x] **8 Startup** — FULL / FAST / OFF intro, optional synthesised sting, app boots underneath
- [x] **9 Advanced library** — playlist CRUD/reorder/duplicate/drag-to-shelf, favourites, history, most played, recently added, metadata editor (verified temp-copy writes), custom album art, drag-drop + file import, videos (thumbnails, player), validated direct downloads
- [x] **10 Audio** — 10-band EQ + presets, ReplayGain track/album, gapless preload, crossfade, visualiser
- [x] **11–12 PWA** — touch shell, mini + full player with gestures, action sheets, manifest/icons/service worker, pairing screen, OPFS offline albums/playlists, storage meter + persistence request, queued plays
- [x] **13 Device sync** — opt-in LAN HTTPS server, local CA + leaf certs, setup page + QR, single-use pairing codes, hashed revocable tokens, scoped media/art/API (curl + headless Edge verified)
- [x] **15 Marketing** — screenshots, renders, social header/OG, wallpapers, press kit, landing page (`site/`)
- [x] **16 Windows release** — NSIS installer built, installed, launched, played (0.1.0)

## Open
- [~] iPhone: test on a real device (certificate trust, Home Screen install, lock-screen playback) — see MOBILE.md checklist
- [~] Windows media keys / SMTC via WebView2 Media Session — wired, not yet confirmed on the OS flyout; fallback plan: `souvlaki` crate
- [ ] QA at 125% / 150% scaling and 2560×1440 (done: 1440×900, 1100×700, 390×844)
- [ ] Rule-based smart playlists (year/genre/plays filters) — current smart lists are fixed views
- [ ] Phone: edit playlists/favourites offline and reconcile on reconnect (currently favourites/plays sync; playlists are read-only on phone)
- [ ] Use the disc GLB in-app (e.g. Now Playing "disc" mode) — assets exist, runtime not integrated
- [ ] Android build (needs Android SDK/NDK install) and native iOS (needs a Mac) — see IOS.md
- [ ] Code signing (not available at £0), trademark check before any public release
- [ ] Wide-format decoding for WavPack/APE (symphonia doesn't support them)
