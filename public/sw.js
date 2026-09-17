/* FEEDBACK service worker — offline app shell only. Media and API calls are never cached here;
   saved albums live in OPFS (see src/services/offline.ts). */
const SHELL = "feedback-shell-v2";
const CORE = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];
const MANIFEST = "/__shell-manifest";

const assetsIn = (html) => [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map((m) => m[1]))];

/** Keep the offline shell on the current build: cache this document, add its scripts, drop the ones it replaced. */
async function adopt(response) {
  const cache = await caches.open(SHELL);
  const html = await response.clone().text();
  const assets = assetsIn(html);
  if (!assets.length) return;
  const missing = [];
  for (const asset of assets) if (!(await cache.match(asset))) missing.push(asset);
  if (missing.length) await cache.addAll(missing);
  const previous = await cache.match(MANIFEST).then((r) => (r ? r.json() : []));
  await cache.put("/index.html", response.clone());
  await cache.put("/", response.clone());
  await cache.put(MANIFEST, new Response(JSON.stringify(assets), { headers: { "Content-Type": "application/json" } }));
  // Only entries the previous build referenced are removed, so lazily-loaded chunks survive.
  for (const stale of previous.filter((a) => !assets.includes(a))) await cache.delete(stale);
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(CORE);
    await adopt(await cache.match("/index.html"));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("feedback-shell-") && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/") || url.pathname.startsWith("/__offline/")) return;
  // Navigations: network first, fall back to the cached shell. A fresh document refreshes the offline copy.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) e.waitUntil(adopt(res).catch(() => {}));
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }
  // Hashed build assets: cache first.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
