const CACHE_NAME = "yuyu-checkin-static-v5";
const MAX_STATIC_ENTRIES = 128;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Never cache navigations, API responses, ticket pages, or attendee data.
  // IndexedDB holds the explicitly downloaded offline roster; browser caches
  // must contain only versioned static assets.
  if (request.url.includes("/_next/static/") && ["script", "style", "font"].includes(request.destination)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && response.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
            const keys = await cache.keys();
            await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((key) => cache.delete(key)));
          }
          return response;
        } catch {
          return (await caches.match(request)) || Response.error();
        }
      })(),
    );
  }
});
