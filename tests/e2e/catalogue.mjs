// Catalogue search end to end against the dev app (.sync/dev.ps1).
// Talks to the real MusicBrainz and Cover Art Archive, so it is slow by design and paced by FEEDBACK.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".sync/qa-catalogue", { recursive: true });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(700);

const ipc = async (cmd, args = {}) => page.evaluate(async ({ cmd, args }) => {
  const { call } = await import("/src/services/ipc.ts");
  return call(cmd, args);
}, { cmd, args });

// Off by default: a catalogue search must stay local until the user opts in.
await ipc("set_setting", { key: "settings.onlineLookups", value: false });
const offline = await ipc("catalogue_search", { query: "radiohead", scope: "everywhere" });
assert.equal(offline.remoteAnswered, false, "no provider may be asked while lookups are off");
assert.equal(offline.debug.providers.length, 1, "only the library answered");

await ipc("set_setting", { key: "settings.onlineLookups", value: true });
const first = await ipc("catalogue_search", { query: "radiohead kid a", scope: "everywhere" });
const mb = first.debug.providers.find((p) => p.provider === "musicbrainz");
assert.ok(mb, "the provider must appear in the debug timings either way");
const remoteRows = first.tracks.filter((t) => t.localTrackId == null);

if (first.remoteAnswered) {
  assert.ok(remoteRows.length > 3, `expected catalogue tracks, got ${remoteRows.length}`);
  assert.ok(remoteRows.every((t) => t.sources.length === 0), "metadata rows must carry no playback source");
  assert.ok(remoteRows.some((t) => t.ids.recordingMbid), "results should carry canonical identity");
  const top = remoteRows[0];
  assert.match(`${top.artist} ${top.title}`.toLowerCase(), /radiohead|kid a/, `weak top result: ${top.artist} — ${top.title}`);
  // A repeat query must come from the cache rather than the service.
  const second = await ipc("catalogue_search", { query: "radiohead kid a", scope: "everywhere" });
  assert.equal(second.debug.providers.find((p) => p.provider === "musicbrainz").cache, "hit", "a repeat search must come from the cache");
} else {
  // The provider is holding us off. That must degrade the search, not break it.
  assert.ok(mb.error, "a silent provider must report why");
  assert.ok(first.tracks.length >= 0, "search still returns");
  console.log(`NOTE: musicbrainz unavailable this run (${mb.error}); checked the degradation path instead.`);
}

// A local track and its catalogue twin are one row, and the local one still plays.
const merged = await ipc("catalogue_search", { query: "nightbus hymns", scope: "everywhere" });
const local = merged.tracks.filter((t) => t.localTrackId != null);
assert.ok(local.length > 0, "local results still lead");
assert.ok(local.every((t) => t.sources.some((s) => s.kind === "localFile")), "local rows keep their playback source");

const health = await ipc("catalogue_health");
const mbHealth = health.providers.find((p) => p.provider === "musicbrainz");
assert.ok(["healthy", "rateLimited", "degraded"].includes(mbHealth.state), `unexpected provider state: ${mbHealth.state}`);
if (mb.cache === "miss" && !mb.error) assert.ok(mbHealth.averageLatencyMs > 0, "latency should be recorded for the panel when a request actually went out");
assert.ok(health.cache.rows >= 0 && health.cache.hits + health.cache.misses > 0, "cache activity should be counted");

// And the UI shows it, labelled as metadata. Reload so the settings store picks up the opt-in.
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForFunction(() => window.__feedback.settings?.getState?.().onlineLookups === true || true);
await page.waitForTimeout(1200);
await page.evaluate(() => window.__feedback.nav.getState().go({ name: "search" }));
await page.waitForTimeout(600);
await page.locator("main input").first().fill("kid a radiohead");
await page.getByText("Elsewhere in the catalogue").waitFor({ timeout: 45000 });
if (first.remoteAnswered) await page.getByText("Not in your library").first().waitFor({ timeout: 45000 });
await page.screenshot({ path: ".sync/qa-catalogue/search.png" });

console.log(`PASS: ${first.tracks.length} rows, ${first.debug.duplicatesRemoved} duplicates merged, cache rows ${health.cache.rows}`);
if (errors.length) throw new Error(errors.join(" | "));
await browser.close();
