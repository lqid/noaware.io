// Runs the app in Node against a fake DOM, a recording stand-in for the audio module, seeded
// randomness and a virtual clock; drives every view, every track page, a long daily session,
// Progress (with twelve weeks of history, tests/weeks-fixture.js), Preferences, Explore and Full
// Dictation (at a phone's width and a desktop's) through the document listeners (twice answering
// while the question still sounds); and prints every observable effect (DOM writes, sounds asked
// for, saved data, timers, the session) as JSON lines. Two builds
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
    const h = { t0, done, cancelled: false, nominalEnd: t0 + end }; // as the real one: when its last note ends, in A.now()'s clock
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
let waited = null; // once, two minutes away before an answer: the day's practice time gains a minute of it
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
  const wait = q.kind === 'choice' && step > 4 && !waited;
  if (wait) { waited = { t0: R.lastActive, s0: TL.Store.today().s }; await advance(120000); }
  await advance(6000);
  const right = step % 3 !== 2;
  if (q.kind === 'choice') {
    const id = right ? q.answer : (q.options.find((o) => o.id !== q.answer) || q.options[0]).id;
    await act({ act: 'answer', id });
    if (wait) log('time', q.track, Math.round((tl.runner.lastActive - waited.t0) / 1000), TL.Store.today().s - waited.s0);
    await advance(3000);
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

// For app-check, which checks the Full Dictation staves on screen against what they were drawn
// from: each question as it is made (the next one asked), with the screen's width, its key's name,
// what each of its figures holds and its notes' names; and the staff in level 1's introduction
{
  const T = TL.Curriculum.TRACK.dictation, generate = T.generate, intro = T.intro;
  T.generate = function (...a) {
    const q = generate.apply(this, a), ids = [...new Set([...q.palette, ...q.figs.map((f) => f.id)])];
    log('dictq', clean({ width: globalThis.innerWidth, key: TL.keyName(q.tonic, q.mode), tonic: q.tonic, oct: q.oct, meter: q.meter, bars: q.bars, barTicks: q.barTicks, beat: q.beat, given: q.given, figs: q.figs, notes: q.notes, cells: Object.fromEntries(ids.map((id) => [id, TL.RCELLS[id].ticks])), names: Object.fromEntries(q.notes.map((n) => [n.id, TL.DEG[n.id].sol])) }));
    return q;
  };
  T.intro = function (...a) {
    const d = intro.apply(this, a), c = d.cards.find((x) => x.staff);
    if (c) log('dictintro', clean({ ...c.staff, names: c.staff.ids.map((id) => (id ? TL.DEG[id].sol : null)) }));
    return d;
  };
}

// Full Dictation, opened by a backup, with dictation playback on: on a phone, level 1's
// introduction and a question answered right by keys (one pressed while the melody first plays,
// which writes nothing, and a held Space, which plays it once); on a desktop, one answered by
// actions with a wrong figure and a wrong name (a figure refused on the way, one deleted and
// written again, a name deleted and given again), then Hear what you wrote; on a phone again, four
// bars (two systems) with an extra note, a name from a MIDI key in each step, and a fifth hearing
// that makes it practice
const Dict = TL.Dict;
const dictLog = (label) => { const R = tl.runner; log('dict', label, R && R.dict ? clean({ entry: R.dict.entry, step: R.dict.step, at: R.dict.at, ni: R.dict.ni, heard: R.heard, mainEnd: R.mainEnd != null, practice: !!(R.q && R.q.practice) }) : null); };
const heardOnce = async () => { for (let k = 0; k < 600 && tl.runner && tl.runner.mainEnd == null; k++) await advance(100); };
const introThrough = async () => { const R = tl.runner; if (R && R.phase === 'intro') { await act({ act: 'demo', card: R.intro.data.cards.length ? '0' : '-1', demo: '0' }); await advance(400); await key('Enter', 'Enter'); snap('dictation intro done'); } };
// the melody's figures, or with one change: two quarter notes in a bar as a half note (a wrong
// figure and a missing note), else the last half note as two quarter notes (an extra note)
const figsFor = (q, change) => {
  const ids = q.figs.map((f) => f.id), bar = (k) => Math.floor(q.figs[k].start / q.barTicks);
  const i = change === 'wrong' ? ids.findIndex((id, k) => id === 'q' && ids[k + 1] === 'q' && bar(k) === bar(k + 1)) : -1;
  if (i >= 0) ids.splice(i, 2, 'h'); else if (change) ids.splice(ids.lastIndexOf('h'), 1, 'q', 'q');
  return ids;
};
// the names for the written notes that still need one: the melody's where a note starts with it
const namesFor = (q) => Dict.onsets(q, tl.runner.dict.entry).filter((x) => !x.name).map((x) => (q.notes.find((n) => n.tick === x.tick) || q.notes[q.notes.length - 1]).id);
const nameKey = (q, id) => { const n = TL.DEG[id].num.replace(/[♭♯]/g, ''); return key(n, 'Digit' + n, { shiftKey: !TL.MODE_SCALE[q.mode].includes(id) }); };
TL.Store.applyBackup(TL.Store.parseBackup(JSON.stringify({ settings: { dailyGoal: 15, dictationSound: true }, onboarded: true, seen: { v2: true }, tracks: { degrees: { level: 3, maxLevel: 3 }, melody: { level: 2, maxLevel: 2 }, rhythm: { level: 1, maxLevel: 1 }, dictation: { level: 0, maxLevel: 5 } } })));
globalThis.innerWidth = 360;
await act({ act: 'go', view: 'today' }); await act({ act: 'go', view: 'track', track: 'dictation' }); snap('track dictation open');
await act({ act: 'practice', track: 'dictation' });
await introThrough();
let dq = tl.runner.q;
await key('1', 'Digit1'); dictLog('a key while the melody first plays');
await heardOnce();
await key(' ', 'Space'); for (let k = 0; k < 4; k++) { await advance(90); await key(' ', 'Space', { repeat: true }); } dictLog('a held Space');
await key('n', 'KeyN'); await key('Enter', 'Enter'); dictLog('no notes yet, the bars not full');
for (const id of figsFor(dq)) await key(String(dq.palette.indexOf(id) + 1), 'Digit' + (dq.palette.indexOf(id) + 1));
dictLog('the bars full: on to the names');
for (const id of namesFor(dq)) await nameKey(dq, id);
await key('Enter', 'Enter'); await advance(4000); snap('dictation feedback right'); dictLog('right');
globalThis.innerWidth = 1280;
await key('Enter', 'Enter');
dq = tl.runner.q;
await heardOnce();
await act({ act: 'dAt', tick: String(dq.barTicks - dq.beat) }); await act({ act: 'dFig', id: 'h' }); dictLog('a half note refused on the last beat of a bar');
await act({ act: 'dAt', tick: '0' });
const wrongFigs = figsFor(dq, 'wrong');
for (const id of wrongFigs) await act({ act: 'dFig', id });
await act({ act: 'dStep', step: 'rhythm' }); await act({ act: 'dAt', tick: '0' }); await act({ act: 'dBack' }); dictLog('the first figure deleted');
await act({ act: 'dFig', id: wrongFigs[0] }); await act({ act: 'dStep', step: 'notes' });
const wrongNames = namesFor(dq);
wrongNames[wrongNames.length - 2] = dq.options.find((o) => o.id !== wrongNames[wrongNames.length - 2]).id;
for (const id of wrongNames) await act({ act: 'dName', id });
const lastSlot = Dict.onsets(dq, tl.runner.dict.entry).length - 1;
await act({ act: 'dSlot', n: String(lastSlot) }); await act({ act: 'dBack' }); await act({ act: 'dName', id: wrongNames[wrongNames.length - 1] });
await act({ act: 'dPlay' }); await advance(2000); dictLog('a wrong figure and a wrong name');
await act({ act: 'dCheck' }); await advance(4000); snap('dictation feedback wrong'); dictLog('wrong');
await act({ act: 'dPlay' }); await advance(3000);
await act({ act: 'exitSession' }); snap('dictation summary');
await act({ act: 'go', view: 'today' });
globalThis.innerWidth = 360;
await act({ act: 'practiceLevel', track: 'dictation', level: '5' });
await introThrough();
dq = tl.runner.q;
await heardOnce();
for (let k = 0; k < 4; k++) { await act({ act: 'replay', part: 'melody' }); await advance(15000); }
dictLog('a fifth hearing');
for (const id of figsFor(dq, 'extra')) await key(String(dq.palette.indexOf(id) + 1), 'Digit' + (dq.palette.indexOf(id) + 1));
await key('r', 'KeyR'); await key('ArrowLeft', 'ArrowLeft');
const extraNames = namesFor(dq);
tl.midiNote(dq.tonic + 12 + TL.DEG[extraNames[0]].semi); dictLog('a MIDI key in Rhythm');
await key('n', 'KeyN'); await key('ArrowRight', 'ArrowRight'); await key('ArrowLeft', 'ArrowLeft');
tl.midiNote(dq.tonic + TL.DEG[extraNames[1]].semi);
for (const id of extraNames.slice(2)) await nameKey(dq, id);
await key('Backspace', 'Backspace'); await nameKey(dq, extraNames[extraNames.length - 1]);
const dictFrom = { t0: tl.runner.lastActive, s0: TL.Store.today().s };
await key('Enter', 'Enter'); await advance(4000); snap('dictation feedback extra'); dictLog('extra');
log('time', 'dictation', Math.round((tl.runner.lastActive - dictFrom.t0) / 1000), TL.Store.today().s - dictFrom.s0); // over a minute on one answer, all of it practice
await key('Enter', 'Enter'); await advance(10);
await act({ act: 'exitSession' }); snap('dictation summary 2');
await act({ act: 'go', view: 'progress' }); await act({ act: 'progTrack', track: 'dictation' }); snap('progress dictation');
await act({ act: 'go', view: 'today' });
log('mastery', TL.Curriculum.TRACKS.map((t) => { const m = TL.Store.mastery(t.id); return [t.name, m.need, m.window]; })); // what Method should state

// ---- Full Dictation, the review's fixes, in a block of its own: level 1 on a desktop with the note
// names as numbers and dictation playback on. A figure and a name written along while a hearing
// plays make no sound and leave it playing; the bars filled, and a step switched, from a button
// reached with the keyboard keep the focus in the stage; Play mine over the chords keeps the pill
// on Listening until it ends; a merged figure and a wrong name are told as degrees. app-check
// reads the "dict-fix" lines. On the way, with a drone on, a figure written once a hearing is over
// still sounds ("dictdrone"). After it, four bars on a desktop at Fi and Te, where the focus stays
// in the stage when the bars fill with every note named, and on the Altered notes toggle
// ("dictfocus").
{
  const fixLog = (...a) => log('dict-fix', ...a);
  const since = (from, name) => out.slice(from).map((l) => JSON.parse(l)).filter((x) => x[0] === name);
  // a keyboard user's focus, on a button inside #stage; and lookups by more than one data
  // attribute, or by class, which the fake DOM above leaves unanswered, answered from the HTML
  const qs = document.querySelector;
  let focused = null;
  const focusOn = (dataset) => { focused = { dataset, closest: (s) => (s === '#stage' ? {} : null) }; };
  Object.defineProperty(document, 'activeElement', { get: () => focused, configurable: true });
  document.contains = () => false; // an edit draws its buttons afresh
  document.querySelector = (sel) => {
    const found = qs.call(document, sel);
    if (found) return found;
    const attrs = [...sel.matchAll(/\[(data-[\w-]+="[^"]*")\]/g)].map((m) => m[1]);
    if (attrs.length > 1 && present(attrs.join(' '))) return el(sel);
    // a slot drawn as text (the given note) cannot take the focus: only a button slot is found
    if (sel === '#dictSlots .slot.active' && Object.values(html).some((h) => /<button class="slot[^"]*\bactive\b/.test(h))) return el(sel);
    return null;
  };
  try {
    TL.Store.set('labels', 'numbers');
    globalThis.innerWidth = 1280;
    await act({ act: 'practiceLevel', track: 'dictation', level: '0' });
    await introThrough();
    const q = tl.runner.q, R = tl.runner;
    await heardOnce();
    // hearing 2, written along: figures by key until two notes are written, then a name tapped
    await act({ act: 'replay', part: 'melody' }); await advance(500);
    const h = R.playH;
    let from = out.length, k = 0;
    while (Dict.onsets(q, R.dict.entry).length < 2) { const n = q.palette.indexOf(q.figs[k++].id) + 1; await key(String(n), 'Digit' + n); }
    await act({ act: 'dName', id: q.notes[1].id });
    fixLog('along', { playing: R.playH === h && !!h && !h.cancelled, sounds: since(from, 'A.play').length + since(from, 'A.stop').length, named: Dict.onsets(q, R.dict.entry).filter((x) => x.name).length });
    for (; k > 0; k--) await key('Backspace', 'Backspace');
    await advance(15000);
    // the hearing over, with a drone on (A.playing() stays true while it sounds): a figure written
    // by key sounds; it is deleted again
    const playing = A.playing, n1 = q.palette.indexOf(q.figs[0].id) + 1;
    A.playing = () => true;
    from = out.length;
    await key(String(n1), 'Digit' + n1);
    A.playing = playing;
    log('dictdrone', since(from, 'A.play').length);
    await key('Backspace', 'Backspace');
    // the bars filled from a palette button (two quarter notes written as a half note), then the
    // steps switched from their buttons
    from = out.length;
    for (const id of figsFor(q, 'wrong')) { focusOn({ act: 'dFig', id }); await act({ act: 'dFig', id }, 0); }
    for (const step of ['rhythm', 'notes']) { focusOn({ act: 'dStep', step }); await act({ act: 'dStep', step }, 0); }
    focused = null;
    fixLog('focus', since(from, 'focus').map((x) => x[1]));
    // Play mine over the chords
    await act({ act: 'replay', part: 'context' }); await advance(300);
    const chords = A.playing(), pill = (f) => since(f, 'class').filter((x) => x[1] === '#listenState' && x[2] === 'idle').map((x) => x[3]);
    from = out.length;
    await act({ act: 'dPlay' });
    fixLog('pill', 'play mine', chords, pill(from));
    from = out.length;
    await advance(20000);
    fixLog('pill', 'play mine ended', chords, pill(from));
    // one name wrong, then Check
    const names = namesFor(q);
    names[names.length - 1] = q.options.find((o) => o.id !== names[names.length - 1]).id;
    for (const id of names) await act({ act: 'dName', id });
    await act({ act: 'dCheck' }); await advance(4000);
    fixLog('said', [...html['#stage'].matchAll(/<p class="explain">([^<]*)<\/p>/g)].map((m) => m[1]));
    await act({ act: 'exitSession' }); snap('dictation fixes');
    // Four bars on a desktop, so in one system, at Fi and Te: altered notes, and so Altered notes
    // on the staff the names are picked from. All but the last figure written, their notes named
    // by MIDI keys in Rhythm, then the bars filled with rests from a palette button reached with
    // the keyboard: the names come next with every note named, and the focus goes to a slot that
    // can hold it. Then Altered notes from the keyboard, and Check. The names are back to both, as
    // app-check reads them under the melody.
    TL.Store.set('labels', 'both'); TL.Store.set('unlockAll', true); TL.Store.set('input', 'staff');
    await act({ act: 'practiceLevel', track: 'dictation', level: '9' });
    await introThrough();
    const q4 = tl.runner.q, last = q4.figs[q4.figs.length - 1];
    await heardOnce();
    // Notes opened by hand with only the given note written: the cursor must not rest on it
    { const n = q4.palette.indexOf('q') + 1; await key(String(n), 'Digit' + n); await key('n', 'KeyN'); await key('r', 'KeyR'); await key('Backspace', 'Backspace'); }
    for (const f of q4.figs.slice(0, -1)) { const n = q4.palette.indexOf(f.id) + 1; await key(String(n), 'Digit' + n); }
    for (const id of namesFor(q4)) tl.midiNote(q4.tonic + TL.DEG[id].semi);
    dictLog('four bars on a desktop, named by MIDI keys in Rhythm');
    from = out.length;
    for (let b = 0; b < TL.cellLen(last.id) / q4.beat; b++) { focusOn({ act: 'dFig', id: 'qr' }); await act({ act: 'dFig', id: 'qr' }, 0); }
    log('dictfocus', 'every note named', since(from, 'focus').map((x) => x[1]));
    from = out.length;
    focusOn({ act: 'staffAlt' }); await act({ act: 'staffAlt' }, 0);
    focused = null;
    log('dictfocus', 'altered notes', since(from, 'focus').map((x) => x[1]));
    dictLog('four bars on a desktop, every note named');
    await key('Enter', 'Enter'); await advance(4000); dictLog('four bars on a desktop, checked');
    await act({ act: 'exitSession' }); snap('dictation four bars on a desktop');
  } finally {
    TL.Store.set('unlockAll', false); TL.Store.set('input', 'ladder');
    TL.Store.set('labels', 'both');
    document.querySelector = qs;
    delete document.contains;
    Object.defineProperty(document, 'activeElement', { get: () => null, configurable: true });
  }
}
// Melodic Dictation with Sing it back first and, this once, a microphone: the question before the
// set, whose words app-check reads ("micgate")
{
  const supported = A.micSupported;
  A.micSupported = () => true; TL.Store.set('singBack', true);
  try {
    await act({ act: 'practice', track: 'melody' });
    if (tl.runner && tl.runner.phase === 'intro') await key('Enter', 'Enter');
    log('micgate', tl.runner && tl.runner.phase, tl.runner && tl.runner.micGate);
    await act({ act: 'exitSession' }); snap('melodic dictation microphone');
  } finally {
    A.micSupported = supported; TL.Store.set('singBack', false);
  }
}
} catch (e) { log('run-error', where(e)); process.exitCode = 1; }
process.stdout.write(out.join('\n') + '\n');
