/* Tone Ladder — works offline. The page, its scripts, styles, fonts and icons are kept in a cache
   once seen. Online, every request still goes to the network first, so a deploy is picked up on
   the next load; offline, the cache answers. Each file falls back on its own, so a load on a flaky
   network right after a deploy can mix two deploys' files; a reload with signal mends it. Nothing
   else is cached, apart from recorded notes once played, and nothing is sent. Caches are per origin:
   only this app's are ever deleted. */
const CACHE = 'tone-ladder-shell';
const SHELL = [
  './', 'index.html', 'app.css', 'studio.css', 'manifest.webmanifest',
  'js/theory.js', 'js/audio.js', 'js/curriculum.js', 'js/store.js', 'js/pitch.js', 'js/take.js', 'js/take-worklet.js', 'js/notation.js', 'js/music.js', 'js/start-guard.js',
  'js/app/base.js', 'js/app/state.js', 'js/app/dictation-view.js', 'js/app/plan.js', 'js/app/explore.js', 'js/app/method.js', 'js/app/dictation.js', 'js/app/midi.js', 'js/app/today.js', 'js/app/sing-view.js', 'js/app/prefs.js', 'js/app/track.js', 'js/app/progress.js', 'js/app/your-music.js', 'js/app/router.js', 'js/app/session.js', 'js/app/rhythm.js', 'js/app/session-view.js', 'js/app/answer.js', 'js/app/mic.js', 'js/app/answer-view.js', 'js/app/main.js',
  '/fonts/cormorant-garamond-normal-latin.woff2', '/fonts/cormorant-garamond-italic-latin.woff2', '/fonts/instrument-sans-normal-latin.woff2',
  '/favicon.svg', '/apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
];
self.addEventListener('install', (e) => {
  // past the browser's HTTP cache (GitHub Pages lets it keep a file ten minutes), so the shell, and
  // the modules that must link as one set, come from the deploy that shipped this worker
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))).then(() =>
    // the single-file app the modules replaced: dropped only once every page cached loads the
    // modules instead, so no cached page is left without its script
    c.keys().then((keys) => Promise.all(keys.filter((r) => /\/tone-ladder\/(index\.html)?(\?.*)?$/.test(r.url)).map((r) => c.match(r).then((res) => (res ? res.text() : '')))))
      .then((pages) => (pages.length && pages.every((t) => t.includes('js/app/main.js') && !t.includes('src="js/app.js"')) ? c.delete('js/app.js') : null))
  )).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tone-ladder-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // recorded notes carry a content hash in their names, so a copy once seen is good for ever; the
  // manifest that names them stays network-first, so a new set is picked up
  if (/\/samples\/.+\.m4a$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    // offline, a page request gets the app's own page first, whatever URL it was cached under
    }).catch(() => (req.mode === 'navigate' ? caches.match('./') : Promise.resolve(undefined)).then((page) => page || caches.match(req, { ignoreSearch: true })))
  );
});
