// Isolated browser integration: desktop disconnect/reload/reconnect, plus lazy disc rendering.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".sync/qa-phone-edits", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let connected = false;
  let serverDetail;
  let favourite = false;
  const receipts = new Map();
  await page.addInitScript(() => { localStorage.setItem("feedback.token", "isolated-phone-test"); localStorage.setItem("feedback.settings.v1", JSON.stringify({ intro: "off" })); });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/edits") {
      if (!connected) return route.abort();
      const edit = route.request().postDataJSON();
      if (!receipts.has(edit.operationId)) {
        if (edit.kind === "favourite") { favourite = edit.on; receipts.set(edit.operationId, {}); }
        else {
          serverDetail = { playlist: { id: 10, name: edit.name, rules: null, description: null, arts: [], trackCount: edit.trackIds.length, durationMs: edit.trackIds.length * 1000, updatedAt: 1 }, entries: edit.trackIds.map((id, index) => ({ entryId: index + 100, track: { id, title: "Test track", artist: "Test artist", album: "Test album", durationMs: 1000, favourite } })) };
          receipts.set(edit.operationId, { detail: serverDetail });
        }
      }
      return route.fulfill({ json: receipts.get(edit.operationId) });
    }
    if (path === "/api/playlists") return route.fulfill({ json: serverDetail ? [serverDetail.playlist] : [] });
    if (path === "/api/tracks/by-ids") return route.fulfill({ json: [{ id: 1, title: "Test track", artist: "Test artist", album: "Test album", albumArtist: "Test artist", durationMs: 1000, favourite: false, missing: false, kind: "audio", hasLyrics: false, playCount: 0, addedAt: 0, fileSize: 1 }] });
    if (path === "/api/playlist/10") return route.fulfill({ json: serverDetail });
    if (path === "/api/overview") return route.fulfill({ json: { tracks: 0, albums: 0, artists: 0, videos: 0, folders: 0, durationMs: 0 } });
    if (path === "/api/home") return route.fulfill({ json: { recentlyAdded: [], recentlyPlayed: [], mostPlayed: [], forgotten: [], randomAlbums: [], genres: [], videos: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.__feedback);
  await page.evaluate(async () => {
    const library = window.__feedback.library;
    await library.tracksByIds([1]);
    await library.setFavourite(1, true);
    const id = await library.createPlaylist("Offline mix", [1, 1]);
    window.__feedback.nav.getState().go({ name: "playlist", id });
  });
  await page.getByText("Offline mix", { exact: true }).first().waitFor();
  await page.screenshot({ path: ".sync/qa-phone-edits/offline-playlist.png" });
  await page.reload();
  await page.waitForFunction(() => !!window.__feedback);
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("feedback.phone.v1.isolated-phone-test")).pending.length);
  assert.equal(pending, 2);
  connected = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("feedback.phone.v1.isolated-phone-test")).pending.length === 0);
  assert.equal(favourite, true);
  assert.equal(serverDetail.entries.length, 2);
  await page.evaluate(() => window.__feedback.nav.getState().go({ name: "playlist", id: 10 }));
  await page.getByText("Offline mix", { exact: true }).first().waitFor();
  await page.screenshot({ path: ".sync/qa-phone-edits/synced-playlist.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    window.__feedback.player.setState({ current: { id: 1, title: "Test track", artist: "Test artist", album: "Test album", durationMs: 1000, favourite: true, kind: "audio" }, playing: false });
    window.__feedback.ui.getState().setNowPlaying(true);
  });
  await page.getByRole("button", { name: "Disc mode", exact: true }).click();
  await page.locator('[aria-label="View full artwork"] canvas').waitFor({ state: "visible" });
  await page.screenshot({ path: ".sync/qa-phone-edits/disc.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: offline edits survive reload, reconnect acknowledges changes, duplicate entries preserved, disc rendered; no page errors.");
} finally { await browser.close(); }
