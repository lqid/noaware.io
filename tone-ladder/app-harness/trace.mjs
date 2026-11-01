// Runs the app in Node against a fake DOM, a recording stand-in for the audio module, seeded
// randomness and a virtual clock; drives every view, every track page, a long daily session,
// Progress (with twelve weeks of history, tests/weeks-fixture.js), Preferences and Explore through
// the document listeners (twice answering while the question still sounds); and prints every observable
// effect (DOM writes, sounds asked for, saved data, timers, the session) as JSON lines. Two builds
// that behave the same print the same lines. Errors print as listener-error, timer-error,
// rejection-error, load-error or run-error lines, with where they happened.
//   node tone-ladder/app-harness/trace.mjs modules [static/tone-ladder]     the ES modules (js/app/)
//   node tone-ladder/app-harness/trace.mjs bundle [static/tone-ladder]      the claude.ai bundle of them
//   node tone-ladder/app-harness/trace.mjs classic <static/tone-ladder>     a single-file js/app.js, as before the split
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { bundleApp } from '../app-bundle.mjs';
import weeksFixture from '../tests/weeks-fixture.js';

const mode = process.argv[2] || 'modules';
const root = process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'tone-ladder');
if (!['modules', 'bundle', 'classic'].includes(mode)) { console.error('usage: trace.mjs <modules|bundle|classic> [static/tone-ladder]'); process.exit(1); }
const out = [];
const log = (...a) => out.push(JSON.stringify(a));
const realSetImmediate = setImmediate;
// what went wrong, then where: the first line of the stack that names a file
const where = (e) => { const st = String(e && e.stack || '').split('\n'); const loc = st.find((l) => /file:\/\/|\bat /.test(l)) || ''; return [String(e && e.message || e), loc.trim()].filter(Boolean).join(' | '); };
// as in a browser, a promise nobody catches is reported and the app carries on; anything else that
// escapes still prints what was recorded before it
process.on('unhandledRejection', (e) => log('rejection-error', where(e)));
process.on('uncaughtException', (e) => { log('run-error', where(e)); process.stdout.write(out.join('\n') + '\n'); process.exit(1); });

