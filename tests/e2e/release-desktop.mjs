// The installed Windows app, with nothing else running.
//
// The failure this guards against is quiet and total: a build that kept the dev server's address
// launches to "localhost refused to connect" while the Rust side happily opens the database and
// scans the library, so everything looks healthy from the logs. So this test refuses to run while
// anything is listening on the Vite port, launches the *installed* app, and asks the webview
// itself which URL it is showing.
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

const INSTALLED = path.join(process.env.LOCALAPPDATA ?? "", "feedback", "feedback.exe");
const PORT = 9223;

function listening(port) {
  try {
    return execSync(`netstat -ano -p tcp`, { encoding: "utf8" }).split("\n").some((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
  } catch {
    return false;
  }
}

assert.ok(existsSync(INSTALLED), `install the app first: ${INSTALLED} is missing`);
assert.ok(!listening(1420), "stop the dev server first — this test is about the app standing on its own");

try {
  execSync("taskkill /IM feedback.exe /F", { stdio: "ignore" });
} catch {
  /* not running */
}

const app = spawn(INSTALLED, { detached: true, stdio: "ignore", env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` } });
app.unref();

let browser = null;
for (let attempt = 0; attempt < 30 && !browser; attempt++) {
  await new Promise((r) => setTimeout(r, 1000));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
}
assert.ok(browser, "the app's webview never came up");

try {
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => document.querySelectorAll("button").length > 5, null, { timeout: 30000 });

  assert.ok(page.url().startsWith("http://tauri.localhost"), `the app must serve its own frontend, not a dev server — it loaded ${page.url()}`);
  const shell = await page.evaluate(() => document.body.innerText);
  for (const word of ["Home", "Albums", "Settings"]) assert.match(shell, new RegExp(word, "i"), `the interface should show ${word}`);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.waitForTimeout(1200);
  const controls = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim().toLowerCase()));
  for (const control of ["sync now", "upload my music", "add folder", "import files"]) {
    assert.ok(controls.includes(control), `Settings should offer "${control}"`);
  }
  console.log(`PASS: installed app served ${page.url()} with no dev server, and Settings offers its account and import controls`);
} finally {
  await browser.close().catch(() => {});
  try {
    execSync("taskkill /IM feedback.exe /F", { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}
