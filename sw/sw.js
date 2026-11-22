/* Service worker: caches ONLY this app's own shell and static assets.
 * Cross-origin requests (remote thumbnails, original posts) are never intercepted or cached.
 * The version and precache list are filled in at build time by vite.config.ts. */
const VERSION = '__VERSION__';
const CACHE = `save-library-shell-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('save-library-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party requests
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    // App shell for every in-scope navigation; network first so updates arrive, cache offline.
    event.respondWith(
      fetch(req)
        .then((res) => (res.ok ? res : caches.match(new URL('./index.html', scope).href, { ignoreVary: true }).then((r) => r || res)))
        .catch(() => caches.match(new URL('./index.html', scope).href, { ignoreVary: true }).then((r) => r || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)),
  );
});