// ---- seeded randomness and a virtual clock
let seed = 12345;
Math.random = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const EPOCH = Date.UTC(2026, 10, 2, 0, 0, 0);
let vnow = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(EPOCH + vnow); } static now() { return EPOCH + vnow; } };
Object.defineProperty(globalThis, 'performance', { value: { now: () => vnow }, configurable: true });
let tseq = 0; const timers = new Map();
globalThis.setTimeout = (fn, ms = 0, ...args) => { const id = ++tseq; timers.set(id, { id, at: vnow + Math.max(0, +ms || 0), fn, args, every: null, seq: id }); return id; };
globalThis.setInterval = (fn, ms = 0, ...args) => { const id = ++tseq; timers.set(id, { id, at: vnow + Math.max(1, +ms || 0), fn, args, every: Math.max(1, +ms || 0), seq: id }); return id; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
const flush = () => new Promise((r) => realSetImmediate(r));
async function advance(ms) {
  const end = vnow + ms;
  await flush(); await flush();
  for (;;) {
    let next = null;
    for (const t of timers.values()) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t;
    if (!next) break;
    vnow = next.at;
    if (next.every) { next.at += next.every; next.seq = ++tseq; } else timers.delete(next.id);
    try { next.fn(...next.args); } catch (e) { log('timer-error', String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    await flush(); await flush();
  }
  vnow = end;
}

// ---- storage, location, navigator
let mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
globalThis.window = globalThis;
globalThis.location = { hash: '', pathname: '/tone-ladder/', search: '', origin: 'http://localhost', protocol: 'http:', reload() { log('reload'); } };
globalThis.history = { replaceState: (...a) => log('replaceState', a[2]) };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Equiv', platform: 'MacIntel', maxTouchPoints: 0, clipboard: { writeText: async (t) => { log('clipboard', t.length); } } }, configurable: true });
globalThis.innerWidth = 1280;
globalThis.devicePixelRatio = 1;
globalThis.isSecureContext = true;
globalThis.matchMedia = (q) => ({ matches: q.includes('hover') });
globalThis.scrollTo = (x, y) => log('scrollTo', x, y);
globalThis.getComputedStyle = () => ({ color: '#000' });

// ---- a fake DOM: containers keep their HTML; an id or data-act exists while its HTML says so
const html = { '#view': '', '#stage': '' };
const present = (frag) => Object.values(html).some((h) => h.includes(frag));
const classes = new Set();
function el(sel) {
  const e = {
    sel, dataset: {}, style: { setProperty: (k, v) => log('style', sel, k, v) }, hidden: true, disabled: false, value: '', files: null,
    classList: { toggle: (c, on) => { log('class', sel, c, on); }, add: (c) => log('class+', sel, c), remove: (c) => log('class-', sel, c), contains: () => false },
    set innerHTML(v) { log('html', sel, v); if (sel === '#view') { for (const k of Object.keys(html)) html[k] = ''; } html[sel] = v; },
    get innerHTML() { return html[sel] || ''; },
    set outerHTML(v) { log('outer', sel, v); html[sel] = v; },
    set textContent(v) { log('text', sel, v); }, get textContent() { return ''; },
    set className(v) { log('className', sel, v); },
    focus() { log('focus', sel); }, select() {}, blur() {}, scrollIntoView(o) { log('scrollIntoView', sel); }, click() { log('click', sel); }, remove() {},
    setAttribute: (k, v) => log('attr', sel, k, v), removeAttribute: (k) => log('attr-', sel, k), matches: () => false, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }), clientWidth: 600, clientHeight: 80, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], play: async () => {}, pause() {}, paused: true, currentTime: 0,
    get nextElementSibling() { return null; },
  };
  return e;
}
const fixed = { '#view': el('#view'), '#toast': el('#toast'), '#app': el('#app') };
const listeners = {};
globalThis.document = {
  body: { classList: { toggle: (c, on) => log('body-class', c, on) }, appendChild() {} },
  get activeElement() { return null; }, visibilityState: 'visible',
  querySelector(sel) {
    if (fixed[sel]) return fixed[sel];
    if (sel.startsWith('meta[')) return null;
    let m = sel.match(/^#([\w-]+)$/);
    if (m) return present(`id="${m[1]}"`) ? el(sel) : null;
    m = sel.match(/^\[data-act="([\w-]+)"\]$/);
    if (m) return present(`data-act="${m[1]}"`) ? el(sel) : null;
    if (sel === '.s-head') return present('class="s-head"') ? el(sel) : null;
    return null;
  },
  querySelectorAll(sel) { if (sel === '#nav button') return ['today', 'explore', 'music', 'progress', 'method', 'prefs'].map((v) => Object.assign(el('#nav ' + v), { dataset: { view: v } })); return []; },
  addEventListener(type, fn, cap) { (listeners[type] ||= []).push({ fn, cap: !!cap }); },
  createElement: (t) => el('<' + t + '>'),
};
async function dispatch(type, ev) {
  const ls = listeners[type] || [];
  for (const l of [...ls.filter((x) => x.cap), ...ls.filter((x) => !x.cap)]) { try { l.fn(ev); } catch (e) { log('listener-error', type, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); } }
  await advance(0);
}
const act = (data, detail = 1) => dispatch('click', { type: 'click', detail, timeStamp: vnow, preventDefault() {}, target: { closest: (s) => (s === '[data-act]' ? { dataset: data, disabled: false, blur() {}, getBoundingClientRect: () => ({ left: 0, width: 100 }) } : null) } });
const key = (k, code, more = {}) => dispatch('keydown', { type: 'keydown', key: k, code, repeat: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, timeStamp: vnow, preventDefault() {}, target: { matches: () => false, closest: () => null }, ...more });

// ---- the classic modules, then a fake audio module in place of TL.Audio
const js = path.join(root, 'js');
try {
  for (const f of ['theory.js', 'audio.js', 'curriculum.js', 'store.js', 'pitch.js', 'take.js', 'notation.js', 'music.js']) vm.runInThisContext(fs.readFileSync(path.join(js, f), 'utf8'), { filename: f });
} catch (e) { log('load-error', where(e)); process.stdout.write(out.join('\n') + '\n'); process.exit(1); }
const TL = globalThis.TL, real = TL.Audio;
const plays = new Set();
const round = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
const clean = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? 'fn' : round(x))));
const A = {
  SAMPLED: real.SAMPLED, TIMBRES: real.TIMBRES, micOn: false, micMuted: false, running: true, droneTonic: null, takeSec: 45, takeHas: false,
  onSamples: null, onState: null, onMic: null,
  configure: (c) => log('A.configure', clean(c)), ensure: () => { log('A.ensure'); return {}; }, wake: () => {},
  stop() { log('A.stop'); for (const p of plays) { p.cancel(); } plays.clear(); },
  play(evs, o = {}) {
    if (o.keep !== true) A.stop(); // as the real one: a new sound stops the last
    log('A.play', clean(evs), clean({ timbre: o.timbre, raw: o.raw, lead: o.lead, onEvent: !!o.onEvent }));
    const t0 = vnow / 1000 + (o.lead ?? 0.08);
    let res; const done = new Promise((r) => (res = r));
    const ids = [];
    evs.forEach((ev, i) => { ids.push(setTimeout(() => { if (o.onEvent) o.onEvent(ev, i); }, ((o.lead ?? 0.08) + (ev.t || 0)) * 1000)); });
    const end = Math.max(0, ...evs.map((e) => (e.t || 0) + (e.dur || 0)));
    const h = { t0, done, cancelled: false };
    const p = { cancel: () => { h.cancelled = true; ids.forEach(clearTimeout); clearTimeout(fin); res(false); } };
    const fin = setTimeout(() => { plays.delete(p); res(true); }, ((o.lead ?? 0.08) + end) * 1000);
    plays.add(p);
    return h;
  },
  droneStart(t, l) { log('A.droneStart', t, l); A.droneTonic = t; }, droneStop(f) { log('A.droneStop', f); A.droneTonic = null; }, droneLevel: (l) => log('A.droneLevel', l),
  playing: () => plays.size > 0, now: () => vnow / 1000, latency: () => 0, inLatency: () => 0.01, heardTime: (ts) => ts / 1000,
  micSupported: () => false, micOpen: () => Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' })), micClose: () => log('A.micClose'), micFrame: () => null, micRate: () => 48000, micInfo: () => null,
  takeStart() {}, takeStop() {}, takeForget() {}, takeSound: () => null,
  sampled: () => 'missing', loadSamples: (n) => log('A.loadSamples', n), probeSamples: (n) => log('A.probeSamples', n), samplesInfo: () => null, renderTest: async () => null,
};
TL.Audio = A;

