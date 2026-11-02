'use strict';
// Full Dictation: every level's phrases keep its rules (full bars of figures on the beat, the rests,
// the note counts, the first and last notes, skips in the home chord, the chords on the downbeats,
// short notes by step, Fi and Te where taught), and the generator's fallback stays rare; the octave
// keeps the melody near the staff; what is written is what plays and what is graded; the entry
// model; the grading, case by case and over random entries; the store.
//   node tone-ladder/tests/dictation-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
// a clock the store checks can move forward a day at a time
const RealDate = Date; let offset = 0;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
  static now() { return RealDate.now() + offset; }
};
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
for (const f of ['theory.js', 'curriculum.js', 'notation.js', 'store.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, D = TL.Dict, S = TL.Store, dict = TL.Curriculum.TRACK.dictation;
let bad = 0;
const fail = (m) => { bad++; if (bad <= 40) console.log('FAIL', m); };
const check = (ok, m) => { if (!ok) fail(m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sounding = (evs) => evs.filter((e) => !e.perc);

// 1. the generator, at every level
const I = { major: [[0, 4, 7], [5, 9, 0], [7, 11, 2]], minor: [[0, 3, 7], [5, 8, 0], [7, 11, 2]] };
let falls = 0, total = 0;
dict.levels.forEach((lv, L) => {
  const meters = new Set(), cells = new Set();
  let fb = 0, notesSum = 0, fiTe = 0;
  for (let n = 0; n < 400; n++) {
    const tonic = 55 + (n % 12);
    const fade = n % 2 === 1;
    const q = dict.generate(L, { tonic, withContext: n % 3 > 0, fade, labels: ['both', 'solfege', 'numbers'][n % 3] });
    const where = `L${L + 1} q${n} ${q.meter}`;
    const [barTicks, beat] = TL.METERS[q.meter];
    meters.add(q.meter);
    if (!(Array.isArray(lv.meter) ? lv.meter : [lv.meter]).includes(q.meter)) fail(`${where}: a meter the level does not have`);
    if (q.barTicks !== barTicks || q.beat !== beat || q.bars !== lv.bars) fail(`${where}: bars or beat wrong`);
    if (q.fallback) fb++;
    // bars full of figures from the palette, each on a beat and inside its bar
    let pos = 0;
    for (const f of q.figs) {
      cells.add(f.id);
      if (f.start !== pos || f.end !== f.start + TL.cellLen(f.id)) fail(`${where}: figures do not follow on`);
      if (f.start % beat) fail(`${where}: ${f.id} off the beat at ${f.start}`);
      if (Math.floor(f.start / barTicks) !== Math.floor((f.end - 1) / barTicks)) fail(`${where}: ${f.id} crosses a bar line`);
      if (!q.palette.includes(f.id)) fail(`${where}: ${f.id} is not in the palette`);
      pos = f.end;
    }
    if (pos !== lv.bars * barTicks) fail(`${where}: the bars hold ${pos} ticks`);
    if (!q.palette.every((c) => lv.cells.includes(c) && TL.cellLen(c) % beat === 0)) fail(`${where}: palette ${q.palette}`);
    // the rests, and the notes the figures make
    const parts = q.figs.flatMap((f) => { let p = f.start; return TL.RCELLS[f.id].ticks.map((t) => { const x = { tick: p, len: Math.abs(t), rest: t < 0 }; p += Math.abs(t); return x; }); });
    const rests = parts.filter((x) => x.rest), ons = parts.filter((x) => !x.rest);
    if (rests.some((x) => x.tick % barTicks === 0)) fail(`${where}: a rest on a downbeat`);
    if (rests.some((x) => x.tick >= (lv.bars - 1) * barTicks)) fail(`${where}: a rest in the last bar`);
    if (new Set(rests.map((x) => Math.floor(x.tick / barTicks / 2))).size < rests.length) fail(`${where}: two rests in one pair of bars`);
    if (q.notes.length < lv.notes[0] || q.notes.length > lv.notes[1]) fail(`${where}: ${q.notes.length} notes`);
    notesSum += q.notes.length;
    if (!same(q.notes.map((x) => [x.tick, x.len]), ons.map((x) => [x.tick, x.len]))) fail(`${where}: notes do not match the figures`);
    q.notes.forEach((x) => { if (x.id !== TL.degBySemi(x.semi).id) fail(`${where}: note ${x.semi} named ${x.id}`); });
    // the first and last notes, the leaps, no note twice in a row, chromatic notes resolved
    const mel = q.notes.map((x) => x.semi), last = q.notes[q.notes.length - 1];
    if (q.notes[0].tick !== 0 || !lv.starts.includes(mel[0])) fail(`${where}: starts on ${mel[0]} at ${q.notes[0].tick}`);
    if (![0, 12].includes(last.semi) || !lv.ends.includes(last.semi)) fail(`${where}: ends on ${last.semi}`);
    const lastAt = q.meter === '4/4' ? (lv.bars - 1) * barTicks + 24 : (lv.bars - 1) * barTicks;
    if (last.tick !== lastAt || last.tick + last.len !== lv.bars * barTicks) fail(`${where}: the last note is at ${last.tick} for ${last.len}`);
    for (let i = 1; i < mel.length; i++) {
      if (Math.abs(mel[i] - mel[i - 1]) > lv.maxLeap) fail(`${where}: a leap of ${mel[i] - mel[i - 1]}`);
      if (mel[i] === mel[i - 1]) fail(`${where}: a repeated note`);
      // skips in the home chord: a move of more than 2 semitones leaves and lands on Do, Mi or Sol
      if (lv.skipTones && Math.abs(mel[i] - mel[i - 1]) > 2 && ![mel[i - 1], mel[i]].every((s) => lv.skipTones.includes(TL.mod12(s)))) fail(`${where}: a skip from ${q.notes[i - 1].id} to ${q.notes[i].id}`);
    }
    for (const [c, to] of Object.entries(lv.chromatic || {})) mel.forEach((s, i) => { if (s === +c && mel[i + 1] !== to) fail(`${where}: ${c} does not resolve`); });
    if (lv.want) { if (mel.some((x) => lv.want.includes(x))) fiTe++; else fail(`${where}: no Fi or Te`); }
    // the rules a fallback may break: the downbeats' chords, short notes by step, the way into Do
    if (!q.fallback) {
      const C = I[lv.mode === 'minor' ? 'minor' : 'major'];
      q.notes.forEach((x, i) => {
        if (x.tick % barTicks === 0) {
          // the last bar in 4/4 may start on V's notes too: its Do comes on beat 3
          const b = x.tick / barTicks, ok = b === lv.bars - 1 && q.meter === '4/4' ? [...C[0], ...C[2]] : b === 0 || b === lv.bars - 1 ? C[0] : b === lv.bars - 2 ? C[2] : [...C[0], ...C[1]];
          if (!ok.includes(TL.mod12(x.semi))) fail(`${where}: bar ${b + 1} starts on ${x.id}`);
        }
        if (q.meter !== '6/8' && x.len < beat && ((i > 0 && Math.abs(mel[i] - mel[i - 1]) > 2) || (i < mel.length - 1 && Math.abs(mel[i + 1] - mel[i]) > 2))) fail(`${where}: the short note ${i} leaps`);
      });
      if (![2, 11, 7].includes(TL.mod12(mel[mel.length - 2]))) fail(`${where}: Do is reached from ${q.notes[q.notes.length - 2].id}`);
    }
    // what is asked, given and graded
    const given = lv.given === false ? null : q.notes[0].id;
    if (q.given !== given) fail(`${where}: given ${q.given}`);
    if (!same(q.stats, [...q.notes.slice(given ? 1 : 0).map((x) => x.id), ...q.figs.map((f) => f.id)])) fail(`${where}: stats`);
    if (!q.prompt.includes(q.meter) || (given ? /all its notes/.test(q.prompt) : !/all its notes/.test(q.prompt))) fail(`${where}: prompt "${q.prompt}"`);
    if (!q.stats.every((s) => lv.items.includes(s)) || !q.options.every((o) => lv.items.includes(o.id))) fail(`${where}: an item the level does not list`);
    if (q.hearings !== 4 || q.kind !== 'dictation' || q.layout !== 'ladder') fail(`${where}: kind, layout or hearings`);

    // 2. what is written is what plays and is graded
    const st = q.staff;
    if (st.clef !== 'treble' || st.time !== q.meter || st.bars !== barTicks / 12 || !st.beam) fail(`${where}: staff options`);
    if (Math.abs(st.notes.reduce((a, x) => a + x.dur, 0) - lv.bars * barTicks / 12) > 1e-9) fail(`${where}: the staff does not fill the bars`);
    const written = st.notes.filter((x) => !x.rest), reveal = sounding(q.audio.reveal), main = q.audio.main.filter((e) => e.staffIdx != null);
    if (written.length !== q.notes.length || reveal.length !== q.notes.length || main.length !== q.notes.length) { fail(`${where}: ${written.length} written, ${reveal.length} played, ${main.length} in the whole`); continue; }
    if (q.withContext !== q.audio.main.some((e) => e.role === 'context')) fail(`${where}: the chords ${q.withContext ? 'missing' : 'play'}`);
    const L0 = 'CDEFGAB'.indexOf(TL.keyName(tonic, q.mode)[0]);
    const t1 = main[0].t - reveal[0].t;
    let beats = 0, k = 0;
    for (const x of st.notes) {
      if (!x.rest) {
        const e = reveal[k], nt = q.notes[k];
        if (x.midi !== tonic + q.oct + nt.semi || e.notes[0] !== x.midi) fail(`${where}: note ${k} written ${x.midi}, played ${e.notes[0]}`);
        if (Math.abs(e.t - (q.barTicks + beats * 12) * q.tickSec) > 0.001) fail(`${where}: note ${k} plays at ${e.t}`);
        if (Math.abs(main[k].t - t1 - e.t) > 0.001 || main[k].notes[0] !== e.notes[0]) fail(`${where}: main and reveal differ at ${k}`);
        if (x.letter !== (L0 + Number(nt.id.slice(-1)) - 1) % 7) fail(`${where}: note ${k} on letter ${x.letter}`);
        if (e.staffIdx !== k || e.deg !== nt.id || e.timbre !== 'organ' || e.slot != null) fail(`${where}: event ${k} carries ${JSON.stringify(e)}`);
        if (!(e.dur > 0 && e.dur < nt.len * q.tickSec)) fail(`${where}: note ${k} lasts ${e.dur}`);
        k++;
      }
      beats += x.dur;
    }
    if (Math.abs(q.tickSec - 60 / q.bpm / (q.meter === '6/8' ? 18 : 12)) > 1e-12 || q.bpm !== (q.meter === '6/8' ? lv.bpm68 : lv.bpm)) fail(`${where}: tempo`);
    // the octave keeps the melody's furthest note from B4, the middle of the staff, as near as it can
    const far = (oct) => Math.max(...mel.map((s) => Math.abs(tonic + oct + s - 71)));
    if (far(q.oct) > far(12 - q.oct)) fail(`${where}: octave ${q.oct} puts a note ${far(q.oct)} semitones from B4, against ${far(12 - q.oct)}`);
    // the clicks: a counted-in bar, and under the melody where the level keeps them
    const clicks = q.audio.reveal.filter((e) => e.perc);
    const per = barTicks / (q.meter === '6/8' ? 6 : 12), under = lv.clicks === 'under' || (lv.clicks === 'fade' && !fade);
    if (clicks.length !== per * (under ? lv.bars + 1 : 1)) fail(`${where}: ${clicks.length} clicks`);
    if (clicks.some((e, i) => (e.perc === 'accent') !== ((i % per) % (q.meter === '6/8' ? 3 : per) === 0))) fail(`${where}: accents`);
    if (clicks.slice(per).some((e) => e.vel !== 0.45)) fail(`${where}: loud clicks under the melody`);
    if (q.clicks !== (under ? 'under' : 'countin')) fail(`${where}: clicks ${q.clicks}`);
    // the exact answer plays the melody back: at its own octaves once graded
    const exact = D.exact(q), g = TL.gradeDictation(q, exact);
    const cmp = sounding(q.compare(exact)), cmpG = sounding(q.compare(exact, g));
    if (cmp.length !== q.notes.length) fail(`${where}: compare plays ${cmp.length} notes`);
    if (cmp.some((e, i) => TL.mod12(e.notes[0] - reveal[i].notes[0]) || Math.abs(e.t - reveal[i].t) > 0.001)) fail(`${where}: compare differs from the melody`);
    if (cmpG.some((e, i) => e.notes[0] !== reveal[i].notes[0])) fail(`${where}: compare after grading is not at the melody's octaves`);
    if (!g.all || g.results.length !== q.stats.length) fail(`${where}: the exact answer is not all right`);
    // the staff draws: one note per note, and a time signature
    if (n % 8 === 0) {
      let svg = '', bare = '';
      try { svg = TL.Notation.staff(st); bare = TL.Notation.staff({ ...st, time: undefined }); } catch (e) { fail(`${where}: the staff threw ${e.message}`); }
      if ((svg.match(/<g class="note\b/g) || []).length !== q.notes.length) fail(`${where}: the staff has ${(svg.match(/<g class="note\b/g) || []).length} notes`);
      if (svg === bare) fail(`${where}: no time signature`);
      if (/undefined|NaN/.test(svg)) fail(`${where}: the staff has an undefined part`);
    }
  }
  total += 400; falls += fb;
  const missing = lv.cells.filter((c) => !cells.has(c));
  if (missing.length) fail(`L${L + 1}: ${missing} never used`);
  if (Array.isArray(lv.meter) && meters.size !== lv.meter.length) fail(`L${L + 1}: only ${[...meters]}`);
  if (fb / 400 > 0.04) fail(`L${L + 1}: fallback in ${fb} of 400`);
  console.log(`     L${L + 1} ${lv.name.padEnd(24)} fallback ${(fb / 4).toFixed(1)}%, ${(notesSum / 400).toFixed(1)} notes a melody${lv.want ? `, Fi or Te in ${fiTe} of 400` : ''}`);
});
console.log(`     fallback: ${falls} of ${total} (${(falls / total * 100).toFixed(2)}%)`);
if (falls / total > 0.04) fail(`fallback in ${(falls / total * 100).toFixed(1)}% of phrases`);
// level 2's note promises skips between Do, Mi and Sol, and levels 3 and 4 keep its notes
check(dict.levels.slice(1, 4).every((lv) => same(lv.skipTones, [0, 4, 7])), 'levels 2 to 4 skip only between Do, Mi and Sol');
// every introduction builds
dict.levels.forEach((lv, L) => {
  try {
    const it = dict.intro(L, { tonic: 60, context: L % 2 ? 'drone' : 'cadence', cadenceEvery: true, labels: 'both' });
    if (!it.note || !it.title) fail(`L${L + 1} intro has no note`);
    for (const c of it.cards) if (!c.text || !Array.isArray(c.demos)) fail(`L${L + 1} intro card ${c.id}`);
    const figs = lv.introduce.filter((c) => TL.RCELLS[c] && L > 0);
    if (!same(it.cards.map((c) => c.id), L === 0 ? ['listen', 'notes', 'hearings'] : figs)) fail(`L${L + 1} intro cards ${it.cards.map((c) => c.id)}`);
    if (L === 0 && it.cards[0].staff.ids.length !== it.cards[0].staff.notes.length) fail('L1 intro staff names');
  } catch (e) { fail(`L${L + 1} intro threw ${e.stack}`); }
});

// a question with a fixed phrase, for the cases below: the level's palette, options and given rule
function make(L, ids, semis, meter = '4/4') {
  let q;
  do q = dict.generate(L, { tonic: 60 }); while (q.meter !== meter);
  let p = 0;
  q.figs = ids.map((id) => { const f = { id, start: p, end: p + TL.cellLen(id) }; p = f.end; return f; });
  if (p !== q.bars * q.barTicks) throw new Error('make: ' + ids + ' is not ' + q.bars + ' bars');
  const on = q.figs.flatMap((f) => { let t = f.start; return TL.RCELLS[f.id].ticks.map((x) => { const o = { tick: t, len: x }; t += Math.abs(x); return o; }).filter((o) => o.len > 0); });
  q.notes = on.map((x, i) => ({ id: TL.degBySemi(semis[i]).id, semi: semis[i], tick: x.tick, len: x.len }));
  q.given = q.given === null ? null : q.notes[0].id;
  q.stats = [...(q.given ? q.notes.slice(1) : q.notes).map((x) => x.id), ...q.figs.map((f) => f.id)];
  return q;
}
// an entry from figures (in order, from the start) and names in order of the notes they make
function entry(q, ids, names) {
  let e = D.empty(q), p = 0;
  for (const id of ids) { e = D.place(q, e, id, p); if (!e) throw new Error('entry: cannot place ' + id + ' at ' + p); p += TL.cellLen(id); }
  D.onsets(q, e).forEach((x, i) => { if (!D.locked(q, x.tick)) e = D.name(q, e, x.tick, names[i]) || e; });
  return e;
}
const BASE = ['q', 'h', 'q', 'q', 'qr', 'q', 'q', 'dqe', 'h', 'ee', 'q', 'h'];
const SEMIS = [0, 2, 4, 5, 4, 2, 4, 5, 7, 9, 7, 2, 0];
const IDS = SEMIS.map((s) => TL.degBySemi(s).id);

// 3. the entry model
{
  const q = make(7, BASE, SEMIS);
  let e = D.empty(q);
  check(same(e, { figs: [], names: {} }) && D.blanks(q, e).length === 16 && !D.full(q, e) && !D.complete(q, e), 'an empty entry: sixteen empty beats, not complete');
  check(D.place(q, e, 'qr', 0) === null && D.refuse(q, 'qr', 0).why === 'first', 'a rest on the first beat is refused');
  check(same(D.refuse(q, 'h', 36), { why: 'bar', need: 2, left: 1, bar: 1 }) && D.place(q, e, 'h', 36) === null, 'a half note on beat 4 would cross the bar line: refused, 2 beats needed and 1 left');
  check(D.refuse(q, 'q', 6).why === 'beat' && D.refuse(q, 'eee', 12).why === 'figure', 'off the beat, or a figure of another level, is refused');
  e = D.place(q, e, 'q', 0);
  check(e.names[0] === q.given && D.locked(q, 0), 'the first note carries the given name');
  e = D.place(q, D.place(q, e, 'q', 12), 'q', 24);
  e = D.name(q, e, 12, '3'); e = D.name(q, e, 24, '4');
  check(D.name(q, e, 0, '5') === null && D.unname(q, e, 0) === null && D.name(q, e, 6, '5') === null && D.name(q, e, 12, 'b2') === null, 'the given name is locked; a name needs a note, and one of the options');
  const e2 = D.place(q, e, 'ee', 12);
  check(e2.names[12] === '3' && e2.names[18] === undefined && e2.names[24] === '4', 'two eighths over a named quarter keep its name on the first; the second is unnamed');
  const e3 = D.place(q, e, 'h', 0);
  check(same(e3.figs.map((f) => f.id + '@' + f.start), ['h@0', 'q@24']) && e3.names[12] === undefined && e3.names[0] === q.given && e3.names[24] === '4', 'a half note over two quarters replaces both; the name of the note it covers goes');
  const e4 = D.place(q, e, 'qr', 12);
  check(e4.names[12] === undefined && same(D.onsets(q, e4).map((x) => x.tick), [0, 24]), 'a rest over a named note drops its name');
  check(D.place(q, e4, 'q', 12).names[12] === undefined, 'and the name does not come back with a new note');
  const e5 = D.remove(q, e, 0);
  check(e5.names[0] === undefined && D.place(q, e5, 'q', 0).names[0] === q.given, 'without its note the given name goes; it comes back with the note');
  check(same(D.remove(q, e, 40), e) && D.figAt(e, 18).id === 'q' && D.figBefore(e, 36).start === 24 && D.figBefore(e, 0) === null, 'removing an empty beat changes nothing; the figure at and before a beat');
  check(D.room(q, 36) === 1 && D.barLeft(q, e, 0) === 1 && D.barLeft(q, e, 1) === 4, 'beats to the bar line, and empty beats in a bar');
  check(D.nextBlank(q, e, 0) === 36 && D.nextBlank(q, e, 180) === 36, 'the next empty beat, round to the start');
  check(D.nextUnnamed(q, e2, 0) === 2 && D.nextUnnamed(q, D.name(q, e2, 18, '2'), 3) === -1, 'the next unnamed note; none once all are named');
  // complete: every beat covered and every note named
  const full = entry(q, BASE, IDS);
  check(D.full(q, full) && D.complete(q, full) && same(full, D.exact(q)), 'the whole melody written is complete, and is the exact answer');
  const holes = D.unname(q, full, 72);
  check(D.full(q, holes) && !D.complete(q, holes) && same(D.unnamed(q, holes), [72]), 'full bars with a note unnamed: not complete');
  check(!D.complete(q, D.remove(q, full, 96)), 'an empty beat: not complete');
  check(same(JSON.parse(JSON.stringify(full)), full), 'an entry round-trips through JSON');
  const its = D.items(q, D.remove(q, full, 96));
  check(its.reduce((a, x) => a + x.len, 0) === q.bars * q.barTicks && its.filter((x) => x.kind === 'blank').length === 2 && its.filter((x) => x.kind === 'rest').length === 1, 'the items for drawing fill the bars: notes, the rest and two empty beats');
  check(D.letter({ tonic: 62, mode: 'major' }, '7') === 0 && D.letter({ tonic: 68, mode: 'minor' }, '7') === 3 && D.letter({ tonic: 63, mode: 'major' }, 'b7') === 1, 'letters from Do: Ti of D major on C, raised Ti of G♯ minor on F, Te of E♭ major on D');
  check(same(D.where(q, 150), { bar: 4, beat: 1, part: 1 }) && same(D.where(q, 60), { bar: 2, beat: 2, part: 0 }), 'where a tick is: bar, beat and eighths past it');
  const q13 = make(12, BASE, SEMIS);
  const e13 = D.place(q13, D.empty(q13), 'q', 0);
  check(q13.given === null && e13.names[0] === undefined && D.name(q13, e13, 0, '5').names[0] === '5', 'at level 13 the first note is not given, and can be named');
  // where named notes sound: nearest the note before, the given one where it is, right ones at the melody's octave once graded
  const qw = make(7, BASE, [0, 7, 4, 5, 4, 2, 4, 5, 7, 9, 7, 2, 0]);
  const ew = entry(qw, BASE, qw.notes.map((x) => x.id));
  check(D.pitches(qw, ew)[1] === -5 && D.pitches(qw, ew, TL.gradeDictation(qw, ew))[1] === 7, 'a Sol after Do sounds nearest it, below, until graded right, then where the melody has it');
  // a long climb written by name stays in the level's range: Do Re Mi ... High Do and on up, by step
  const up = ['1', '2', '3', '4', '5', '6', '7', '1', '2', '3', '4', '5', '6'];
  const eu = entry(qw, BASE, up);
  check(D.pitches(qw, eu).every((s) => s >= qw.range[0] && s <= qw.range[1]) && same(qw.range, [-5, 12]), `written notes stay between low Sol and High Do (got ${D.pitches(qw, eu)})`);
  const q1 = make(0, ['q', 'q', 'q', 'q', 'q', 'q', 'h'], [0, 2, 4, 5, 4, 2, 0]);
  check(D.near(q1, '1', 7) === 0 && D.near(qw, '1', 7) === 12, 'Do after Sol is Do at level 1 (Do to Sol), High Do where the level reaches it');
}

// 4. grading, case by case
{
  const q = make(7, BASE, SEMIS);
  const grade = (ids, names) => TL.gradeDictation(q, entry(q, ids, names));
  const wrongAt = (g) => g.notes.map((x, i) => (x.graded && !x.nameOk ? i : -1)).filter((i) => i >= 0);
  const lenWrong = (g) => g.notes.map((x, i) => (x.lenOk ? -1 : i)).filter((i) => i >= 0);
  const figWrong = (g) => g.figs.map((f, i) => (f.ok ? -1 : i)).filter((i) => i >= 0);
  let g = grade(BASE, IDS);
  check(g.all && g.results.every((r) => r === 1) && g.scores.length === 13 && g.scores.every((s) => s === 1) && !g.confusions.length && g.extra === 0 && g.right === 13, 'the exact answer: all right');
  check(g.results.length === q.stats.length && g.names.of === 12 && g.lengths.of === 13, 'results match the stats; the given first name is not graded');
  // one wrong name
  const one = IDS.slice(); one[5] = '6';
  g = grade(BASE, one);
  check(same(wrongAt(g), [5]) && same(g.confusions, [['2', '6']]) && g.scores[5] === 0.5 && g.right === 12 && !lenWrong(g).length, 'one wrong name: that note half right, its confusion recorded');
  S.reset();
  S.record({ track: 'dictation', level: 0, items: q.stats, results: g.results, scores: g.scores, confusions: g.confusions });
  check(S.state.conf.degrees && S.state.conf.degrees['2>6'] === 1 && !S.state.conf.dictation, 'the wrong name goes to the notes\' confusions');
  // two lengths swapped in bar 1: q h q written h q q
  g = grade(['h', 'q', 'q', ...BASE.slice(3)], IDS);
  check(same(lenWrong(g), [0, 1]) && same(figWrong(g), [0, 1]) && g.names.right === 12 && g.extra === 1 && g.written[1].extra && g.written[1].pair === 1, 'two lengths swapped in a bar: only those notes and figures are wrong; the moved note is extra, its name still paired');
  check(same(g.scores, [0, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]) && g.figs[0].said === null && g.figs[1].said === null && !g.confusions.length, 'the swap scores: the given note by its length only, a 0 for the extra note, no figure said');
  // a note dropped in bar 2: q qr q q written q qr h
  g = grade([...BASE.slice(0, 5), 'h', ...BASE.slice(7)], [...IDS.slice(0, 5), ...IDS.slice(6)]);
  check(same(wrongAt(g), [5]) && g.notes[5].pair === null && g.notes.slice(6).every((x) => x.nameOk) && g.extra === 0, 'a note dropped: it is missed, and the names after it pair again');
  check(same(lenWrong(g), [4, 5]) && same(figWrong(g), [5, 6]), 'the dropped note and the one held over it have wrong lengths; their two figures are wrong');
  // a rest written as a note
  g = grade([...BASE.slice(0, 4), 'q', ...BASE.slice(5)], [...IDS.slice(0, 4), '3', ...IDS.slice(4)]);
  check(g.extra === 1 && g.written[4].extra && g.written[4].pair === null && same(figWrong(g), [4]) && g.figs[4].said === 'q', 'a rest written as a note: one extra note, the rest wrong (said as a quarter)');
  check(g.scores.length === 14 && g.scores[13] === 0 && g.scores.slice(0, 13).every((s) => s === 1) && same(g.confusions, [['qr', 'q']]), 'every note right, a 0 for the extra one, and the figure\'s confusion');
  S.reset();
  S.record({ track: 'dictation', level: 0, items: q.stats, results: g.results, scores: g.scores, confusions: g.confusions });
  check(S.state.conf.rhythm && S.state.conf.rhythm['qr>q'] === 1 && !S.state.conf.degrees && !S.state.conf.dictation, 'the figure goes to the rhythms\' confusions');
  // a rest moved: q qr q q written q q qr q
  g = grade([...BASE.slice(0, 3), 'q', 'q', 'qr', 'q', ...BASE.slice(7)], IDS);
  check(same(lenWrong(g), [4]) && same(figWrong(g), [4, 5]) && g.figs[4].said === 'q' && g.figs[5].said === 'qr' && g.extra === 1 && g.names.right === 12 && g.scores[4] === 0.5, 'a rest moved: the note after it is late, its name still right; both figures said as the other');
  // ties, decided from the last notes back: a pair, then a missed note, then an extra one. The rest
  // moved, and the late note named Sol: pairing it with Mi costs as much as leaving both unpaired
  g = grade([...BASE.slice(0, 3), 'q', 'q', 'qr', 'q', ...BASE.slice(7)], [...IDS.slice(0, 4), '5', ...IDS.slice(5)]);
  check(g.notes[4].pair === 4 && g.written[4].pair === 4 && same(g.confusions, [['3', '5'], ['qr', 'q'], ['q', 'qr']]), `a tie between a pair and a missed note: the late Sol pairs with Mi, a wrong name (got pair ${g.notes[4].pair})`);
  // bar 1 written as a dotted quarter, an eighth and a half note, with Re and Mi the wrong way round:
  // Do Mi Re. Re paired with the written Re and Mi missed costs as much as Mi paired and Re missed
  g = grade(['dqe', 'h', ...BASE.slice(3)], ['1', '3', '2', ...IDS.slice(3)]);
  check(same(g.notes.slice(0, 4).map((x) => x.pair), [0, 2, null, 3]) && same(g.written.slice(0, 4).map((x) => x.pair), [0, null, 1, 3]), `a tie between a missed note and an extra one: Re pairs, Mi is missed, the written Mi is extra (got ${JSON.stringify(g.notes.slice(0, 4).map((x) => x.pair))})`);
  // every name wrong on the right rhythm
  const opts = q.options.map((o) => o.id);
  g = grade(BASE, IDS.map((id, i) => (i ? opts[(opts.indexOf(id) + 1) % opts.length] : id)));
  check(g.names.right === 0 && g.lengths.right === 13 && g.figs.every((f) => f.ok) && g.confusions.length === 12 && g.scores.slice(1).every((s) => s === 0.5), 'every name wrong on the right rhythm: names 0 of 12, lengths 13 of 13');
  // dqe written as q ee: the lengths differ, so nothing is "said"
  g = grade([...BASE.slice(0, 7), 'q', 'ee', ...BASE.slice(8)], [...IDS.slice(0, 7), '6', ...IDS.slice(7)]);
  check(same(figWrong(g), [7]) && g.figs[7].said === null && !g.confusions.length && same(lenWrong(g), [6]) && g.extra === 1 && same(g.figs[7].wrote.map((f) => f.id), ['q', 'ee']), 'a dotted quarter and eighth written as a quarter and two eighths: a figure error, no confusion; the eighth on its tick is right');
  // h written as q q
  g = grade(['q', 'q', 'q', ...BASE.slice(2)], [IDS[0], IDS[1], '3', ...IDS.slice(2)]);
  check(same(figWrong(g), [1]) && g.figs[1].said === null && !g.confusions.length && same(lenWrong(g), [1]) && g.extra === 1, 'a half note written as two quarters: a figure error with nothing said');
  // level 13 grades the first name
  const q13 = make(12, BASE, SEMIS);
  const g13 = TL.gradeDictation(q13, entry(q13, BASE, ['5', ...IDS.slice(1)]));
  check(q13.stats.length === 25 && g13.results.length === 25 && g13.results[0] === 0 && g13.notes[0].graded && g13.scores[0] === 0.5 && same(g13.confusions, [['1', '5']]), 'at level 13 the first name is graded');
  check(TL.gradeDictation(q13, entry(q13, BASE, IDS)).all, 'and the exact answer is all right there too');
  // a first note found a step high, every name after it a step high too, and La Ti in bar 3 heard as
  // one half note: each note written on its melody note's tick with its length still pairs with it,
  // so no name slides onto the note after it to be graded right, and no written note is missing
  const FIGS = ['ee', 'h', 'q', 'h', 'h', 'h', 'q', 'q', 'dqe', 'h'], UP = ['6', '5', '4', '3', '4', '5', '6', '7', '1', '2', '1', '2'];
  const qu = make(12, FIGS, [7, 5, 4, 2, 4, 5, 7, 9, 11, 12, 11, 12]);
  check(TL.gradeDictation(qu, entry(qu, FIGS, UP)).names.right === 0, 'every name a step high on the right rhythm: names 0 of 12');
  const eu = entry(qu, ['ee', 'h', 'q', 'h', 'h', 'h', 'h', 'dqe', 'h'], [...UP.slice(0, 8), ...UP.slice(9)]);
  const gu = TL.gradeDictation(qu, eu), wu = D.onsets(qu, eu);
  const away = gu.notes.filter((x) => x.tick !== 120 && x.tick !== 132);
  check(away.every((x) => x.pair != null && wu[x.pair].tick === x.tick && !x.nameOk) && gu.names.right <= 1, `and with La Ti written as one half note, the notes away from it still pair on their ticks, their names wrong (got names ${gu.names.right} of 12, pairs ${gu.notes.map((x) => x.pair)})`);
  // but a note on its tick with its length only breaks ties: bar 3's half note written in bar 1, with
  // every name in the order heard, pairs the notes between by order, so no right name is marked wrong
  const F6 = ['q', 'q', 'q', 'q', 'q', 'q', 'q', 'q', 'h', 'q', 'q', 'q', 'q', 'h'], S6 = [0, 2, 4, 5, 7, 5, 4, 2, 4, 5, 7, 9, 11, 12];
  const q6 = make(5, F6, S6);
  const g6 = TL.gradeDictation(q6, entry(q6, ['h', ...Array(12).fill('q'), 'h'], S6.map((s) => TL.degBySemi(s).id)));
  check(g6.names.right === 13 && !g6.confusions.some((c) => TL.DEG[c[0]]), `bar 3's half note written in bar 1, every name in order: names 13 of 13 and no confusion of names (got ${g6.names.right} of ${g6.names.of}, ${JSON.stringify(g6.confusions)})`);
  // and over a longer run between the two slips, so a bonus big enough to add up (1/6, 1/8) is caught
  const F7 = [...Array(12).fill('q'), 'h', 'h'], S7 = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 0];
  const q7 = make(5, F7, S7);
  const g7 = TL.gradeDictation(q7, entry(q7, ['h', ...Array(10).fill('q'), 'h', 'q', 'q'], S7.map((s) => TL.degBySemi(s).id)));
  check(g7.names.right === 13 && !g7.confusions.some((c) => TL.DEG[c[0]]), `the first two quarters written as one half note and the last half note as two: names 13 of 13 (got ${g7.names.right})`);
}

// 5. properties over random complete entries
{
  let n = 0;
  for (let k = 0; k < 2000; k++) {
    const L = k % dict.levels.length;
    const q = dict.generate(L, { tonic: 55 + (k % 12), fade: k % 2 === 1 });
    // a random entry: random figures that fit, from the start, and random names
    let e = D.empty(q);
    for (let t = 0; t < q.bars * q.barTicks;) {
      const fits = q.palette.filter((c) => !D.refuse(q, c, t));
      const c = TL.pick(fits);
      e = D.place(q, e, c, t);
      t += TL.cellLen(c);
    }
    D.onsets(q, e).forEach((x) => { if (!D.locked(q, x.tick)) e = D.name(q, e, x.tick, TL.pick(q.options).id); });
    if (!D.complete(q, e)) { fail(`random entry ${k} is not complete`); continue; }
    const g = TL.gradeDictation(q, e);
    n++;
    if (g.results.length !== q.stats.length) fail(`random ${k}: ${g.results.length} results for ${q.stats.length} stats`);
    if (!g.scores.every((s) => s >= 0 && s <= 1) || g.scores.length !== q.notes.length + g.extra) fail(`random ${k}: scores ${g.scores}`);
    if (!g.results.every((r) => r === 0 || r === 1)) fail(`random ${k}: results ${g.results}`);
    const pm = g.notes.map((x) => x.pair).filter((x) => x != null), pw = g.written.map((x) => x.pair).filter((x) => x != null);
    if (new Set(pm).size !== pm.length || new Set(pw).size !== pw.length || pm.length !== pw.length) fail(`random ${k}: a note paired twice`);
    if (g.notes.some((x, i) => x.pair != null && g.written[x.pair].pair !== i) || g.notes[0].pair !== 0) fail(`random ${k}: pairs disagree, or the first notes are not paired`);
    // pairs keep their order
    if (pm.some((j, i) => i && j <= pm[i - 1])) fail(`random ${k}: pairs cross`);
    if (!same(g, TL.gradeDictation(q, JSON.parse(JSON.stringify(e))))) fail(`random ${k}: grading is not deterministic`);
    const ex = TL.gradeDictation(q, D.exact(q));
    if (!ex.all || !ex.scores.every((s) => s === 1) || !ex.results.every((r) => r === 1)) fail(`random ${k}: the exact answer is not all 1s`);
  }
  console.log(`     ${n} random entries graded`);
}

// 6. the store
{
  S.reset();
  const t = S.track('dictation');
  let m = S.mastery('dictation');
  check(m.window === 30 && m.need === 27 && S.toGo('dictation').answers === 30, `the window is 30, 27 to level up (got ${m.window}, ${m.need})`);
  const lv = dict.levels[0];
  S.record({ track: 'dictation', level: 0, items: ['2', '3', 'q', 'h'], results: [1, 0, 1, 1], scores: [1, 0.5, 0.5, 1, 0] });
  check(same(t.window, [1, 0.5, 0.5, 1, 0]) && t.windowDays.length === 5, `scores feed the window (got ${JSON.stringify(t.window)})`);
  const day = S.today();
  check(Math.abs(day.c - 0.6) < 1e-9 && day.q === 1 && same(day.t.dictation, [1, 0.6]), `scores make the day's accuracy (got ${JSON.stringify(day)})`);
  check(S.item('dictation', '3').c === 0 && S.item('dictation', 'h').c === 1 && t.levelStats.q.n === 1, 'results still score the items');
  // 27 of the last 30 notes right, over two days, with each new figure answered: the level is passed
  S.reset();
  const answer = (scores) => S.record({ track: 'dictation', level: S.track('dictation').level, items: ['2', '3', 'q', 'h'], results: [1, 1, 1, 1], scores });
  for (let k = 0; k < 4; k++) answer([1, 1, 1, 1, 1]);
  check(!S.mastery('dictation').full && S.mastery('dictation').n === 20, '20 notes right: not yet');
  answer([1, 1, 1, 1, 1, 0, 0, 0, 1, 1]);
  m = S.mastery('dictation');
  check(m.full && !m.ready && m.correct === 27 && m.n === 30, `27 of 30 on one day: full, waiting for a second day (got ${m.correct} of ${m.n})`);
  // noon on the next calendar day: 24 hours on can still be the same date where the clocks go back
  { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); offset += d - new Date(); }
  answer([1]);
  check(S.mastery('dictation').ready && S.maybeLevelUp('dictation') === null && S.nextNeeds('dictation').track === 'melody', 'the next day it is ready, but level 2 waits for Melody');
  S.track('melody').maxLevel = 3;
  check(S.maybeLevelUp('dictation') === 1, 'once Melody reaches level 4: level 2');
  // confusions: names with the notes, figures with the rhythms; saves keep known items only
  S.reset();
  S.record({ track: 'dictation', level: 0, items: ['2', 'q'], results: [0, 0], confusions: [['5', '4'], ['dqe', 'h']] });
  check(S.state.conf.degrees['5>4'] === 1 && S.state.conf.rhythm['dqe>h'] === 1 && !S.state.conf.dictation, 'names go to Degrees\' confusions, figures to Rhythm\'s');
  const saved = JSON.parse(S.exportText()).state;
  saved.items['dictation:5'] = { n: 3, c: 2 }; saved.items['dictation:qr'] = { n: 2, c: 1 }; saved.items['dictation:zz'] = { n: 1, c: 1 };
  saved.conf.dictation = { '5>4': 2, 'qr>q': 1, 'zz>q': 1 };
  const back = S.parseBackup(JSON.stringify(saved));
  check(back.items['dictation:5'] && back.items['dictation:qr'] && !back.items['dictation:zz'], 'a save keeps dictation:5 and dictation:qr, drops dictation:zz');
  check(back.conf.degrees['5>4'] === 1 && back.conf.rhythm['dqe>h'] === 1 && back.conf.dictation['5>4'] === 2 && !('zz>q' in back.conf.dictation), 'confusions survive a save, unknown ones dropped');
  // a stored window longer than the track's keeps twice its window
  saved.tracks.dictation = { level: 0, maxLevel: 0, window: Array(80).fill(1), windowDays: Array(80).fill(1) };
  check(S.parseBackup(JSON.stringify(saved)).tracks.dictation.window.length === 60, 'a stored window keeps the last 60 answers');
}

console.log(bad ? `${bad} problems` : 'dictation OK');
process.exitCode = bad ? 1 : 0;
