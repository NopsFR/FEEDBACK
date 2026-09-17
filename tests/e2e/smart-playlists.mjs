// Desktop checks over CDP (dev app started with .sync/dev.ps1): smart-playlist operators, saving rules,
// live refresh of the open playlist, and Disc mode. Screenshots land in .sync/qa-smart.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".sync/qa-smart", { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(500);
await page.evaluate(() => { window.__feedback.ui.getState().setDialog(null); window.__feedback.ui.getState().setNowPlaying(false); window.__feedback.nav.getState().go({ name: "playlists" }); });
await page.waitForTimeout(600);
await page.getByRole("main").getByRole("button", { name: "New smart playlist" }).click();
await page.getByRole("combobox", { name: "Rule field" }).waitFor();
const ops = async () => page.getByRole("combobox", { name: "Rule comparison" }).locator("option").allTextContents();
await page.getByRole("combobox", { name: "Rule field" }).selectOption("plays");
console.log("plays ops:", (await ops()).join(" / "));
await page.getByRole("combobox", { name: "Rule comparison" }).selectOption("gte");
await page.getByLabel("Rule value").fill("0");
await page.getByPlaceholder("Late-night favourites").fill("QA smart list");
await page.screenshot({ path: ".sync/qa-smart/editor.png" });
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForFunction(() => window.__feedback.nav.getState().route.name === "playlist");
await page.waitForTimeout(800);
const count = () => page.evaluate(async () => (await window.__feedback.library.playlist(window.__feedback.nav.getState().route.id)).entries.length);
const before = await count();
await page.screenshot({ path: ".sync/qa-smart/saved.png" });

// Edit the rules of the open playlist: the page must refresh without navigating away.
await page.getByRole("button", { name: "Edit rules" }).click();
await page.getByRole("combobox", { name: "Rule field" }).waitFor();
await page.getByRole("combobox", { name: "Rule field" }).selectOption("favourite");
await page.getByRole("button", { name: "Save rules", exact: true }).click();
await page.waitForTimeout(1200);
const shown = await page.locator('[role="row"]').count();
const after = await count();
await page.screenshot({ path: ".sync/qa-smart/refreshed.png" });
assert.notEqual(before, after, "rule change must change membership");
assert.ok(shown <= after + 2, `rows on screen (${shown}) should reflect the new rules (${after} tracks)`);

// Disc mode with the current artwork.
await page.evaluate(async () => {
  const tracks = await window.__feedback.library.tracks();
  window.__feedback.player.getState().playTracks(tracks, 0);
  window.__feedback.player.getState().pause?.();
  window.__feedback.ui.getState().setNowPlaying(true);
});
await page.waitForTimeout(700);
const discToggle = page.getByRole("button", { name: "Disc mode" });
if ((await discToggle.getAttribute("aria-pressed")) !== "true") await discToggle.click();
await page.locator('[aria-label="View full artwork"] canvas').waitFor({ state: "visible" });
await page.waitForTimeout(2500);
await page.screenshot({ path: ".sync/qa-smart/disc.png" });
await page.evaluate(() => window.__feedback.player.getState().next());
await page.waitForTimeout(2000);
await page.screenshot({ path: ".sync/qa-smart/disc-next.png" });
await page.evaluate(() => { window.__feedback.ui.getState().setNowPlaying(false); window.__feedback.player.getState().pause?.(); });
// Leave the library as we found it.
await page.evaluate(async () => {
  const lib = window.__feedback.library;
  for (const p of await lib.playlists()) if (p.name === "QA smart list") await lib.deletePlaylist(p.id);
  await window.__feedback.lib.getState().loadPlaylists();
});
console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
await browser.close();
