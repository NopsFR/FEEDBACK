// The artwork finder must stay silent until the user opts in.
// Runs against the dev app over CDP (start it with .sync/dev.ps1). No network is needed or allowed here.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
const calls = [];
page.on("request", (r) => /musicbrainz|coverartarchive/.test(r.url()) && calls.push(r.url()));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(600);

await page.evaluate(async () => {
  window.__feedback.ui.getState().setDialog(null);
  const { library } = await import("/src/services/library.ts");
  await library.setSetting("settings.onlineLookups", false);
});
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(800);

const album = await page.evaluate(async () => (await window.__feedback.library.albums())[0]);
await page.evaluate((id) => window.__feedback.nav.getState().go({ name: "album", id }), album.id);
await page.waitForTimeout(700);
await page.getByRole("button", { name: "More", exact: true }).click();
await page.getByText("Find artwork online…").click();
await page.getByText("Turn on and search").waitFor();
const body = await page.locator('[role="dialog"]').innerText();
assert.match(body, /only this album's title and artist/i, "the dialog must say what is sent");
assert.match(body, /nothing is played from those services/i, "the dialog must say these are catalogue services");
await page.waitForTimeout(1500);
assert.deepEqual(calls, [], "nothing may be requested before the user opts in");
await page.evaluate(() => window.__feedback.ui.getState().setDialog(null));
console.log("PASS: artwork lookups stay off until the user turns them on.");
await browser.close();
