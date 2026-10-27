'use strict';
// Singing questions: the notes the learner is to sing stay in the chosen voice's range, Find Do
// practice rounds sound Do, and every level's introduction builds.
//   node tone-ladder/tests/sing-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
for (const f of ['theory.js', 'curriculum.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, sing = TL.Curriculum.TRACK.sing;
const NAME = (m) => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][m % 12] + (Math.floor(m / 12) - 1);
// The app aims every answer at the voice's span, lo-2..lo+19 for lo = 45, 50, 57 (G2–E4, C3–A4,
// G3–E5), by moving a pattern up or down an octave when that keeps it closer (rangeBase in
// curriculum.js), and asks its melody generator again while a pattern would leave the span by
// more than a semitone. The bottoms here allow three semitones more and the tops one, so a pattern
// that no octave shift can bring within a semitone shows up here.
const RANGE = { low: [40, 65], mid: [45, 70], high: [52, 77] };
// only the notes meant for the voice: sung notes play on the organ and carry their degree; chords
// and progressions in a reveal are there for listening, and so is a color note's walk home
const sungNotes = (events) => events.filter((e) => e.timbre === 'organ' && e.deg && e.role !== 'resolution').flatMap((e) => e.notes);
let bad = 0;
const ext = {}, over = {};
for (const voice of ['low', 'mid', 'high']) {
  for (let L = 0; L < sing.levels.length; L++) {
    const lv = sing.levels[L];
    const k = `${voice} L${L + 1}`;
    for (let tonic = 55; tonic <= 66; tonic++) {
      for (let n = 0; n < 40; n++) {
        const item = TL.pick(lv.items);
        const q = sing.generate(L, { tonic, item, voice, practice: n % 2 === 0, fade: n % 3 === 0 });
        // an interval question's notes carry no degree: both of them are sung
        const sung = q.singRoot != null ? q.audio.reveal.flatMap((e) => e.notes) : sungNotes(q.audio.reveal);
        if (q.singRoot != null && (q.audio.reveal.length !== 2 || q.audio.reveal[0].notes[0] !== q.singRoot || q.audio.reveal[1].notes[0] !== q.singRoot + q.singSemi)) { bad++; console.log('interval reveal differs from what is graded', item); }
        for (const m of sung) {
          ext[k] = ext[k] || [99, 0];
          ext[k][0] = Math.min(ext[k][0], m); ext[k][1] = Math.max(ext[k][1], m);
          if (m < RANGE[voice][0] || m > RANGE[voice][1]) {
            bad++; over[k] = (over[k] || 0) + 1;
            if (bad <= 8) console.log('out of range', voice, 'L' + (L + 1), item, NAME(m), 'tonic', NAME(tonic));
          }
        }
        // only a scale-degree question names its note on screen before the answer
        if (lv.type !== 'degree' && q.deg) { bad++; console.log('question shows its answer', lv.name, item); }
        if (lv.type === 'tone' && (!q.toneAnswer || !q.chordRn || !q.chordTone)) { bad++; console.log('chord-tone question incomplete', item); }
        // a bass line answers with the line that was played: the same rises and falls
        if (lv.type === 'bassline') {
          const played = q.audio.main.filter((e) => e.slot != null).map((e) => e.notes[0]); // the progression's chords carry a slot; the four key-setting chords do not
          const dPlayed = played.slice(1).map((x, i) => x - played[i]), dAns = q.echoSemis.slice(1).map((x, i) => x - q.echoSemis[i]);
          if (JSON.stringify(dPlayed) !== JSON.stringify(dAns)) { bad++; console.log('bass line differs from what was played', dPlayed, dAns); }
        }
        if (L === 0) {
          const hasDo = q.audio.main.some((e) => e.timbre === 'organ' && e.deg === '1');
          if (q.practice !== hasDo) { bad++; console.log('practice/Do mismatch', q.practice, hasDo); }
          if (q.audio.reveal[0].dur !== 3.0) { bad++; console.log('reveal not 3s'); }
          if (!q.audio.parts.model) { bad++; console.log('no model'); }
        }
      }
    }
    try { sing.intro(L, { tonic: 60, voice }); } catch (e) { bad++; console.log('intro threw', k, e.message); }
  }
}
for (const [k, [lo, hi]] of Object.entries(ext)) {
  const [rlo, rhi] = RANGE[k.split(' ')[0]];
  const by = Math.max(rlo - lo, hi - rhi, 0);
  console.log(k.padEnd(9), `${NAME(lo)} – ${NAME(hi)}`.padEnd(10), by ? `over by ${by}, ${over[k]} notes` : '');
}
console.log(bad ? `${bad} problems` : 'sing OK');
process.exitCode = bad ? 1 : 0;
