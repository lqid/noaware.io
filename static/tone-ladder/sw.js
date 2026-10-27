/* Tone Ladder — works offline. The page, its scripts, styles, fonts and icons are kept in a cache
   once seen. Online, every request still goes to the network first, so a deploy is picked up on
   the next load; offline, the cache answers. Each file falls back on its own, so a load on a flaky
   network right after a deploy can mix two deploys' files; a reload with signal mends it. Nothing
   else is cached, and nothing is sent. Caches are per origin: only this app's are ever deleted. */
const CACHE = 'tone-ladder-shell';
const SHELL = [
  './', 'index.html', 'app.css', 'studio.css', 'manifest.webmanifest',
  'js/theory.js', 'js/audio.js', 'js/curriculum.js', 'js/store.js', 'js/pitch.js', 'js/take.js', 'js/take-worklet.js', 'js/app.js',
  '/fonts/cormorant-garamond-normal-latin.woff2', '/fonts/cormorant-garamond-italic-latin.woff2', '/fonts/instrument-sans-normal-latin.woff2',
  '/favicon.svg', '/apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tone-ladder-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});
