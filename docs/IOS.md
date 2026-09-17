# Native iOS build (future path)

FEEDBACK is a Tauri 2 app, and Tauri 2 targets iOS. **Building for iOS needs a Mac with Xcode** — Apple's toolchain
doesn't run on Windows, so this can't be produced from the current PC. The PWA (MOBILE.md) is the £0 iPhone route today.

## Why go native later
- Guaranteed background audio + remote controls via AVAudioSession.
- Direct file import from the Files app into the app sandbox, no browser storage limits.
- Same Rust library engine (SQLite, scanning, tags) on the phone.

## What's already compatible
- `src-tauri/Cargo.toml` uses `crate-type = ["staticlib", "cdylib", "rlib"]` (required for mobile).
- `tauri icon` generated `src-tauri/icons/ios/*` from the full-bleed master.
- Desktop-only plugins are gated (`single-instance` under `cfg(not(any(android, ios)))`).
- Media protocol URLs are resolved per platform (`src/services/platform.ts`).
- UI has a touch layout that activates by viewport width.

## Steps on a Mac
1. Install Xcode (App Store), then `xcode-select --install`.
2. `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`
3. `brew install cocoapods` (if prompted), `pnpm install`
4. `pnpm tauri ios init` — creates `src-tauri/gen/apple`.
5. Open Xcode → Settings → Accounts → add your Apple ID (free Personal Team).
6. `pnpm tauri ios dev` with an iPhone connected (enable Developer Mode on the phone: Settings → Privacy & Security).
7. For audio: add `UIBackgroundModes = [audio]` to Info.plist and configure `AVAudioSession` category `.playback`
   (small Swift plugin or `tauri-plugin` wrapper) so playback continues when locked.

## Free Personal Team limits (as of 2026 — check Apple's current terms)
- Apps are signed for **7 days**; after that the app won't launch until you rebuild/reinstall from Xcode.
- Limited number of apps/devices per week and no App Store/TestFlight distribution.
- Some capabilities (push, iCloud) unavailable. Background audio works.

Refresh workflow: connect phone → `pnpm tauri ios build --debug` or Run from Xcode → app re-signed for another 7 days.
Library data inside the app survives reinstall if the bundle identifier is unchanged.

## App Store (not required)
Needs the paid Apple Developer Program. If ever wanted: separate release plan, trademark check for the name, privacy
nutrition label (no data collected), and review of any network features.
