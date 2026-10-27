'use strict';
// Every generator at every level, many times: the questions are well formed (answers among the
// options, events with notes in range, melodies within their leaps, rhythms the right length),
// every introduction builds, and the progress store survives a 400-answer run.
//   node tone-ladder/tests/generators-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
// a clock the store run can move forward a day at a time
const RealDate = Date; let offset = 0;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
  static now() { return RealDate.now() + offset; }
};
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
for (const f of ['theory.js', 'curriculum.js', 'store.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL;
const { TRACKS } = TL.Curriculum;
let problems = 0;
const fail = (msg) => { problems++; if (problems < 40) console.log('FAIL', msg); };
const checkEvents = (evs, where) => {
  if (!Array.isArray(evs)) return fail(where + ': events not array');
  for (const e of evs) {
    if (!(e.t >= 0) || !(e.dur > 0)) fail(where + ': bad t/dur ' + JSON.stringify(e));
    if (!e.perc) {
      if (!e.notes || !e.notes.length) fail(where + ': no notes');
      for (const m of e.notes) if (!Number.isFinite(m) || m < 28 || m > 100) fail(where + ': note out of range ' + m);
    }
  }
};
const stats = {};
for (const tr of TRACKS) {
  tr.levels.forEach((lv, L) => {
    for (let n = 0; n < 400; n++) {
      const tonic = 55 + Math.floor(Math.random() * 12);
      const item = tr.picksItem ? TL.pick(lv.items) : undefined;
      const where = `${tr.id} L${L + 1}`;
      let q;
      try {
        q = tr.generate(L, { tonic, item, withContext: Math.random() < 0.7, voice: TL.pick(['low', 'mid', 'high']), hints: {}, practice: Math.random() < 0.5, fade: Math.random() < 0.5, maxLevel: L });
      } catch (e) { fail(where + ': threw ' + e.stack); break; }
      if (q.kind === 'choice') {
        if (!q.options.some((o) => o.id === q.answer)) fail(where + ': answer not among options ' + q.answer);
        checkEvents(q.audio.main, where + ' main');
        checkEvents(q.audio.reveal, where + ' reveal');
        for (const o of q.options) checkEvents(q.compare(o.id), where + ' compare');
      } else if (q.kind === 'sequence') {
        const ids = new Set(q.options.map((o) => o.id));
        for (const a of q.answer) if (!ids.has(a)) fail(where + ': seq answer not in options ' + a + ' of ' + [...ids]);
        if (q.answer.length !== q.stats.length) fail(where + ': stats length');
        checkEvents(q.audio.main, where + ' main');
        checkEvents(q.compare(q.answer), where + ' compare');
        if (tr.id === 'melody') {
          const mel = q.melody;
          for (let i = 1; i < mel.length; i++) if (Math.abs(mel[i] - mel[i - 1]) > lv.maxLeap) fail(where + ': leap too big ' + mel);
          if (!lv.ends.map(TL.mod12).includes(TL.mod12(mel[mel.length - 1]))) { stats[where + ' fallback'] = (stats[where + ' fallback'] || 0) + 1; }
          for (const [c, to] of Object.entries(lv.chromatic || {})) {
            mel.forEach((s, i) => { if (s === +c && mel[i + 1] !== to) fail(where + ': chromatic unresolved ' + mel); });
          }
        }
        if (tr.id === 'harmony') {
          const key = q.seqLabels.join(' ');
          stats[where] = stats[where] || new Set(); stats[where].add(key);
          // voicings: bass below upper voices
          for (const e of q.audio.main) { const [b, ...u] = e.notes; if (!(b < Math.min(...u))) fail(where + ': bass above upper ' + e.notes); }
        }
      } else if (q.kind === 'tap') {
        const r = q.rhythm;
        const total = r.ticks.reduce((a, t) => a + Math.abs(t), 0);
        if (total !== r.barTicks * r.bars) fail(where + ': rhythm length ' + total);
        if (lv.introduce.length) {
          stats[where] = stats[where] || {}; for (const c of r.cells) stats[where][c] = (stats[where][c] || 0) + 1;
        }
      } else if (q.kind === 'sing') {
        checkEvents(q.audio.main, where + ' main');
        checkEvents(q.audio.reveal, where + ' reveal');
      } else fail(where + ': unknown kind ' + q.kind);
    }
    // intro
    try {
      const intro = tr.intro(L, { tonic: 60, hints: {}, voice: 'mid' });
      for (const c of intro.cards) for (const d of c.demos) checkEvents(d.events, `${tr.id} L${L + 1} intro ${c.id}`);
      for (const d of intro.demos) checkEvents(d.events, `${tr.id} L${L + 1} intro demo`);
    } catch (e) { fail(`${tr.id} L${L + 1} intro threw ` + e.stack); }
  });
}
for (const [k, v] of Object.entries(stats)) {
  if (v instanceof Set) console.log(k, 'distinct progressions:', v.size, [...v].slice(0, 4).join(' | '));
  else if (typeof v === 'number') console.log(k, v);
  else console.log(k, JSON.stringify(v));
}
// the store, over 400 answers at 95% with a practice day every 25
const S = TL.Store;
let ups = 0;
for (let i = 0; i < 400; i++) {
  const t = S.track('degrees');
  const lv = TRACKS[0].levels[t.level];
  const it = S.chooseItem('degrees', lv.items, { newItems: lv.introduce, recent: [], levelStats: t.levelStats });
  S.record({ track: 'degrees', level: t.level, items: [it], results: [Math.random() < 0.95 ? 1 : 0], rt: 1500 });
  if (S.maybeLevelUp('degrees') !== null) ups++;
  if (i % 25 === 24) offset += 86400000;
}
console.log('simulated 400 answers at 95%: level ups =', ups, 'now level', S.track('degrees').level + 1, 'streak', S.streak());
if (!(ups > 0)) fail('400 answers at 95% never levelled up');
console.log(problems ? `${problems} problems` : 'generators OK');
process.exitCode = problems ? 1 : 0;
