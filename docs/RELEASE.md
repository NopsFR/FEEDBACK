# Releasing FEEDBACK for Windows

## Build
```powershell
# from repo root, with MSVC on PATH (see CLAUDE.md for this machine's portable toolchain)
pnpm install
pnpm tauri build
```
`beforeBuildCommand` runs `pnpm build && pnpm build:pwa`; the PWA is bundled as a resource (`pwa/`) for phone access.
Output: `src-tauri/target/release/bundle/nsis/FEEDBACK_<version>_x64-setup.exe` (~7 MB).

## What the installer does (verified 0.1.0)
- Per-user install (no admin) to `%LOCALAPPDATA%\FEEDBACK\` — `feedback.exe`, `pwa\`, `uninstall.exe`.
- Start menu shortcut `FEEDBACK.lnk`; Apps & Features entry "FEEDBACK 0.1.0" with the FEEDBACK icon.
- Icons: `src-tauri/icons/icon.ico` contains 16–256 px frames; 16–32 px use the simplified 5-spike glyph.
- NSIS header/sidebar art: `src-tauri/installer/*.bmp`.

## Data locations
| What | Where |
|---|---|
| Library database | `%APPDATA%\app.feedback.player\feedback.db` |
| LAN certificates | `%APPDATA%\app.feedback.player\lan\` |
| Artwork cache | `%LOCALAPPDATA%\app.feedback.player\art\` |
| Logs | `%LOCALAPPDATA%\app.feedback.player\logs\feedback.log` |
| Imported files | `%USERPROFILE%\Music\FEEDBACK Imports\` |
Uninstalling leaves library data in place (so reinstalling keeps playlists). Delete the folders above to reset.

## Versioning
Bump `version` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together. Commit, tag `vX.Y.Z`.

## Signing
Not signed (no certificate — £0 budget). Windows SmartScreen shows "unknown publisher" until a signed build builds
reputation. Free options if this ever goes public: SignPath's OSS programme or Azure Trusted Signing (paid) — decide
then. Never commit certificates or keys.

## Pre-release checklist
- [ ] `pnpm typecheck && pnpm test` and `cargo test --lib` pass
- [ ] Fresh install on a clean user profile; first-run empty state; import a folder; playback of MP3/FLAC/ALAC
- [ ] Phone access: setup page, pairing, save an album, offline playback
- [ ] No Tauri default icons anywhere (taskbar, alt-tab, installer, Apps & Features)
- [ ] Trademark/name check before any public distribution
