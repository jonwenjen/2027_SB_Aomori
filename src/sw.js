// Service worker: the itinerary has to open where there is no signal --
// Hakkoda's summit, the Oirase gorge, a gondola. build.py stamps VERSION
// with a hash of the built page, so every rebuild retires the old cache.
//
//   the page         network-first, falls back to the last good copy; if a
//                    cached copy exists, a slow network gives up after 4s
//   fonts, icons     cache-first
//   course maps      stale-while-revalidate, capped, so maps opened once
//                    stay viewable on the mountain and self-heal later
//   Open-Meteo       never cached -- a stale forecast shown as current is
//                    worse than the panel's own "offline" message

const VERSION = '__BUILD_HASH__';
const PAGE_CACHE = 'page-' + VERSION;
const STATIC_CACHE = 'static-v1';
const MAP_CACHE = 'maps-v1';
const MAP_LIMIT = 12;
const SLOW_MS = 4000;
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PAGE_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('page-') && k !== PAGE_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'api.open-meteo.com') return;

  if (req.mode === 'navigate') {
    event.respondWith(page(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, PAGE_CACHE));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
  } else if (req.destination === 'image') {
    event.respondWith(maps(req));
  }
});

async function page(req) {
  const cache = await caches.open(PAGE_CACHE);
  const cached = (await cache.match(req, { ignoreSearch: true })) ||
                 (await cache.match('./index.html'));

  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  });
  network.catch(() => {});      // a lost race must not surface as an error

  if (!cached) return network;  // first visit: nothing to fall back on, so wait

  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), SLOW_MS)),
    ]);
  } catch (err) {
    return cached;              // offline or one-bar signal: last good copy now
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

// Map images are no-cors, so their responses are opaque and a failure looks
// like a success. Serving from cache but always refreshing in the background
// means a bad copy is replaced on the next visit instead of sticking forever.
async function maps(req) {
  const cache = await caches.open(MAP_CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req).then(async res => {
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - MAP_LIMIT; i++) await cache.delete(keys[i]);
    }
    return res;
  });
  refresh.catch(() => {});
  return hit || refresh.catch(() => Response.error());
}
