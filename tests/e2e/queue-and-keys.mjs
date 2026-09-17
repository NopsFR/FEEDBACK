// Queue → save as playlist, and the keyboard sheet, against the dev app over CDP (.sync/dev.ps1).
// Screenshots land in .sync/qa-polish; the playlist it creates is removed again at the end.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".sync/qa-polish", { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(800);
await page.evaluate(() => { window.__feedback.ui.getState().setDialog(null); window.__feedback.ui.getState().setNowPlaying(false); });

// Shortcut sheet
await page.keyboard.press("Control+/");
await page.getByRole("dialog", { name: "Keyboard" }).waitFor();
await page.screenshot({ path: ".sync/qa-polish/shortcuts.png" });
await page.keyboard.press("Escape");

// Queue → save as playlist
await page.evaluate(async () => {
  const tracks = await window.__feedback.library.tracks();
  window.__feedback.player.getState().playTracks(tracks.slice(0, 6), 0);
  window.__feedback.player.getState().pause?.();
  window.__feedback.ui.getState().toggleQueue(true);
});
await page.waitForTimeout(700);
await page.screenshot({ path: ".sync/qa-polish/queue.png" });
await page.getByRole("button", { name: "Save queue as playlist" }).click();
await page.getByPlaceholder("Name").fill("Queue keeper");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForFunction(() => window.__feedback.nav.getState().route.name === "playlist");
await page.waitForTimeout(900);
const count = await page.evaluate(async () => (await window.__feedback.library.playlist(window.__feedback.nav.getState().route.id)).entries.length);
assert.equal(count, 6, "the queue should be saved in full");
await page.screenshot({ path: ".sync/qa-polish/saved.png" });
await page.evaluate(async () => {
  const id = window.__feedback.nav.getState().route.id;
  await window.__feedback.library.deletePlaylist(id);
  window.__feedback.player.getState().pause?.();
  window.__feedback.ui.getState().toggleQueue(false);
  window.__feedback.nav.getState().go({ name: "home" });
});
console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
await browser.close();
