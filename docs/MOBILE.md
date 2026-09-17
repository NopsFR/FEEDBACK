# FEEDBACK on a phone (PWA)

The phone app is the same React code built in PWA mode (`pnpm build:pwa` → `dist-pwa/`). The desktop app bundles
it and serves it over your local network when **Settings → Devices → Phone access** is on. No cloud, no account, no
App Store.

## How it fits together
```
iPhone Safari / Home Screen app ──HTTPS (LAN)──▶ FEEDBACK desktop (port 47821)
        │                                          ├─ /            PWA shell
        │                                          ├─ /api/*       library JSON (bearer token)
        │                                          └─ /media/*     audio (Range) + artwork (?t=token)
        └─ OPFS: saved albums/playlists + catalog.json  → plays with no connection
```
- `http://<pc-ip>:47822` is a plain setup page: download the local CA, trust it, then continue to `https://<pc-ip>:47821`.
- HTTPS is required because iOS only enables service workers, OPFS and reliable storage in secure contexts.
- Pairing: desktop shows a 6-digit single-use code (valid 5 minutes). The phone exchanges it for a random 256-bit
  token. Tokens are stored hashed (blake3) and can be revoked from Settings → Devices.
- Only library tracks by id, cached artwork by hash and the PWA files are served. No filesystem browsing.

## Setup on an iPhone
1. On the computer: Settings → Devices → turn on phone access. Scan the QR or open the setup URL on the phone.
2. Download the certificate → Settings → General → VPN & Device Management → install "FEEDBACK Local Library CA".
3. Settings → General → About → Certificate Trust Settings → enable full trust for it.
4. Open the `https://` address in Safari → Share → Add to Home Screen.
5. Open FEEDBACK from the Home Screen, tap New code on the computer, type the code.

The certificate is generated on your computer and never leaves your network. Remove the profile any time.
If your computer's IP changes, the server issues a new leaf certificate automatically (same trusted CA).

## What works where
| | Same Wi-Fi as computer | Away from home / no signal |
|---|---|---|
| Browse whole library, search | ✓ | Saved items only |
| Stream any track | ✓ | — |
| Play saved albums/playlists | ✓ | ✓ |
| Favourites / play counts | ✓ | Edits/plays are queued and sent when back on Wi-Fi |
| Edit manual playlists | ✓ | Create, rename, add, remove, reorder and delete previously opened playlists |
| Smart-playlist rules, import, tags | On the computer | — |

Phone playlist/favourite edits survive reloads. Open a playlist while connected to keep its editable metadata;
save it explicitly to download its audio. Long-press a track for Move up / Move down. Pending edit count, retry,
and discard controls are on **On this phone**. If both devices change a playlist, the desktop version is retained
and phone edits become a separate “phone copy”. A conflicting delete waits for review. Removed desktop tracks are
skipped with a notice. Favourite edits apply when received by the computer. Pending changes belong to the pairing
that created them; pairing with a different computer does not send that old queue to the new computer.

Automated tests cover phone-width browser rendering, persistence across reload, reconnect, retry receipts,
duplicate entries, conflict copies and smart-playlist protection. This does not replace real iPhone testing.

Remote access away from home is deliberately not built in. If you want it, put both devices on a private network you
control (e.g. WireGuard or Tailscale's free tier) and use the computer's address on that network. Never port-forward the
server to the internet.

## Storage (Safari, 2026)
- Saved media goes to the Origin Private File System; Cache Storage is the fallback.
- Safari gives each origin a share of free disk; FEEDBACK shows the browser's own estimate (`navigator.storage.estimate()`)
  on **Library → On this phone** and asks for persistent storage. Home Screen web apps are not subject to Safari's
  7-day script-storage eviction for sites, but iOS can still clear data under storage pressure — the page says so.
- Sizes are shown before saving; albums over 150 MB ask for confirmation. There is no automatic background download.
- A whole desktop library is not mirrored to the phone; you choose albums/playlists.

## Audio on iOS
- Playback uses a plain `<audio>` element on iOS (no Web Audio graph) so it keeps playing with the screen locked and
  shows lock-screen controls through the Media Session API. EQ and the visualiser are desktop features.
- iOS ignores `audio.volume`; use the hardware buttons.
- Formats: MP3, AAC/M4A, ALAC, FLAC, WAV play natively. Ogg Vorbis/Opus support depends on the iOS version — FEEDBACK
  skips a track it can't decode and says so.
- Background playback behaviour of Home Screen web apps has changed between iOS releases. Test on your iOS version;
  if audio stops when locked, the native iOS build (see IOS.md) is the fix.

## Mobile interface
Touch-first shell (`src/app/mobile`): bottom tabs (Home, Search, Library, Settings), mini player above the tabs
(swipe up to open, swipe sideways to skip), full player (swipe art to skip, drag down to close, lyrics/queue toggles),
long-press → action sheets. Safe areas (`env(safe-area-inset-*)`), 44 px+ touch targets.

## Testing checklist (real device)
- [ ] Setup page reachable, certificate installs and trusts
- [ ] Add to Home Screen launches standalone with the FEEDBACK icon and dark status bar
- [ ] Pairing succeeds; revoking on desktop sends the phone back to the pairing screen
- [ ] Stream FLAC, MP3, AAC, ALAC; seek works
- [ ] Save album; airplane mode → album still plays; lock screen controls work
- [ ] Storage page shows usage; remove album frees space
