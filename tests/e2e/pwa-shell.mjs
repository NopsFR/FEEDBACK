// Run after pnpm build:pwa with a preview server at localhost:4173.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem("feedback.token", "shell-test"); localStorage.setItem("feedback.settings.v1", JSON.stringify({ intro: "off" })); });
  await page.goto("http://localhost:4173");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => (await (await caches.open("feedback-shell-v2")).keys()).map((r) => r.url));
  assert(cached.some((url) => /\/assets\/.*\.js$/.test(url)), "Entry script must be pre-cached on first install");
  const manifest = await page.evaluate(async () => (await (await (await caches.open("feedback-shell-v2")).match("/__shell-manifest")).json()));
  assert(manifest.some((path) => /^\/assets\/.*\.js$/.test(path)), "Shell manifest must list this build's scripts so later builds can retire them");
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Library", exact: true }).waitFor();
  console.log("PASS: production PWA entry script precached; app reopens offline.");
} finally { await browser.close(); }
