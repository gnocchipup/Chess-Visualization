/*
 * Service worker for the Chess Visualization for Noobs PWA.
 *
 * WHY THIS EXISTS: Chrome, Edge and Android only offer "Install app" once the
 * page has a service worker with a fetch handler, a manifest, and HTTPS. So a
 * worker is a hard requirement for installability, independent of caching.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — it never caches puzzle data.
 * The app is designed around no offline mode (see memory-bank/activeContext.md):
 * /api/puzzle/next is the source of truth for puzzle alignment, and a cached
 * fallback would mask exactly the class of alignment bug this project was built
 * to eliminate. So every cross-origin request — all lichess.org traffic — is
 * passed straight through to the network and never written to a cache. If the
 * API is unreachable the app still shows its retryable error, unchanged.
 *
 * What is cached is the immutable app shell (the built JS/CSS/WASM and the
 * icons), so an installed app opens without a network round trip and the shell
 * survives a flaky connection. The shell contains no puzzle data.
 */

const VERSION = 'v1';
const SHELL_CACHE = `cpt-shell-${VERSION}`;

// The document and manifest are the only files whose names are known ahead of
// time: Vite fingerprints everything under assets/ at build time. Those are
// cached on first use instead — see the fetch handler's same-origin branch.
const PRECACHE = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is atomic — one 404 would discard the whole precache, which is
      // the behaviour we want rather than a half-populated install.
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cacheable, and anything that is not same-origin (i.e. all of
  // lichess.org) must reach the network untouched — see the header comment.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a deployed update is picked up immediately,
  // with the cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Hashed build assets: cache first. Their filename changes whenever their
  // content does, so a cache hit is always correct and never stale.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Opaque/error responses must not be stored, or a failed fetch would
        // be replayed as if it were the asset.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

// Lets the page trigger an immediate update check after a new deploy.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});