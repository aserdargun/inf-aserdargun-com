/* INF public-view cache: intentionally no owner/auth fallback or caching. */
const VERSION = "__INF_PUBLIC_CACHE_VERSION__";
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;
const IMAGE_CACHE = `${VERSION}-images`;
const CURRENT_CACHES = new Set([STATIC_CACHE, DATA_CACHE, IMAGE_CACHE]);
const MAX_ENTRIES = 40;
const STATIC_ASSETS = ["/view/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];
let cacheWrites = Promise.resolve();

function isSafeResponse(response) {
  return response.ok && !response.redirected && (response.type === "basic" || response.type === "default");
}

function writeBounded(cacheName, request, response) {
  if (!isSafeResponse(response)) return Promise.resolve();
  const work = async () => {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((key) => cache.delete(key)));
  };
  const next = cacheWrites.then(work, work);
  cacheWrites = next.catch(() => undefined);
  return next;
}

function publicCatalog(pathname) {
  return pathname === "/api/public/infographics" || /^\/api\/public\/infographics\/[0-9a-f-]+$/i.test(pathname);
}

function publicImage(pathname) {
  return pathname.startsWith("/api/public/images/");
}

function viewNavigation(request, pathname) {
  return pathname === "/view" || pathname === "/view/" || (request.mode === "navigate" && pathname.startsWith("/view/"));
}

function staticAsset(pathname) {
  return pathname === "/manifest.webmanifest" || pathname.startsWith("/icons/") || pathname.startsWith("/_next/static/");
}

function oldInfPublicCache(name) {
  return (name.startsWith("INF-PUBLIC-") || name.startsWith("PUBLIC-CACHE-")) && !CURRENT_CACHES.has(name);
}

self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(STATIC_ASSETS.map(async (asset) => {
    const response = await fetch(asset);
    if (isSafeResponse(response)) await cache.put(asset, response);
  }));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(oldInfPublicCache).map((name) => caches.delete(name)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (viewNavigation(request, url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      try {
        const response = await fetch(request);
        await writeBounded(STATIC_CACHE, request, response);
        return response;
      } catch {
        const cached = await cache.match(request) ?? await cache.match("/view/");
        if (cached) return cached;
        throw new Error("Offline");
      }
    })());
    return;
  }
  if (publicCatalog(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const response = await fetch(request);
        await writeBounded(DATA_CACHE, request, response);
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw new Error("Offline");
      }
    })());
    return;
  }
  if (publicImage(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then(async (response) => {
        await writeBounded(IMAGE_CACHE, request, response);
        return response;
      }).catch(() => undefined);
      if (cached) { void network; return cached; }
      const response = await network;
      if (response) return response;
      throw new Error("Offline");
    })());
    return;
  }
  if (staticAsset(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      await writeBounded(STATIC_CACHE, request, response);
      return response;
    })());
  }
});
