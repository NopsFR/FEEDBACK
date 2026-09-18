// A release that needs a server isn't a release.
//
// Run after `tauri build`: the desktop app must carry its own frontend, so the config may not point
// the release at a URL, and the bundled files have to actually exist.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const dist = config.build?.frontendDist;

if (typeof dist !== "string" || /^https?:/i.test(dist)) {
  throw new Error(`build.frontendDist must be a folder the app ships, not ${JSON.stringify(dist)}.`);
}

const index = path.join(root, "src-tauri", dist, "index.html");
const html = await readFile(index, "utf8").catch(() => {
  throw new Error(`${index} is missing — build the frontend before bundling the app.`);
});
if (/localhost:\d+/.test(html)) throw new Error(`${index} still points at a dev server.`);
if (!/\/assets\/[^"']+\.js/.test(html)) throw new Error(`${index} carries no built assets.`);

const exe = path.join(root, "src-tauri", "target", "release", "feedback.exe");
const built = await stat(exe).catch(() => null);
if (!built) throw new Error(`${exe} is missing — the release binary was never built.`);

console.log(`OK: the release app ships ${dist} (built ${built.mtime.toISOString().slice(0, 16).replace("T", " ")}).`);
