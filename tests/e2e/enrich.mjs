// Bad-match protection, end to end: picking the wrong album's artwork must not stamp its
// identifiers onto your files. Runs against the dev app over CDP (.sync/dev.ps1) and restores
// the fixture tags afterwards, even if an assertion fails.
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

await ipc("set_setting", { key: "settings.onlineLookups", value: true });
const albums = await page.evaluate(() => window.__feedback.library.albums());
const target = albums.find((a) => a.title === "Nightbus Hymns") ?? albums[0];
const detail = await page.evaluate((id) => window.__feedback.library.album(id), target.id);
const ids = detail.tracks.map((t) => t.id);
const original = { album: target.title, artist: target.artist };
const retag = (album, artist) => ipc("edit_tracks", { ids, edit: { album, albumArtist: artist, artist } });

try {
  // Pretend these files are Kid A. The titles and lengths are still the fixtures', so every track
  // is a mismatch — and FEEDBACK should notice.
  await retag("Kid A", "Radiohead");
  await page.waitForTimeout(3500);
  const renamed = (await page.evaluate(() => window.__feedback.library.albums())).find((a) => a.title === "Kid A");
  assert.ok(renamed, "the retagged album should be in the library");

  const candidates = await ipc("lookup_album", { albumId: renamed.id });
  if (!candidates.length) {
    console.log("NOTE: the catalogue offered no candidates this run; skipping the link assertion.");
  } else {
    await ipc("apply_lookup_art", { albumId: renamed.id, mbid: candidates[0].ids.releaseMbid });
    await page.waitForTimeout(6000);
    const links = [];
    for (const id of (await page.evaluate((a) => window.__feedback.library.album(a), renamed.id)).tracks.map((t) => t.id)) {
      links.push(await ipc("catalogue_ids", { trackId: id }));
    }
    const linked = links.filter(Boolean);
    assert.equal(linked.length, 0, `nothing on this album is really Kid A, so nothing should have been linked (got ${linked.length})`);
    console.log(`PASS: artwork applied, ${links.length} tracks left unlinked because none of them matched.`);
  }
} finally {
  await retag(original.album, original.artist);
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__feedback.lib.getState().invalidate());
  await browser.close();
}
