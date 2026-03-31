const STATIC_CACHE = "attendance-static-v3";
const RUNTIME_CACHE = "attendance-runtime-v3";

const APP_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      for (const asset of APP_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn("Failed to cache:", asset, err);
        }
      }
    }),
  );

  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
        }),
      ),
    ),
  );

  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // only handle GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip chrome-extension and unsupported schemes
  if (!url.protocol.startsWith("http")) return;

  // 1. HTML pages → network first, fallback to cache
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(async () => {
          return (
            (await caches.match(req)) || (await caches.match("./index.html"))
          );
        }),
    );
    return;
  }

  // 2. CSS / JS / local assets → cache first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(async (cached) => {
        if (cached) return cached;

        try {
          const res = await fetch(req);
          const copy = res.clone();
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, copy);
          return res;
        } catch {
          return cached;
        }
      }),
    );
    return;
  }

  // 3. External files (like Google Fonts) → network first, cache fallback
  event.respondWith(
    fetch(req)
      .then(async (res) => {
        const copy = res.clone();
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, copy);
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
