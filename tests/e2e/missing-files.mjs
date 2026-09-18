// Missing-files review against the dev app over CDP (.sync/dev.ps1): a fixture file is moved aside, reviewed,
// then put back. It restores the file even if an assertion fails.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { renameSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".sync/qa-missing", { recursive: true });
const FILE = String.raw`C:\Users\nator\FEEDBACK\tests\fixtures\library\Low Tide Choir\2019 - Undertow EP\04 - Drowned Cathedral.opus`;
const AWAY = FILE + ".away";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(700);

const rescan = async () => {
  await page.evaluate(() => window.__feedback.library.rescan());
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__feedback.lib.getState().loadOverview());
  await page.waitForTimeout(400);
};

try {
  renameSync(FILE, AWAY);
  await rescan();
  const missing = await page.evaluate(() => window.__feedback.lib.getState().overview.missing);
  assert.equal(missing, 1, `expected one missing track, saw ${missing}`);

  await page.evaluate(() => window.__feedback.nav.getState().go({ name: "settings" }));
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Review 1/ }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: ".sync/qa-missing/review.png" });
  const body = await page.locator("main").innerText();
  assert.match(body, /Drowned Cathedral/);
  assert.match(body, /unplugged drive/i, "the page should explain what missing means");

  // Put it back: the same file returns to the library on the next scan, no data lost.
  renameSync(AWAY, FILE);
  await page.getByRole("button", { name: "Look again" }).click();
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__feedback.lib.getState().loadOverview());
  const after = await page.evaluate(() => window.__feedback.lib.getState().overview.missing);
  assert.equal(after, 0, `the returned file should clear, saw ${after} missing`);
  await page.screenshot({ path: ".sync/qa-missing/cleared.png" });
  console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
} finally {
  try { renameSync(AWAY, FILE); } catch { /* already back */ }
  await browser.close();
}
