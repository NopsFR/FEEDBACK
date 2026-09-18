// Publish the built PWA to its public HTTPS home.
//
// The phone loads the app from here, not from this computer: nothing in the deployed bundle may
// point at the LAN. The check below is the gate, not a formality — a build that leaks a localhost
// or 192.168 address would strand the phone the moment it leaves the house, and a build carrying a
// privileged key would hand the account to anyone who views source.
import { cp, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".sync", "deploy-pwa");
const built = path.join(root, "dist-pwa");

const BANNED = [/\bhttp:\/\/localhost/, /\b127\.0\.0\.1\b/, /\b192\.168\.\d+\.\d+\b/, /service_role/, /\bsb_secret_/, /SUPABASE_SERVICE/];

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else out.push(full);
  }
  return out;
}

const text = (await files(built)).filter((f) => /\.(js|css|html|json|webmanifest|mjs)$/.test(f));
for (const file of text) {
  const body = await readFile(file, "utf8");
  for (const pattern of BANNED) {
    if (pattern.test(body)) throw new Error(`${path.relative(root, file)} contains ${pattern} — that build can't go public.`);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(built, out, { recursive: true });
await cp(path.join(root, "deploy", "vercel.json"), path.join(out, "vercel.json"));

const args = ["vercel", "deploy", "--prod", "--yes", ...process.argv.slice(2)];
const run = spawnSync("npx", args, { cwd: out, stdio: "inherit", shell: true });
process.exit(run.status ?? 1);