// ---- the app
try {
  if (mode === 'classic') vm.runInThisContext(fs.readFileSync(path.join(js, 'app.js'), 'utf8'), { filename: 'app.js' });
  else if (mode === 'bundle') vm.runInThisContext(bundleApp(path.join(js, 'app')).code, { filename: 'app-bundle.js' });
  else await import(pathToFileURL(path.join(js, 'app', 'main.js')).href);
} catch (e) { log('load-error', where(e)); }
// whatever happens from here, everything recorded is printed: a failure shows what led to it
try {
await advance(10);
if (!globalThis.__toneLadder) throw new Error('the app did not start (window.__toneLadder is not set)');
const tl = globalThis.__toneLadder;
const snap = (label) => { log('step', label, vnow); log('storage', Object.keys(mem).sort().map((k) => [k, mem[k]])); log('timers', [...timers.values()].map((t) => [t.at - vnow, t.every]).sort((a, b) => a[0] - b[0])); const R = tl.runner; log('runner', R ? clean({ phase: R.phase, bi: R.bi, qid: R.qid, key: R.key, answered: R.answered, score: R.score, q: R.q && { track: R.q.track, level: R.q.level, kind: R.q.kind, item: R.q.item, answer: R.q.answer } }) : null); };
snap('boot');
for (const v of ['explore', 'music', 'progress', 'method', 'prefs', 'today']) { await act({ act: 'go', view: v }); snap('view ' + v); }
for (const t of TL.Curriculum.TRACKS) { await act({ act: 'go', view: 'track', track: t.id }); snap('track ' + t.id); }
await act({ act: 'go', view: 'today' });
// a daily session: right, right, wrong, ... answers through the action table and the keyboard
await act({ act: 'startDaily' }); snap('startDaily');
for (let step = 0; step < 160; step++) {
  const R = tl.runner; if (!R) break;
  if (R.phase === 'summary') { snap('summary'); break; }
  if (R.phase === 'intro') { for (let d = 0; d < 2; d++) await act({ act: 'demo', card: '0', demo: String(d) }); await advance(400); await key('Enter', 'Enter'); snap('intro done'); continue; }
  if (R.phase === 'between') { if (step % 7 === 3) await act({ act: 'skipBlock' }); else await key('Enter', 'Enter'); snap('between'); continue; }
  if (R.phase === 'mic') { await act({ act: 'micNo' }); snap('mic'); continue; }
  const q = R.q; if (!q) { await advance(1000); continue; }
  // twice a right answer while the question still sounds: the first time as it plays (counted, at
  // no time), the second after a part of it was replayed over it (not counted)
  if (q.kind === 'choice' && (step === 1 || step === 4)) {
    for (let k = 0; k < 300 && !(R.mainH && R.playH === R.mainH); k++) await advance(10);
    if (step === 4) await act({ act: 'replay', part: Object.keys(q.audio.parts)[0] });
    const times = () => [...(((TL.Store.state.days[TL.dayKey()] || {}).rt || {})[q.track] || [0, 0])]; // a copy: the store adds in place
    const before = times();
    await act({ act: 'answer', id: q.answer });
    log('soon', step, q.track, before, times());
    await advance(3000);
    if (tl.runner && tl.runner.q === q && tl.runner.phase === 'feedback') await key('Enter', 'Enter');
    snap('q ' + q.id + ' ' + q.track + ' ' + q.kind + ' soon');
    continue;
  }
  await advance(6000);
  const right = step % 3 !== 2;
  if (q.kind === 'choice') {
    const id = right ? q.answer : (q.options.find((o) => o.id !== q.answer) || q.options[0]).id;
    await act({ act: 'answer', id }); await advance(3000);
    if (tl.runner && tl.runner.q === q && tl.runner.phase === 'feedback') { await act({ act: 'hear', what: 'correct' }); await key('Enter', 'Enter'); }
  } else if (q.kind === 'sequence') {
    q.answer.forEach((a, i) => {});
    for (let i = 0; i < q.answer.length; i++) { const a = q.answer[i]; const id = right || i ? a : (q.options.find((o) => o.id !== a) || q.options[0]).id; await act({ act: 'pick', id }); }
    await key('Backspace', 'Backspace'); await act({ act: 'pick', id: q.answer[q.answer.length - 1] });
    await key('Enter', 'Enter'); await advance(4000); await key('Enter', 'Enter');
  } else if (q.kind === 'sing') {
    await act({ act: 'singReveal' }); await advance(4000);
    await act({ act: 'singGrade', v: String(right ? 1 : step % 2 ? 0.5 : 0) }); await advance(2000);
    if (tl.runner && tl.runner.phase === 'feedback') await key('Enter', 'Enter');
  } else if (q.kind === 'tap') {
    await advance(20000); await act({ act: 'rGo' }); await advance(200);
    for (let i = 0; i < 6; i++) { await dispatch('pointerdown', { target: { closest: (s) => (s === '#tapPad' ? {} : null) }, timeStamp: vnow, preventDefault() {} }); await advance(500); }
    await advance(20000); await act({ act: 'next' });
  }
  snap('q ' + q.id + ' ' + q.track + ' ' + q.kind);
}
await act({ act: 'go', view: 'progress' }); snap('progress after');
for (const t of ['sing', 'intervals', 'rhythm']) { await act({ act: 'progTrack', track: t }); }
snap('progress tabs');
// twelve weeks of history, with level-ups, answer times and intonation: every track's charts
TL.Store.applyBackup(TL.Store.parseBackup(JSON.stringify(weeksFixture(Date.now(), TL.dayKey))));
await act({ act: 'go', view: 'progress' });
for (const t of TL.Curriculum.TRACKS) await act({ act: 'progTrack', track: t.id });
await act({ act: 'progTrack', track: 'intervals' }); await act({ act: 'chartTip', tip: 'a week' });
snap('progress weeks');
await act({ act: 'go', view: 'prefs' }); await act({ act: 'resetArm' }); await act({ act: 'go', view: 'today' }); await act({ act: 'go', view: 'prefs' }); snap('reset disarmed by go');
await act({ act: 'exportProgress' }); snap('export');
await act({ act: 'go', view: 'explore' }); for (const a of [{ act: 'exChord', rn: 'IV' }, { act: 'exChord', rn: 'V7' }, { act: 'exNote', id: '4', semi: '5' }, { act: 'exDir', dir: 'd' }, { act: 'exInterval', iv: 'P5' }, { act: 'exReplayTrail' }, { act: 'exDrone' }, { act: 'exMode', mode: 'minor' }]) { await act(a); await advance(500); }
snap('explore');
} catch (e) { log('run-error', where(e)); process.exitCode = 1; }
process.stdout.write(out.join('\n') + '\n');
