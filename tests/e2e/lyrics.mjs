// Lyrics: the user's own files win, LRCLIB fills the gaps, and "instrumental" is its own answer.
// Runs against the dev app over CDP (.sync/dev.ps1) and talks to the real LRCLIB.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:1420|tauri\.localhost/.test(p.url()));
await page.reload();
await page.waitForFunction(() => !!window.__feedback);
await page.waitForTimeout(700);
const ipc = (cmd, args = {}) => page.evaluate(async ({ cmd, args }) => {
  const { call } = await import("/src/services/ipc.ts");
  return call(cmd, args);
}, { cmd, args });

// The fixture library ships one .lrc; that must be preferred over anything online.
const tracks = await page.evaluate(() => window.__feedback.library.tracks());
const withLrc = tracks.find((t) => t.hasLyrics);
assert.ok(withLrc, "the fixture library should have a track with lyrics on disk");
await ipc("set_setting", { key: "settings.onlineLookups", value: true });
const local = await ipc("get_lyrics", { id: withLrc.id });
assert.equal(local.source, "lrc", "a local .lrc must win over a provider");

// A track with no lyrics on disk: ask LRCLIB. The fixture bands are invented, so the honest
// answer is "nothing found" — which must not be mistaken for an error or for an instrumental.
const without = tracks.find((t) => !t.hasLyrics);
const remote = await ipc("get_lyrics", { id: without.id });
assert.ok(remote === null || remote.source === "lrclib", `unexpected lyrics source: ${remote?.source}`);

// With lookups off, nothing is asked at all.
await ipc("set_setting", { key: "settings.onlineLookups", value: false });
const off = await ipc("get_lyrics", { id: without.id });
assert.equal(off, null, "no provider may be asked while lookups are off");
await ipc("set_setting", { key: "settings.onlineLookups", value: true });

const health = await ipc("catalogue_health");
const lane = health.providers.find((p) => p.provider === "lrclib");
assert.ok(lane, "lrclib should appear in provider health");
assert.ok(["healthy", "degraded", "offline", "rateLimited"].includes(lane.state));
console.log(`PASS: local lyrics win; lrclib lane ${lane.state}, ${lane.requests} requests, ${lane.errors} errors`);
await browser.close();
