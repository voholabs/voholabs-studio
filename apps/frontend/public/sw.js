// Studio's service worker. It does one thing: when a page can't load because
// the device is offline, it shows /offline.html instead of the browser's error.
// It caches nothing else, so every page and API call always comes from the
// server.
const CACHE = 'studio-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.registration.navigationPreload?.enable())
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    Promise.resolve(event.preloadResponse)
      .then((preloaded) => preloaded || fetch(event.request))
      .catch(() => caches.match(OFFLINE_URL))
  );
});
