// Phone widths and landscape against the dev server (pnpm tauri dev), with the desktop API mocked.
// Usage: node tests/e2e/phone-widths.mjs — screenshots land in .sync/qa-widths.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
mkdirSync(".sync/qa-widths", { recursive: true });
const tracks = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: ["Last Stop Before Morning","Coin Slot Heart","We Were the Fire Drill","Neon Tetra","Cassette Weather","Heatsink","Forge Lung","Iron Psalm","Coldwater","The Long Hum","Ashfall","Undertow"][i], artist: "Hollow Arcade", album: "Nightbus Hymns", albumArtist: "Hollow Arcade", durationMs: 214000 + i * 1000, favourite: i % 3 === 0, missing: false, kind: "audio", hasLyrics: false, playCount: i, addedAt: 0, fileSize: 1, trackNo: i + 1 }));
const detail = { playlist: { id: 10, name: "Late shift", description: null, rules: null, arts: [], trackCount: tracks.length, durationMs: tracks.reduce((n, t) => n + t.durationMs, 0), updatedAt: 1 }, entries: tracks.map((t, i) => ({ entryId: 100 + i, track: t })) };
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const errors = [];
  for (const [name, size] of [["w320", { width: 320, height: 640 }], ["w360", { width: 360, height: 780 }], ["w390", { width: 390, height: 844 }], ["w430", { width: 430, height: 932 }], ["land", { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await page.addInitScript(() => { localStorage.setItem("feedback.token", "width-qa"); localStorage.setItem("feedback.settings.v1", JSON.stringify({ intro: "off" })); });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/playlists") return route.fulfill({ json: [detail.playlist] });
      if (path === "/api/playlist/10") return route.fulfill({ json: detail });
      if (path === "/api/tracks") return route.fulfill({ json: tracks });
      if (path === "/api/overview") return route.fulfill({ json: { tracks: 12, albums: 1, artists: 1, videos: 0, folders: 1, durationMs: 1 } });
      if (path === "/api/home") return route.fulfill({ json: { recentlyAdded: [], recentlyPlayed: [], mostPlayed: tracks.slice(0, 4), forgotten: [], randomAlbums: [], genres: [], videos: [] } });
      return route.fulfill({ json: [] });
    });
    await page.goto("http://localhost:1420");
    await page.waitForFunction(() => !!window.__feedback);
    await page.evaluate(() => window.__feedback.nav.getState().go({ name: "playlist", id: 10 }));
    await page.getByText("Late shift", { exact: true }).first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.sync/qa-widths/${name}-playlist.png` });
    await page.evaluate(() => { const t = { id: 1, title: "Last Stop Before Morning", artist: "Hollow Arcade", album: "Nightbus Hymns", durationMs: 214000, favourite: true, kind: "audio" }; window.__feedback.player.setState({ current: t, playing: false }); window.__feedback.ui.getState().setNowPlaying(true); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `.sync/qa-widths/${name}-player.png` });
    await page.evaluate(() => window.__feedback.ui.getState().setNowPlaying(false));
    await page.evaluate(() => window.__feedback.nav.getState().go({ name: "offline" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.sync/qa-widths/${name}-offline.png` });
    await context.close();
  }
  console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
} finally { await browser.close(); }
