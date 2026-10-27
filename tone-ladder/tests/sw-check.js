'use strict';
// The service worker keeps the app working offline: every file it precaches exists, every file the
// page and its styles load is on its list, and its handlers answer from the network first and from
// the cache when the network fails.
//   node tone-ladder/tests/sw-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
const site = path.join(dir, '..'); // the studio's static root: fonts and icons live there
const BASE = 'https://noaware.io/tone-ladder/';
let bad = 0;
const fail = (m) => { bad++; console.log(m); };
const src = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
const SHELL = vm.runInNewContext('[' + src.match(/const SHELL = \[([\s\S]*?)\];/)[1] + ']');

// a small browser: a URL-keyed cache storage, a fetch that reads the disk and can go offline, and
// the worker's own globals
const href = (u, ignoreSearch) => { const x = new URL(typeof u === 'string' ? u : u.url, BASE + 'sw.js'); if (ignoreSearch) x.search = ''; return x.href; };
const onDisk = (u) => { const p = new URL(u).pathname; return p.startsWith('/tone-ladder/') ? path.join(dir, p.slice('/tone-ladder/'.length) || 'index.html') : path.join(site, p); };
let online = true;
const fetched = [];
const fetch = async (req) => {
  if (!online) throw new TypeError('offline');
  const u = href(req); fetched.push(u);
  const ok = fs.existsSync(onDisk(u)) && fs.statSync(onDisk(u)).isFile();
  return { ok, status: ok ? 200 : 404, url: u, from: 'network', clone() { return this; } };
};
const stores = new Map();
const mkCache = () => {
  const m = new Map();
  const match = (req, o = {}) => { const k = href(req, o.ignoreSearch); for (const [u, r] of m) if ((o.ignoreSearch ? href(u, true) : u) === k) return r; return undefined; };
  return { add: async (u) => { const r = await fetch({ url: href(u) }); if (!r.ok) throw new TypeError('add failed ' + u); m.set(href(u), r); }, put: async (req, res) => { m.set(href(req), res); }, match: async (req, o) => match(req, o), keys: async () => [...m.keys()] };
};
const caches = {
  open: async (n) => { if (!stores.has(n)) stores.set(n, mkCache()); return stores.get(n); },
  keys: async () => [...stores.keys()],
  delete: async (n) => stores.delete(n),
  match: async (req, o) => { for (const c of stores.values()) { const r = await c.match(req, o); if (r) return r; } return undefined; },
};
const listeners = {}, flags = {};
const self = { addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: async () => { flags.skip = true; }, clients: { claim: async () => { flags.claim = true; } }, location: new URL(BASE + 'sw.js') };
vm.runInNewContext(src, { self, caches, fetch, URL, console }, { filename: 'sw.js' });
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // install: everything on the list is on disk and ends up in the cache
  let pending;
  listeners.install({ waitUntil: (p) => { pending = p; } });
  await pending;
  const shell = stores.get('tone-ladder-shell');
  if (!shell) fail('install made no cache');
  const have = new Set(shell ? await shell.keys() : []);
  for (const u of SHELL) if (!have.has(href(u))) fail(`not cached (missing on disk?): ${u} → ${onDisk(href(u))}`);
  if (!flags.skip) fail('install does not skip waiting');

  // the page and its styles load nothing that is not on the list
  const refs = [];
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<(?:link|script|img)\b[^>]*?(?:src|href)="([^"]+)"/g)) refs.push([m[1], BASE + 'index.html']); // files the page loads, not links it offers
  for (const css of ['app.css', 'studio.css']) {
    const text = fs.readFileSync(path.join(dir, css), 'utf8');
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) refs.push([m[1], BASE + css]);
  }
  for (const [ref, from] of refs) {
    if (/^(https?:|data:|#|mailto:)/.test(ref)) { if (/^https?:/.test(ref) && !ref.startsWith('https://noaware.io/')) fail(`third-party reference: ${ref}`); continue; }
    const u = new URL(ref, from).href;
    if (!have.has(u)) fail(`loaded by the page but not precached: ${ref} (${from.slice(BASE.length)})`);
  }
  // the worklet is loaded by audio.js
  if (!have.has(BASE + 'js/take-worklet.js')) fail('take-worklet.js not precached');

  // activate: this app's older caches go, this one and other apps' stay, open pages are claimed
  stores.set('tone-ladder-old', mkCache()); stores.set('other-app', mkCache());
  listeners.activate({ waitUntil: (p) => { pending = p; } });
  await pending;
  if (stores.has('tone-ladder-old')) fail('activate kept an old cache');
  if (!stores.has('other-app')) fail('activate deleted another app\'s cache (caches are per origin)');
  if (!stores.has('tone-ladder-shell')) fail('activate dropped the shell cache');
  if (!flags.claim) fail('activate does not claim clients');

  const ask = async (req) => { let answer; listeners.fetch({ request: { method: 'GET', mode: 'cors', ...req }, respondWith: (p) => { answer = p; } }); const res = answer ? await answer : undefined; await tick(); await tick(); return { handled: !!answer, res }; };
  // online: the network answers and the copy is refreshed
  fetched.length = 0;
  let r = await ask({ url: BASE + 'js/app.js' });
  if (!r.handled || !r.res || r.res.from !== 'network' || fetched[0] !== BASE + 'js/app.js') fail('online request did not go to the network');
  const cachedApp = await shell.match(BASE + 'js/app.js');
  if (cachedApp !== r.res) fail('online response not stored in the cache');
  r = await ask({ url: BASE + 'nothing-here.png' });
  if (!r.res || r.res.ok || await shell.match(BASE + 'nothing-here.png')) fail('a failed response was cached');
  // offline: the cache answers, a query string does not matter, and a page request falls back to the app
  online = false;
  r = await ask({ url: BASE + 'js/app.js?v=9' });
  if (!r.res || r.res !== cachedApp) fail('offline request not answered from the cache');
  r = await ask({ url: BASE + 'practice?set=3', mode: 'navigate' });
  if (!r.res || r.res.url !== BASE) fail('offline page request did not fall back to the app page');
  r = await ask({ url: BASE + 'takes/x.wav' });
  if (r.res !== undefined) fail('an unknown offline request was answered');
  // not ours: other origins and non-GET requests pass straight through
  r = await ask({ url: 'https://example.com/x.js' });
  if (r.handled) fail('cross-origin request handled');
  r = await ask({ url: BASE + 'index.html', method: 'POST' });
  if (r.handled) fail('POST handled');
  online = true;
  console.log(bad ? `${bad} problems` : `sw OK (${SHELL.length} files precached)`);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => { console.log('sw-check crashed: ' + e.stack); process.exitCode = 1; });
