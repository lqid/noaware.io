'use strict';
// Progress and level-ups: the twenty-answer window, the two-day rule, what is left to level up,
// old saves, the newer-format guard, device settings on a paste, and the voicing Explore produces.
//   node tone-ladder/tests/progress-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
// a clock the checks can move forward a day at a time
const RealDate = Date; let offset = 0;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
  static now() { return RealDate.now() + offset; }
};
const nextDay = () => { offset += 86400000; };
let mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
for (const f of ['theory.js', 'curriculum.js', 'store.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, S = TL.Store;
let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
let turn = 0;
const answer = (id, r = 1) => { const t = S.track(id); const lv = TL.Curriculum.TRACK[id].levels[t.level]; S.record({ track: id, level: t.level, items: [lv.items[turn++ % lv.items.length]], results: [r] }); return S.maybeLevelUp(id); };

// 1. twenty right answers in one day fill the window but do not level up
let g = S.toGo('degrees');
check(g.answers === 20 && g.needsDay, `fresh level: 20 right answers needed, over two days (got ${g.answers}, needsDay ${g.needsDay})`);
let ups = 0;
for (let i = 0; i < 20; i++) if (answer('degrees') !== null) ups++;
let m = S.mastery('degrees');
check(ups === 0 && m.full && !m.dayOk && !m.ready, 'same-day window: full but not ready');
g = S.toGo('degrees');
check(g.answers === 0 && g.needsDay, 'toGo says: ready, needs another day');
nextDay();
check(answer('degrees') === 1, 'one right answer the next day levels up');

// 2. a window saved before day tracking counts as an earlier day
mem = {};
const old = { v: 1, settings: {}, tracks: { chords: { level: 0, maxLevel: 0, window: Array(19).fill(1), levelStats: { maj: { n: 10, c: 10 }, min: { n: 9, c: 9 } }, intro: { 0: 2 } } } };
S.state = S.parseBackup(JSON.stringify(old));
check(S.state.tracks.chords.windowDays.length === 19 && S.state.tracks.chords.windowDays.every((d) => d === 0), 'old window gets placeholder days');
check(S.state.v === S.FORMAT, 'loaded state is stamped with the current format');
check(answer('chords') === 1, 'old window plus one answer today levels up');

// 3. toGo counts new items that are holding the level back
S.state = S.parseBackup(JSON.stringify({ settings: {}, tracks: { degrees: { level: 1, maxLevel: 1, window: Array(20).fill(1), windowDays: [...Array(10).fill(5), ...Array(10).fill(6)], levelStats: { '3': { n: 1, c: 1 } } } } }));
g = S.toGo('degrees');
check(g.answers === 0 && g.items.length === 1 && g.items[0].item === '3' && g.items[0].more === 2, `new item Mi needs 2 more right (got ${JSON.stringify(g.items)})`);

// 4. progress saved by a newer format is left alone, and nothing is written over it
mem = { 'tone-ladder-v1': JSON.stringify({ v: S.FORMAT + 1, updatedAt: 5, settings: {}, tracks: {}, future: 'keep me' }) };
S.blocked = false;
S.init();
const before = mem['tone-ladder-v1'];
S.touch(); S.writeLocal();
check(S.blocked && mem['tone-ladder-v1'] === before, 'newer save: blocked, localStorage untouched');
let refused = false; try { S.parseBackup(JSON.stringify({ v: S.FORMAT + 1, settings: {}, tracks: {} })); } catch (e) { refused = /newer/.test(e.message); }
check(refused, 'newer-format paste refused');
S.blocked = false;

// 5. a paste keeps this device's own settings
mem = {};
S.state = S.parseBackup(JSON.stringify({ settings: { tapOffsetMs: 120, volume: 0.3, speed: 0.8, labels: 'numbers' }, tracks: {} }));
S.applyBackup(S.parseBackup(JSON.stringify({ settings: { tapOffsetMs: -40, volume: 1, speed: 1.2, labels: 'solfege' }, tracks: {} })));
const st = S.state.settings;
check(st.tapOffsetMs === 120 && st.volume === 0.3 && st.speed === 0.8 && st.labels === 'solfege', 'device settings kept, shared settings taken');

// 6. voicing: random chord sequences from every Roman numeral, as Explore produces them
const names = Object.keys(TL.RN);
let seqs = 0, withPar = 0, crossings = 0;
for (let n = 0; n < 3000; n++) {
  const tonic = 55 + (n % 12);
  const seq = Array.from({ length: 6 }, () => names[Math.floor(Math.random() * names.length)]);
  const v = TL.voiceProgression(seq, tonic);
  seqs++;
  if (v.some((c, i) => i && TL.parallels(v[i - 1], c))) withPar++;
  v.forEach((c) => { for (let x = 1; x < 4; x++) if (c[x] <= c[x - 1]) crossings++; });
}
console.log(`     random sequences with a parallel: ${withPar} of ${seqs} (${(withPar / seqs * 100).toFixed(1)}%), crossings ${crossings}`);
check(withPar / seqs < 0.05 && crossings === 0, 'random chord sequences: almost no parallels, no crossings');

// 7. toGo simulates the sliding window; a level already passed needs no second day; device keys come from this device's saved copy
mem = {}; S.blocked = false;
S.state = S.parseBackup(JSON.stringify({ settings: {}, tracks: {} }));
const d0 = (() => { S.record({ track: 'chords', level: 0, items: ['maj'], results: [1] }); return S.track('chords').windowDays.at(-1); })();
const tc = S.track('chords');
tc.window = [0, 0, ...Array(16).fill(1), 0, 0]; tc.windowDays = [d0 - 1, d0 - 1, ...Array(18).fill(d0)]; tc.levelStats = { maj: { n: 9, c: 9 }, min: { n: 9, c: 9 } };
const gg = S.toGo('chords');
check(gg.answers === 2 && gg.needsDay, `yesterday's answers slide out: still needs another day (got ${JSON.stringify(gg)})`);
const tl = S.track('intervals'); tl.level = 1; tl.maxLevel = 3; tl.window = Array(20).fill(1); tl.windowDays = Array(20).fill(d0); tl.levelStats = { P4a: { n: 5, c: 5 } };
check(S.mastery('intervals').ready && !S.toGo('intervals').needsDay, 'a level already passed levels up without a second day');
mem['tone-ladder-v1'] = JSON.stringify({ v: 2, settings: { tapOffsetMs: 95, volume: 0.4, speed: 1.2 }, tracks: {} });
const arriving = S.parseBackup(JSON.stringify({ settings: { tapOffsetMs: 0, volume: 1, speed: 1 }, tracks: {} }));
S.keepDevice(arriving);
check(arriving.settings.tapOffsetMs === 95 && arriving.settings.volume === 0.4, 'device settings come from this device\'s saved copy');

console.log(bad ? `${bad} problems` : 'progress checks OK');
process.exitCode = bad ? 1 : 0;
