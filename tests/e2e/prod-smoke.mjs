import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts().flatMap((c) => c.pages())[0];
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`[console.${m.type()}]`, m.text()));
console.log("url", p.url());
await p.waitForTimeout(4000);
await p.screenshot({ path: "C:/Users/nator/FEEDBACK/.sync/qa-prod/01-launch.png" });
// play first album via UI: click first album card play button on home
const btn = p.locator('button[aria-label^="Play "]').first();
if (await btn.count()) { await btn.click({ force: true }); }
await p.waitForTimeout(3500);
const state = await p.evaluate(() => { const a = [...document.querySelectorAll('[role=slider]')][0]; return a?.getAttribute('aria-valuetext'); });
console.log("timeline", state);
await p.screenshot({ path: "C:/Users/nator/FEEDBACK/.sync/qa-prod/02-playing.png" });
await b.close();
