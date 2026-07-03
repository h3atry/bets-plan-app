const CACHE = "bets-plan-v20";

/** Assets dinamicos: sempre rede (evita PIN/JS/JSON velho no cache). */
function isNetworkOnly(pathname) {
  if (pathname.endsWith(".json")) return true;
  if (pathname.includes(".js")) return true;
  if (pathname.endsWith(".css")) return true;
  if (pathname.endsWith("index.html") || pathname.endsWith("/")) return true;
  return false;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  if (isNetworkOnly(url.pathname)) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.open(CACHE).then((c) => c.match(e.request)))
  );
});
