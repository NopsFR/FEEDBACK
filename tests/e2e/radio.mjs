// A run built from the library: seeded, varied, and labelled in Now Playing.
// Runs against the dev app over CDP (.sync/dev.ps1).
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((p) => p.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(700);

const result = await page.evaluate(async () => {
  const lib = window.__feedback.library;
  const tracks = await lib.tracks();
  const seed = tracks[0];
  const run = await lib.radio(seed.id, 30);
  const perAlbum = {};
  for (const t of run) perAlbum[t.album] = (perAlbum[t.album] ?? 0) + 1;
  window.__feedback.player.getState().playTracks([seed, ...run], 0, { source: `radio:${seed.id}`, shuffle: false });
  window.__feedback.player.getState().pause?.();
  return { seed: seed.id, ids: run.map((t) => t.id), albums: perAlbum, artists: [...new Set(run.map((t) => t.artist))].length };
});

assert.ok(result.ids.length >= 20, `expected a full run, got ${result.ids.length}`);
assert.ok(!result.ids.includes(result.seed), "the seed must not repeat inside its own run");
assert.equal(new Set(result.ids).size, result.ids.length, "a run must not repeat tracks");
assert.ok(result.artists >= 3, `a run should wander across artists, saw ${result.artists}`);
const source = await page.evaluate(() => window.__feedback.player.getState().queue.source);
assert.match(source, /^radio:/);
await page.evaluate(() => { window.__feedback.player.getState().pause?.(); window.__feedback.player.getState().clearQueue?.(); });
console.log(`PASS: run of ${result.ids.length} across ${result.artists} artists, albums:`, JSON.stringify(result.albums));
if (errors.length) throw new Error(errors.join(" | "));
await browser.close();
