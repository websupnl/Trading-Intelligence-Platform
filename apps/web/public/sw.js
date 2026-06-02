// Trading OS — minimal PWA service worker.
// App-like install + offline shell. Never caches API/SSE (live data only).
const CACHE = 'tos-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch live data / auth.
  if (url.pathname.startsWith('/api') || url.pathname.includes('/stream')) return;

  // Cache-first for build assets and icons.
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/icon') ||
      url.pathname === '/manifest.json' || url.pathname.endsWith('.png')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  // Network-first for page navigation; fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/')));
  }
});
