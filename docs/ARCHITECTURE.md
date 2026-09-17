# FEEDBACK — Architecture

## Shape

```
┌──────────────── React UI (src/) ─────────────────┐
│ features/*  ── state/* (zustand) ── services/*   │
│ player: queue.ts (pure) + engine.ts (Web Audio)  │
└───────────────┬──────────────────┬───────────────┘
        invoke / events       fbmedia:// (Range)
┌───────────────┴──────────────────┴───────────────┐
│ Rust (src-tauri/src)                              │
│ commands.rs → library/{query,mutate,scan,store}   │
│ database (SQLite, migrations)  metadata (lofty)   │
│ media.rs (protocol)  library/watch.rs (notify)    │
└───────────────────────────────────────────────────┘
          media files stay where they are
```

The UI never sees file paths for playback. Rust serves bytes by **track id** over the `fbmedia` custom protocol
(`http://fbmedia.localhost/track/<id>` on Windows/Android, `fbmedia://localhost/...` elsewhere) with HTTP Range support,
so `<audio>`/`<video>` can seek. Artwork is served from a content-addressed cache: `/art/<hash>/<160|480|0>`.

## Why playback lives in the WebView
One engine for desktop, the iPhone PWA and future native mobile shells. `HTMLAudioElement` decodes what the platform
supports (WebView2/Chromium: MP3, AAC/M4A, FLAC, WAV, Ogg Vorbis, Opus; WKWebView adds ALAC but lacks Vorbis), and a Web
Audio graph adds what a player needs:

```
deck A <audio> ─ gain ┐
                      ├─ EQ (10 biquads) ─ master gain ─ analyser ─ out
deck B <audio> ─ gain ┘
```

- Deck B preloads the next track → near-gapless transitions and crossfades (`engine.ts`).
- ReplayGain is applied per deck from tags (`rg_track_gain` / `rg_album_gain`).
- The analyser feeds the visualiser only while Now Playing is visible.
- Media Session API wires OS media keys / SMTC / lock screen.
- Autoplay policy is relaxed on desktop via WebView2 args (`tauri.conf.json → additionalBrowserArgs`).

Known limit: codecs the WebView can't decode (ALAC on Windows, WavPack, APE) report an error and are skipped with a
notice. Planned: Rust-side decode to PCM WAV stream via symphonia for those formats only.

## Queue
`features/player/queue.ts` is pure and unit-tested. `features/player/store.ts` is the single authority that combines queue
state, the engine, play counting (50% or 4 min = play; <30% = skip) and persistence (`setting` key `player.state`).
Restore on launch loads the queue paused unless "Resume on launch" is on.

## Library engine
- `scan.rs`: walk folders → diff by (path, size, mtime) → read tags in parallel (rayon) → write in 48-file transactions →
  mark vanished files `missing` (keeps favourites/plays if a drive is unplugged) → prune empty albums/artists.
- Progress events: `scan-progress`; completion: `library-changed` (UI invalidates caches).
- `watch.rs`: debounced (4 s quiet) notify watcher triggers incremental rescans.
- Fallbacks: missing title → filename (strips `03 - `); missing album/artist → parent/grandparent folder names.
- Artwork: embedded front cover → folder image (`cover`, `folder`, `front`…) → UI fallback sleeve. Originals stored once
  by blake3 hash; JPEG thumbnails 160/480; palette pre-computed.
- Search: SQLite FTS5 (contentless, `unicode61 remove_diacritics`, prefix indexes) for tracks; LIKE for albums/artists.

## Data
SQLite in the app data dir (`%APPDATA%\app.feedback.player\feedback.db` on Windows). Migrations in
`database/migrations.rs` (append-only, `PRAGMA user_version`, currently v4). WAL mode. Tables: `library_folder, artist, album, track,
artwork, play_stats, play_history, favourite, playlist, playlist_track, setting, track_fts`.

Smart playlists store validated JSON rules in `playlist.rules`. `library/smart.rs` compiles a fixed whitelist of fields,
operators and sort orders into SQL; user values are always bound parameters. Their entries and summary artwork/counts are
computed from the current library, while a `NULL` rules value keeps the manual playlist behaviour.

## Services abstraction
`src/services/library.ts` defines `LibraryService`. Desktop uses `tauriLibrary`. The PWA will provide an implementation
backed by the desktop's LAN sync server + IndexedDB/OPFS for offline albums. UI code only imports `library`.

## Security
- Capabilities (`src-tauri/capabilities/default.json`) grant only window chrome, dialogs and reveal-in-folder.
- No shell plugin, no fs plugin exposed to the UI. Media protocol accepts ids and 32-hex hashes only.
- Strict CSP; media/image sources limited to `self` and `fbmedia`.
- Errors crossing IPC are mapped to user-safe messages (`error.rs`); detail goes to the log file.

## Logging
`tauri-plugin-log` → stdout + `%LOCALAPPDATA%\app.feedback.player\logs\feedback.log` (2 MB rotation). Targets: PLAYER,
LIBRARY, DATABASE, IMPORT, SYNC, DOWNLOAD.

## Dev loop
- `pnpm tauri dev` (Windows needs MSVC env: `.sync/msvc.cmd` wraps the portable toolchain).
- Screenshot QA: start the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then
  `node tests/e2e/drive.mjs steps.json outDir` (uses the dev-only `window.__feedback` handle).
- Test data: `python tests/fixtures/generate.py` builds a synthetic library (generated audio + covers, invented names).
