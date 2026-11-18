/*
 * sw.js — the service worker that lets the app install and work offline.
 *
 * Network first: when you're online, every request goes to the website,
 * so each merged change shows up, and the fresh copy is saved in the
 * cache. When you're offline, the saved copy is used instead.
 *
 * Every path is relative to this file, so it works at
 * https://<username>.github.io/<repository>/.
 */
const CACHE = 'age-capstruct-v1';

const FILES = [
  './',
  './index.html',
  './styles.css',
  './capstruct.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './data/cdss.csv',
  './data/assumptions.csv',
  './data/banker_schedule.csv',
  './data/example_firms.csv',
  './data/ebit_scenarios.csv'
];

// Save a fresh copy of every file when the service worker installs.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Remove caches left by older versions of this file.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only this site's own files. The app makes no other requests.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    // cache: 'no-cache' asks the website whether the file changed instead
    // of trusting the browser's own copy.
    fetch(new Request(req, { cache: 'no-cache' }))
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./');
          return Response.error();
        })
      )
  );
});
