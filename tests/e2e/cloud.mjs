// The account journey, for real: sign in, sync the library, upload one track's audio, get a signed
// URL, and stream a byte range from it the way a phone would. Runs against the dev app (.sync/dev.ps1).
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const EMAIL = process.env.FEEDBACK_QA_EMAIL ?? "qa-harness@feedback.test";
const PASSWORD = process.env.FEEDBACK_QA_PASSWORD ?? "feedback-qa-2026";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(700);
const ipc = (cmd, args = {}) => page.evaluate(async ({ cmd, args }) => {
  const { call } = await import("/src/services/ipc.ts");
  return call(cmd, args);
}, { cmd, args });

await ipc("cloud_sign_out").catch(() => {});
assert.equal((await ipc("cloud_status")).signedIn, false);

const signedIn = await ipc("cloud_sign_in", { email: EMAIL, password: PASSWORD });
assert.equal(signedIn.signedIn, true, "sign in should succeed");
assert.equal(signedIn.email, EMAIL);

const sync = await ipc("cloud_sync");
assert.ok(sync.tracksPushed > 0, `library should reach the account, pushed ${sync.tracksPushed}`);

const tracks = await page.evaluate(() => window.__feedback.library.tracks());
const one = tracks.find((t) => t.durationMs > 0);
const upload = await ipc("cloud_upload", { trackIds: [one.id] });
assert.ok(upload.uploaded + upload.skipped === 1, `one track should upload, got ${JSON.stringify(upload)}`);

const stream = await ipc("cloud_stream_url", { trackId: one.id });
assert.match(stream.url, /^https:\/\//, "playback must be over https");
assert.ok(stream.expiresAt > Math.floor(Date.now() / 1000), "the link should still be valid");

// Seeking needs ranges: ask for the first 1000 bytes the way a player would.
const ranged = await page.evaluate(async (url) => {
  const r = await fetch(url, { headers: { Range: "bytes=0-999" } });
  const buf = await r.arrayBuffer();
  return { status: r.status, length: buf.byteLength, acceptRanges: r.headers.get("content-range") };
}, stream.url);
assert.equal(ranged.status, 206, "storage must answer partial requests so seeking works");
assert.equal(ranged.length, 1000);

// Playlists and favourites round-trip through the account.
const playlistName = `QA cloud ${Date.now()}`;
const playlistId = await page.evaluate(async ({ name, id }) => window.__feedback.library.createPlaylist(name, [id]), { name: playlistName, id: one.id });
await page.evaluate((id) => window.__feedback.library.setFavourite(id, true), one.id);
await ipc("cloud_sync");
const roundTrip = await ipc("cloud_sync");
assert.ok(roundTrip.playlistsPulled > 0, "playlists should come back from the account");

await page.evaluate((id) => window.__feedback.library.deletePlaylist(id), playlistId);
await page.evaluate((id) => window.__feedback.library.setFavourite(id, false), one.id);
console.log(`PASS: signed in, ${sync.tracksPushed} tracks synced, upload ${upload.uploaded || "(already there)"}, ranged stream ${ranged.length} bytes, ${roundTrip.playlistsPulled} playlists pulled`);
await browser.close();
