// Accessibility sweep over the main screens with axe-core, against the dev app (.sync/dev.ps1).
// Fails on serious and critical violations; prints the rest so they don't get lost.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const axe = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
const ROUTES = [
  ["home", { name: "home" }],
  ["albums", { name: "albums" }],
  ["album", { name: "album", id: 1 }],
  ["artists", { name: "artists" }],
  ["tracks", { name: "tracks" }],
  ["search", { name: "search" }],
  ["playlists", { name: "playlists" }],
  ["settings", { name: "settings" }],
];

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(800);
await page.evaluate(() => { window.__feedback.ui.getState().setDialog(null); window.__feedback.ui.getState().setNowPlaying(false); });

const bad = [];
for (const [name, route] of ROUTES) {
  await page.evaluate((r) => window.__feedback.nav.getState().go(r), route);
  await page.waitForTimeout(800);
  await page.evaluate(axe);
  const result = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"], runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }));
  for (const v of result.violations) {
    const line = `${name}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}× e.g. ${v.nodes[0].target.join(" ")})`;
    console.log(line);
    if (v.impact === "serious" || v.impact === "critical") bad.push(line);
  }
}
console.log(bad.length ? `FAIL: ${bad.length} serious/critical` : "PASS: no serious or critical violations on the main screens");
await browser.close();
assert.deepEqual(bad, []);
