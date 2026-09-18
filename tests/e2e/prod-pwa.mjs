// The real journey, against the public deployment: a phone that has never met this computer.
//
// Everything on the home network is cut off — localhost, the LAN, the desktop's API — so anything
// that still works here works from a train. Production strips the dev handle, so this test drives
// the app the way a thumb does and judges it by what crosses the network.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const SITE = process.env.FEEDBACK_URL ?? "https://feedback-eight-rosy-69.vercel.app";
const EMAIL = process.env.FEEDBACK_QA_EMAIL ?? "qa-harness@feedback.test";
const PASSWORD = process.env.FEEDBACK_QA_PASSWORD ?? "feedback-qa-2026";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // No home network at all.
  for (const pattern of ["**://localhost/**", "**://localhost:*/**", "**://127.0.0.1*/**", "**://192.168.*/**"]) {
    await page.route(pattern, (route) => route.abort());
  }

  const signings = [];
  const media = [];
  page.on("response", (r) => {
    const url = r.url();
    if (url.includes("/storage/v1/object/sign/")) signings.push(url);
    if (url.includes("/storage/v1/object/sign/") && r.request().method() === "GET") media.push({ url, status: r.status() });
  });

  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  assert.ok(page.url().startsWith("https://"), "the phone talks to the app over HTTPS");

  await page.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 30000 });
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The account's library arrives from the cloud, with nothing on this network to help.
  await page.getByRole("navigation", { name: "Sections" }).waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Tracks", exact: true }).click();
  await page.getByRole("button", { name: "Shuffle" }).click();

  // Playing means a signed link was minted and the audio itself came back over https.
  await page.waitForFunction(() => document.querySelector('[aria-label="Pause"]') !== null, null, { timeout: 45000 });
  await page.waitForTimeout(4000);
  assert.ok(signings.length > 0, "pressing play should sign a storage link");

  // Seeking is the part that needs range support, so ask for a range the way the player does.
  const signed = signings.find((u) => u.includes("token="));
  assert.ok(signed, "a signed url should carry its token");
  const ranged = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Range: "bytes=0-2047" } });
    return { status: r.status, bytes: (await r.arrayBuffer()).byteLength, type: r.headers.get("content-type") };
  }, signed);
  assert.equal(ranged.status, 206, "seeking needs range support");
  assert.equal(ranged.bytes, 2048);

  // An installed app needs its manifest and its worker, from this same origin.
  const installable = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')?.getAttribute("href");
    const manifest = await fetch(link).then((r) => r.json());
    const sw = await navigator.serviceWorker.getRegistration();
    return { display: manifest.display, name: manifest.short_name, icons: manifest.icons.length, worker: !!sw };
  });
  assert.equal(installable.display, "standalone");
  assert.equal(installable.name, "FEEDBACK");
  assert.ok(installable.icons >= 2);
  assert.ok(installable.worker, "the service worker should register on the public site");

  // Search must reach past the library: the catalogue section is what makes a band you don't own
  // findable at all, and every row has to say plainly what FEEDBACK can do with it.
  const found = {};
  for (const artist of ["Title Fight", "Tigers Jaw", "La Dispute", "Avenged Sevenfold"]) {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const box = page.getByLabel("Search", { exact: true });
    await box.fill("");
    await box.fill(artist);
    const section = page.getByText("Elsewhere in the catalogue", { exact: false }).first();
    await section.waitFor({ timeout: 30000 });
    const reveal = page.getByRole("button", { name: /Show \d+ catalogue entr/ });
    await reveal.waitFor({ timeout: 30000 });
    // Nothing unplayable should be on screen until it is asked for.
    assert.equal(await page.evaluate(() => (document.body.innerText.match(/not in your library/gi) ?? []).length), 0, `${artist}: metadata-only rows must stay out of normal results`);
    const hidden = Number((await reveal.innerText()).match(/\d+/)?.[0] ?? 0);
    const playable = Number((await page.getByText(/playable result/i).first().innerText().catch(() => "0 playable")).match(/\d+/)?.[0] ?? 0);
    await reveal.click();
    await page.waitForTimeout(500);
    assert.ok(hidden > 0, `${artist} should still be findable behind the catalogue link`);
    found[artist] = { playable, hidden };
  }

  // A provider that actually streams: the row must offer Play, and pressing it must fetch audio.
  const audio = [];
  page.on("response", (r) => {
    if (/audius/.test(r.url()) && /stream/.test(r.url())) audio.push(r.status());
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const box2 = page.getByLabel("Search", { exact: true });
  await box2.fill("");
  await box2.fill("lofi");
  const play = page.getByRole("button", { name: /Play · audius/i }).first();
  await play.waitFor({ timeout: 30000 });
  await play.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Pause"]') !== null, null, { timeout: 30000 });
  await page.waitForTimeout(5000);
  assert.ok(audio.length > 0, "pressing Play on a provider row should fetch its stream");
  assert.ok(audio.every((s) => s < 400), `the provider stream should answer, got ${audio.join(",")}`);

  assert.deepEqual(errors, []);
  console.log(`PASS: ${SITE} — signed in, library loaded, played a cloud track (${signings.length} signed links, range 206), installable as ${installable.name}; catalogue rows ${JSON.stringify(found)}; audius stream answered ${audio.join(",")}`);
} finally {
  await browser.close();
}
