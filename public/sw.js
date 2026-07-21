// ACONSU service worker — enables offline access and installability.
// Cache versioning: bump CACHE_NAME whenever static assets change, so old
// caches get cleaned up automatically instead of serving stale files forever.
const CACHE_NAME = 'aconsu-v1';

const APP_SHELL = [
  '/index.html',
  '/about.html',
  '/departments.html',
  '/events.html',
  '/media.html',
  '/prayer.html',
  '/contact.html',
  '/login.html',
  '/register.html',
  '/404.html',
  '/css/style.css',
  '/js/main.js',
  '/images/logo.jpg',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // Non-fatal — if a shell asset is missing at install time, the SW still activates
      // and pages will just be fetched from network as usual.
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept POST/PUT/DELETE (forms, admin actions)

  const url = new URL(request.url);

  // API calls: network-first, so data is always fresh when online;
  // fall back to cache only if the network fails (offline browsing of last-seen data).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Admin dashboard is never cached — it should always reflect live session/auth state.
  if (url.pathname.startsWith('/admin.html')) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets and pages: cache-first for speed, refreshing the cache in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => cached || caches.match('/404.html'));
      return cached || networkFetch;
    })
  );
});
