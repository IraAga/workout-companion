/* Off-Season Plan — service worker.
 *
 * The whole app is one HTML file, so the cache is tiny. Strategy:
 *   - navigations: network first with a short timeout, cached page as fallback
 *     (a gym basement with one bar of signal still opens instantly)
 *   - same-origin assets: stale-while-revalidate
 *   - Google Fonts: stale-while-revalidate in a runtime cache
 *
 * Bump CACHE when the app changes so old shells are dropped on activate.
 */

var VERSION = 'v9';
var SHELL = 'shell-' + VERSION;
var RUNTIME = 'runtime-' + VERSION;
var BASE = new URL('./', self.location).href;
var NAV_TIMEOUT = 4000;

var PRECACHE = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return (key === SHELL || key === RUNTIME) ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) { settled = true; resolve(null); }
    }, NAV_TIMEOUT);

    fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(SHELL).then(function (cache) {
          return cache.put(BASE, copy);
        }).catch(function () {});
      }
      if (!settled) { settled = true; clearTimeout(timer); resolve(response); }
    }).catch(function () {
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    });
  }).then(function (response) {
    if (response) { return response; }
    return caches.match(request).then(function (cached) {
      return cached || caches.match(BASE);
    });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone()).catch(function () {});
        }
        return response;
      }).catch(function () { return null; });

      if (cached) { return cached; }
      return network.then(function (response) {
        if (response) { return response; }
        // Last resort for a navigation-ish request we cannot satisfy.
        return caches.match(BASE);
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') { return; }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  var url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL));
    return;
  }
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
  }
});
