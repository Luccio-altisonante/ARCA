const CACHE = 'sillabe-reviewer-shell-v6';
const SHELL = ['./', './index.html', './style.css', './app.mjs', './reviewer-core.mjs', './db.mjs', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const urls = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
// A new shell waits until the user explicitly reloads; no forced mid-session update.
self.addEventListener('message', event => { if (event.data === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(n => n.startsWith('sillabe-reviewer-shell-') && n !== CACHE).map(n => caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !urls.has(url.href)) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, {ignoreSearch: false});
    if (cached) return cached;
    // This path is only for the enumerated app shell, never imported datasets.
    return fetch(event.request);
  })());
});
