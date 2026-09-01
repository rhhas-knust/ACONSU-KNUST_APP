// ACONSU service worker — enables offline access and installability.
// Cache versioning: bump CACHE_NAME whenever static assets change, so old
// caches get cleaned up automatically instead of serving stale files forever.
const CACHE_NAME = 'aconsu-v7';

const APP_SHELL = [
  '/index.html',
  '/about.html',
  '/departments.html',
  '/department.html',
  '/events.html',
  '/media.html',
  '/bible.html',
  '/bible-study.html',
  '/content.html',
  '/groups.html',
  '/group.html',
  '/chat.html',
  '/welfare.html',
  '/give.html',
  '/card.html',
  '/sermon-notes.html',
  '/notifications.html',
  '/discover.html',
  '/more.html',
  '/prayer.html',
  '/contact.html',
  '/login.html',
  '/register.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/profile.html',
  '/page.html',
  '/404.html',
  '/css/style.css',
  '/js/main.js',
  '/images/logo.jpg',
  '/manifest.json',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
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

  // Admin and the leadership portals are never cached — they must always
  // reflect live session/auth state, never a stale signed-in-looking shell.
  const LIVE_ONLY = [
    '/admin.html',
    '/chapter.html',
    '/coordinator.html',
    '/finance.html',
    '/shepherding.html',
    '/publicity.html',
    '/national.html',
    '/executive.html',
    '/welfare-portal.html',
    '/content-manager.html'
  ];
  if (LIVE_ONLY.some((p) => url.pathname.startsWith(p)) || url.pathname.startsWith('/js/portal.js') || url.pathname.startsWith('/css/portal.css')) {
    event.respondWith(fetch(request));
    return;
  }

  // Public pages and frontend assets are network-first so a deployment is
  // visible immediately; the previous cache remains an offline fallback.
  if (request.destination === 'document' || request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/404.html')))
    );
    return;
  }

  // Images and other static files stay cache-first for fast repeat visits.
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

self.addEventListener('push', (event) => {
  let data = { title: 'ACONSU', body: 'You have a new update.', url: '/index.html' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* fall back to default text if payload isn't JSON */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      data: { url: data.url || '/index.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

