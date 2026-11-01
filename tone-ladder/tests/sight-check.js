'use strict';
// Sight-Singing: what is written is what plays and what is graded, in the voice's range and clef;
// melodies keep to their level's rules (start, end, leaps, no repeated note, Fi and Te where they
// are taught); the names and the key show as the level says; every staff and introduction renders.
//   node tone-ladder/tests/sight-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
for (const f of ['theory.js', 'curriculum.js', 'notation.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, N = TL.Notation, CUR = TL.Curriculum, sight = CUR.TRACK.sight, sing = CUR.TRACK.sing;
let bad = 0;
const fail = (m) => { bad++; if (bad <= 30) console.log('FAIL', m); };
// the same spans sing-check allows: the voice's span, with three semitones' grace below and one above
const RANGE = { low: [40, 65], mid: [45, 70], high: [52, 77] };
const count = (svg, cls) => (svg.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, 'g')) || []).length;
const noteChunks = (svg) => svg.split('<g class="note').slice(1);
const clefsSeen = {};
let questions = 0, staves = 0;
const fiTe = { n: 0, 6: 0, 10: 0 }, skips = { n: 0, with: 0 };

for (let L = 0; L < sight.levels.length; L++) {
  const lv = sight.levels[L];
  for (const voice of ['low', 'mid', 'high']) {
    for (let tonic = 55; tonic <= 66; tonic++) {
      for (let n = 0; n < 40; n++) {
        const fade = n % 2 === 1;
        const labels = ['both', 'solfege', 'numbers'][n % 3];
        const q = sight.generate(L, { tonic, item: lv.items[0], voice, fade, labels });
        questions++;
        const where = `L${L + 1} ${voice} tonic ${tonic}`;
        const mel = q.patternSemis, ids = q.pattern, notes = q.staff.notes;
        const reveal = q.audio.reveal;
        // 1. one written note per sung note per played note, named by its degree
        if (!(mel.length === lv.length && ids.length === mel.length && notes.length === mel.length && reveal.length === mel.length)) { fail(`${where}: lengths differ`); continue; }
        ids.forEach((id, i) => { if (id !== TL.degBySemi(mel[i]).id) fail(`${where}: pattern ${i} is ${id}, not ${TL.degBySemi(mel[i]).id}`); });
        // 2. in the own clef the staff is what plays; in the other clef, the same notes an octave or two away
        reveal.forEach((e, i) => {
          if (q.staff.other) { if (TL.mod12(notes[i].midi - e.notes[0]) !== 0) fail(`${where}: other clef note ${i} is not the same note`); }
          else if (notes[i].midi !== e.notes[0]) fail(`${where}: written ${notes[i].midi}, played ${e.notes[0]}`);
        });
        if (q.staff.other) for (let i = 1; i < notes.length; i++) if (notes[i].midi - notes[i - 1].midi !== mel[i] - mel[i - 1]) fail(`${where}: other clef changes the intervals`);
        // 3. what plays sits in the voice's span
        for (const e of reveal) if (e.notes[0] < RANGE[voice][0] || e.notes[0] > RANGE[voice][1]) fail(`${where}: ${e.notes[0]} outside the ${voice} range`);
        // 4. nothing before singing gives the melody away; the model and reveal carry each note's place on the staff
        if (q.audio.main.some((e) => e.timbre === 'organ' && e.deg)) fail(`${where}: a sung note plays before singing`);
        if (q.deg) fail(`${where}: q.deg is set`);
        if (q.model.filter((e) => e.staffIdx != null).length !== mel.length) fail(`${where}: the model does not hold the whole line`);
        reveal.forEach((e, i) => { if (e.staffIdx !== i) fail(`${where}: reveal note ${i} has staffIdx ${e.staffIdx}`); });
        // 5. the level's rules: leaps, no repeated note, where it starts and ends
        for (let i = 1; i < mel.length; i++) {
          if (Math.abs(mel[i] - mel[i - 1]) > lv.maxLeap) fail(`${where}: a leap of ${mel[i] - mel[i - 1]}`);
          if (TL.mod12(mel[i]) === TL.mod12(mel[i - 1])) fail(`${where}: the same note twice in a row`);
        }
        if (!lv.starts.includes(mel[0])) fail(`${where}: starts on ${mel[0]}`);
        if (!lv.ends.map(TL.mod12).includes(TL.mod12(mel[mel.length - 1]))) fail(`${where}: ends on ${mel[mel.length - 1]} (a generator fallback)`);
        // 6. a chromatic note is reached by step where the level says so, goes where it leans; Fi and Te turn up where they are taught
        mel.forEach((x, i) => {
          if (lv.chromatic && x in lv.chromatic && mel[i + 1] !== lv.chromatic[x]) fail(`${where}: ${x} does not resolve to ${lv.chromatic[x]}`);
          if (lv.chromatic && x in lv.chromatic && i && lv.approach != null && Math.abs(x - mel[i - 1]) > lv.approach) fail(`${where}: ${x} reached by a leap of ${x - mel[i - 1]}`);
        });
        // every note sits on the letter its degree gives, counted from Do's letter: reading from Do finds it
        const L0 = 'CDEFGAB'.indexOf(TL.keyName(tonic, q.mode)[0]);
        notes.forEach((nt, i) => { const want = (L0 + Number(ids[i].slice(-1)) - 1) % 7; if (nt.letter !== want) fail(`${where}: note ${i} (${ids[i]}) on letter ${nt.letter}, expected ${want}`); });
        if (lv.want && !mel.some((x) => lv.want.includes(x))) fail(`${where}: no Fi or Te`);
        if (lv.want) { fiTe.n++; for (const w of lv.want) if (mel.includes(w)) fiTe[w]++; }
        if (L === 1) { skips.n++; if (mel.some((x, i) => i && Math.abs(x - mel[i - 1]) > 2)) skips.with++; }
        // 7. names and key as the level says
        const names = lv.names === 'fade' ? (fade ? 'first' : 'all') : lv.names;
        if (q.staff.names !== names) fail(`${where}: names ${q.staff.names}, expected ${names}`);
        const hidden = lv.key === 'hidden' || (lv.key === 'fade' && fade);
        if (!!q.keyHidden !== hidden) fail(`${where}: key hidden ${q.keyHidden}, expected ${hidden}`);
        // 8. the clef for the voice, or both in the other-clef level
        if (lv.clef === 'both') (clefsSeen[voice] = clefsSeen[voice] || new Set()).add(q.staff.clef);
        else if (q.staff.clef !== CUR.SIGHT_CLEF.own[voice]) fail(`${where}: clef ${q.staff.clef}`);
        // 9. the staff draws: one head per note, no stray undefined, at most three ledger lines a note, no accidentals in a diatonic level
        if (n % 4 === 0) {
          staves++;
          let svg = '';
          try { svg = N.staff({ key: q.staff.key, clef: q.staff.clef, notes, lyrics: ids.map(() => 'x') }); } catch (e) { fail(`${where}: the staff threw ${e.message}`); continue; }
          if (/undefined|NaN/.test(svg)) fail(`${where}: the staff has an undefined part`);
          if (count(svg, 'head') !== notes.length) fail(`${where}: ${count(svg, 'head')} heads for ${notes.length} notes`);
          for (const c of noteChunks(svg)) if (count(c, 'ledger') > 3) fail(`${where}: more than three ledger lines`);
          if (!lv.chromatic && count(svg, 'acc') !== 0) fail(`${where}: an accidental in a diatonic melody`);
        }
      }
    }
  }
  // 10. every introduction builds, for every voice, key setting and microphone state, and its staves draw
  for (const voice of ['low', 'mid', 'high']) for (const keyMode of ['rotate', 'fixed']) for (const mic of ['on', 'ask', 'none']) {
    let d;
    for (let tonic = 55; tonic <= 66; tonic += mic === 'on' ? 1 : 12) { // every key once per voice and key setting
    try { d = sight.intro(L, { tonic, voice, keyMode, labels: 'both', mic }); } catch (e) { fail(`intro L${L + 1} ${voice} ${keyMode} ${mic} threw ${e.message}`); continue; }
    if (!d.cards.length) fail(`intro L${L + 1}: no cards`);
    for (const c of d.cards) if (c.staff) {
      staves++;
      try { const svg = N.staff({ key: c.staff.key, clef: c.staff.clef, notes: c.staff.notes, lyrics: c.staff.ids }); if (/undefined|NaN/.test(svg)) fail(`intro L${L + 1} card ${c.id}: undefined in the staff`); } catch (e) { fail(`intro L${L + 1} card ${c.id} threw ${e.message}`); }
      if (c.staff.ids.length !== c.staff.notes.length) fail(`intro L${L + 1} card ${c.id}: names and notes differ`);
    }
    }
  }
}
for (const voice of ['low', 'mid', 'high']) if (!clefsSeen[voice] || clefsSeen[voice].size !== 2) fail(`the other-clef level never showed both clefs to the ${voice} voice`);
// each note a level teaches turns up often enough to learn it, and a level about skips skips
if (fiTe[6] < fiTe.n / 3 || fiTe[10] < fiTe.n / 3) fail(`Fi in ${fiTe[6]} and Te in ${fiTe[10]} of ${fiTe.n} Fi and Te melodies: one is too rare`);
if (skips.with < skips.n * 0.6) fail(`only ${skips.with} of ${skips.n} Skips to Sol melodies skip`);
// 11. the gates point at the Sing levels that teach the notes
if (sing.levels[CUR.PREREQ.sight[0].level - 1].name !== 'Sing a pattern') fail('the track does not open after Sing a pattern');
const gate = (L) => sight.levels[L].needs && sing.levels[sight.levels[L].needs[0].level - 1].name;
if (gate(2) !== 'Longer patterns') fail('Low Sol to High Do does not wait for Longer patterns: ' + gate(2));
if (gate(6) !== 'Chromatic colors') fail('Fi and Te does not wait for Chromatic colors: ' + gate(6));
if (gate(7) !== 'Minor keys') fail('Minor keys does not wait for Sing\'s Minor keys: ' + gate(7));
console.log(`${questions} questions and ${staves} staves checked`);
console.log(bad ? `${bad} problems` : 'sight OK');
process.exitCode = bad ? 1 : 0;
