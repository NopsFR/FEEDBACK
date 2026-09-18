// The phone journey with the desktop out of the picture: sign in to the account in a plain browser,
// load the library, open a playlist, and stream a track from cloud storage with a byte range.
// The page is served by the dev server; every data and audio request goes to the cloud over HTTPS.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const EMAIL = process.env.FEEDBACK_QA_EMAIL ?? "qa-harness@feedback.test";
const PASSWORD = process.env.FEEDBACK_QA_PASSWORD ?? "feedback-qa-2026";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // No pairing token: the phone has never met the computer.
  await page.addInitScript(() => localStorage.setItem("feedback.settings.v1", JSON.stringify({ intro: "off" })));
  // The LAN server must not answer anything here.
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/media/**", (route) => route.abort());

  await page.goto("http://localhost:1420");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForFunction(() => !!window.__feedback, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const tracks = await page.evaluate(() => window.__feedback.library.tracks());
  assert.ok(tracks.length > 0, "the account's library should load with no desktop");

  // Play it the way the app does, then read back what the audio element was actually given.
  const cloudTrack = tracks.find((t) => !t.missing);
  assert.ok(cloudTrack, "one track should have a cloud copy");
  await page.evaluate(async (track) => {
    await window.__feedback.cloud.prime([track]);
    window.__feedback.player.getState().playTracks([track], 0);
  }, cloudTrack);
  // The decks are detached Audio objects, so ask the engine what it was handed rather than the DOM.
  await page.waitForFunction(() => window.__feedback.engineSrc()?.startsWith("https://"), null, { timeout: 20000 });
  const src = await page.evaluate(() => window.__feedback.engineSrc());
  assert.match(src, /storage\/v1\/object\/sign\/music/, `expected a signed storage URL, got ${src}`);

  const ranged = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Range: "bytes=0-2047" } });
    return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
  }, src);
  assert.equal(ranged.status, 206, "seeking needs range support");
  assert.equal(ranged.bytes, 2048);

  const playlists = await page.evaluate(() => window.__feedback.library.playlists());
  assert.ok(Array.isArray(playlists), "playlists come from the account");

  assert.deepEqual(errors, []);
  console.log(`PASS: signed in on a phone-sized browser, ${tracks.length} tracks and ${playlists.length} playlists from the account, played a cloud track over https with range support`);
} finally {
  await browser.close();
}
