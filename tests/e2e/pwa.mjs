// PWA smoke test against the desktop LAN server using headless Edge on Windows (iPhone-sized viewport).
// Usage: node tests/e2e/pwa.mjs <pairing-code> [outDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , code, outDir = "qa-pwa"] = process.argv;
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const page = await ctx.newPage();
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`[console.${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const shot = async (n) => (await page.screenshot({ path: join(outDir, `${n}.png`) }), console.log("shot", n));

await page.goto("https://127.0.0.1:47821/");
await page.waitForTimeout(1200);
await shot("p1-pair");
await page.fill('input[aria-label="Pairing code"]', code);
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
await shot("p2-home");
const secure = await page.evaluate(() => ({ secure: window.isSecureContext, opfs: !!navigator.storage?.getDirectory, sw: "serviceWorker" in navigator }));
console.log("caps", JSON.stringify(secure));
// open library → albums → first album
await page.click('nav[aria-label="Sections"] button:nth-child(3)');
await page.waitForTimeout(800);
await shot("p3-library");
await page.getByText("Albums", { exact: true }).first().click();
await page.waitForTimeout(1500);
await page.locator('button[aria-label*=" by "]').first().click();
await page.waitForTimeout(1500);
await shot("p4-album");
// save offline via the album "More" menu
await page.click('button[aria-label="More"]');
await page.waitForTimeout(500);
await shot("p5-sheet");
const save = page.getByText("Save to this phone");
if (await save.count()) {
  await save.click();
  await page.waitForTimeout(6000);
}
await shot("p6-saved");
// play
await page.getByRole("button", { name: /^Play$/ }).first().click();
await page.waitForTimeout(2500);
await shot("p7-mini");
await page.goto("https://127.0.0.1:47821/");
await page.waitForTimeout(2500);
// go offline page
await page.click('nav[aria-label="Sections"] button:nth-child(3)');
await page.waitForTimeout(600);
await page.getByText("On this phone").first().click();
await page.waitForTimeout(1500);
await shot("p8-offline");
await browser.close();
