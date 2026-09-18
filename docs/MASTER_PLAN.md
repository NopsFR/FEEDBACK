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

- [x] Windows SMTC: session appears in the OS media flyout with title/artist; pause from Windows verified, next/previous exposed (session is listed under the WebView2 host name)
- [x] Layout QA at 980×640 (min window), 1280×720@150%, 1536×864@125%, 2560×1440; content column widens on large displays
- [x] Startup intro FULL frames checked (carrier line → spikes → misregistered print → tear exit)
- [x] Rule-based smart playlists (all/any rules across metadata, dates, plays, favourites, codec and duration; safe bound SQL; editable sorting and limits)
- [x] Phone edits: favourites and manual playlist create/rename/add/remove/reorder/delete persist offline and sync on reconnect; retry receipts prevent duplicates and conflicting playlist edits preserve a phone copy (automated browser and Rust checks; real iPhone check remains open)
- [x] Now Playing disc mode: existing GLB loaded on demand with the sleeve screen-printed onto the label, pauses with playback, respects reduced motion, and falls back to artwork when WebGL or the chunk is unavailable
- [x] Phone QA at 320/360/390/430 and landscape: the touch shell now covers short viewports, Now Playing reflows beside the artwork, empty states stop clipping
- [x] PWA offline shell survives releases: the service worker caches the entry scripts on install, refreshes them from each navigation and retires only the assets the previous build referenced
- [x] Find artwork online: opt-in MusicBrainz release match plus Cover Art Archive sleeves, rate-limited and metadata-only, applied to FEEDBACK's artwork cache without touching the files (live service check runs with `cargo test -- --ignored`)
- [x] Queue keeps: save the current queue as a playlist; keyboard map available with Ctrl / and from About
- [x] Runs: "Start a run from here" builds a listening run from the local library (artist, genre, era and favourites, thinned so no album takes over), on desktop and phone
- [x] Missing files: tracks whose files moved or went offline are counted in Settings and reviewed on their own page — look again, or remove them from the library; nothing is deleted from disk
- [x] Accessibility pass: axe-core sweep of the main screens (no serious or critical findings), grid semantics for track lists, dialog focus trapping, a live region for playback, and contrast-safe text tokens
- [x] Catalogue foundation: canonical models, provider interfaces, per-provider request lanes (pacing, Retry-After, circuit breaker), a versioned SQLite cache with TTLs and pruning, entity resolution that keeps versions apart, and a search orchestrator that merges the local library with providers
- [x] MusicBrainz (identity) and Cover Art Archive (sleeves) behind that layer, with the artwork finder moved onto it; search shows catalogue results marked as metadata, never as playable

## Open
- [x] Catalogue: LRCLIB lyrics — synced, plain, instrumental and not-found kept distinct; your own .lrc always wins; duration-checked matching
- [ ] Catalogue: ListenBrainz recommendations, then Jamendo for genuinely streamable independent music (see FEEDBACK_ENGINEERING_STATUS.md)
- [ ] Developer panel: provider health, cache statistics and the search debugger (the data is already collected)
- [ ] Enrichment pipeline: link local tracks to canonical ids by confidence, never overwriting user-edited tags
- [~] iPhone: test on a real device (certificate trust, Home Screen install, lock-screen playback) — see MOBILE.md checklist
- [ ] Android build (needs Android SDK/NDK install) and native iOS (needs a Mac) — see IOS.md
- [ ] Code signing (not available at £0), trademark check before any public release
- [ ] Wide-format decoding for WavPack/APE (symphonia doesn't support them)
