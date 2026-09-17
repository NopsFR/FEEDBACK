// Drives the running desktop app over WebView2's DevTools protocol (dev only) and saves screenshots.
// Launch the app with:  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// Usage: node tests/e2e/drive.mjs steps.json outDir
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , stepsFile, outDir = "qa-shots"] = process.argv;
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => /localhost:1420|tauri\.localhost/.test(p.url())) ?? pages[0];
if (!page) throw new Error("no app page found");
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`[console.${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

for (const s of steps) {
  if (s.go) await page.evaluate((r) => window.__feedback.nav.getState().go(r), s.go);
  if (s.eval) console.log("eval:", JSON.stringify(await page.evaluate(s.eval)));
  if (s.click) await page.click(s.click, { timeout: 5000 }).catch((e) => console.log("click failed", s.click, e.message));
  if (s.key) await page.keyboard.press(s.key);
  if (s.type) await page.keyboard.type(s.type, { delay: 20 });
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.size) {
    // Emulated viewport (doesn't move the real window). [0,0] clears the override.
    const cdp = await page.context().newCDPSession(page);
    if (s.size[0] === 0) await cdp.send("Emulation.clearDeviceMetricsOverride");
    else await cdp.send("Emulation.setDeviceMetricsOverride", { width: s.size[0], height: s.size[1], deviceScaleFactor: s.size[2] ?? 1, mobile: !!s.size[3] });
    await page.waitForTimeout(400);
  }
  if (s.shot) {
    await page.screenshot({ path: join(outDir, `${s.shot}.png`) });
    console.log("shot", s.shot);
  }
}
await browser.close();
