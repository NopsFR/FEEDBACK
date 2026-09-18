# FEEDBACK — working notes for Claude

Local-first music + music-video player. Tauri 2 (Rust) + React 19 + TypeScript + Vite + pnpm. SQLite on device. £0 budget: no paid services, no required cloud.

**Source of truth:** `docs/MASTER_PLAN.md` (checklist), `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, `brand/BRAND_GUIDE.md`. Read only what the task needs. Update docs when decisions change. Don't restate the spec in chat; keep replies short.

## Machine / workflow
- Canonical repo + git history: `C:\Users\nator\FEEDBACK` on Windows 11 (i7-14700KF, 32GB). Build/run there.
- Windows shell access: Desktop Commander `start_process` (PowerShell). `device_bash` is unreliable on this machine — don't rely on it.
- Cloud container (if used) is a scratch working copy. Sync = tar.gz → `device_commit_files` into `C:\Users\nator\FEEDBACK\.sync\` → verify SHA256 on Windows → `tar -xzf` in repo root. Always hash-verify commits: `device_commit_files` usually writes a stale copy on the first call — commit twice, then run `.sync/apply.ps1 -Hash <sha>`.
- Toolchain on Windows: Node 24, pnpm 11, Rust 1.97 (msvc), VS 2026 Build Tools (MSVC 14.51, SDK 10.0.26100), WebView2 153, Python 3.13, Blender 5.2.1 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, run headless with `-b -P script.py`). No Adobe apps, no Android SDK, no macOS.
- crates.io is reachable from Windows, not from the cloud container. npm registry reachable from both.
- Screenshot QA without touching the user's mouse: run dev with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then `node tests/e2e/drive.mjs <steps.json> .sync/qaN` and stage the PNGs.
- Blender: prefer headless CLI scripts in `design/blender/*.py`. If the MCP bridge fails, don't burn time on it.
- Run git through PowerShell (Desktop Commander), never `device_bash`: the Linux VM's git leaves a `.git/index.lock` it can't remove and reports every file as changed (no `core.autocrlf` there).
- PowerShell `>` writes UTF-16. Redirect through `cmd /c "... > file"` when a tool has to read the output back.
- Vite HMR goes stale when a file gains a new component; restart `.sync\dev.ps1` before screenshot QA or you'll chase phantom "X is not defined" errors.
- User doesn't want routine status messages. Only interrupt for real blockers.

## Brand (short)
- Name is exactly `FEEDBACK`. Wordmark: heavy expanded caps, A replaced by a waveform spike burst, signal line cutting through D–B and trailing past K. Symbol: the spike burst (optionally inside a disc ring). No ®/© marks (not registered).
- Palette: charcoal #0B0B0B, concrete #3A3A3A, worn chrome #A7A7A7, paper #D9D4C7, burgundy #8B0F1A, accent red #FF2A3A (sparingly).
- Type: Archivo Expanded (display, OFL), Inter (UI, OFL), IBM Plex Mono (timecodes/specs, OFL), Covered By Your Grace (handwritten notes, rare, OFL).
- Copy lines: "Music people repeat." / "Louder things last longer." No startup-speak.
- Logo sources are generated: `design/generators/brand_v2.py` → `brand/logo/*.svg`; icons: `design/generators/icon_render.py`.

## State (see MASTER_PLAN for detail)
Working 0.1.0: desktop app, installer, library engine, playback, core UI, Now Playing, playlists, metadata editor,
downloads, LAN phone server + PWA with offline albums, brand system, renders, marketing, landing page.
Useful scripts on Windows: `.sync\dev.ps1` (restart dev with CDP), `.sync\cargotest.cmd`, `tests/e2e/drive.mjs`,
`tests/e2e/pwa.mjs <code>`, `tests/e2e/prod-smoke.mjs`, `tests/e2e/phone-edits.mjs`, `tests/e2e/phone-widths.mjs`,
`tests/e2e/smart-playlists.mjs`, `tests/e2e/radio.mjs`, `tests/e2e/a11y.mjs`, `tests/e2e/queue-and-keys.mjs`, `tests/e2e/artwork-finder.mjs`, `tests/e2e/pwa-shell.mjs` (needs `pnpm build:pwa` + `pnpm vite preview --outDir dist-pwa --port 4173`). Blender: `blender -b -P design/blender/build_assets.py`.

## Code rules
- One authoritative playback/queue service (`src/features/player/engine`). No fake controls.
- Frontend talks to data through `src/services/library` interface (Tauri impl now; HTTP/IndexedDB impls for PWA).
- Media served by Rust custom protocol by **track id only** — never arbitrary paths.
- Tokens in `src/styles/tokens.css`; no `transition: all`; respect reduced motion; no `!important`.
- Rust errors → user-safe messages in UI; technical detail to log.
- Tests: `pnpm test` (vitest), `cargo test` in `src-tauri`.
