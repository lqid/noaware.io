'use strict';
// Every item a level introduces turns up in its questions, and not rarely.
//   node tone-ladder/tests/coverage-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
for (const f of ['theory.js', 'curriculum.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL;
let bad = 0;
for (const tr of TL.Curriculum.TRACKS) {
  if (tr.picksItem) continue; // the store picks these items itself, so the generator cannot miss one
  tr.levels.forEach((lv, L) => {
    const seen = {};
    for (let n = 0; n < 300; n++) {
      const q = tr.generate(L, { tonic: 60, withContext: true });
      for (const s of q.stats) seen[s] = (seen[s] || 0) + 1;
    }
    // a rhythm level's card lists every cell, so every cell must be able to come up
    const expect = tr.id === 'rhythm' ? lv.cells : (lv.introduce || []);
    const missing = expect.filter((x) => !seen[x]);
    const rare = (lv.introduce || []).filter((x) => seen[x] && seen[x] < 30);
    if (missing.length || rare.length) { bad++; console.log(tr.id, 'L' + (L + 1), 'missing', missing, 'rare', rare.map((x) => x + ':' + seen[x])); }
  });
}
// A mode's vamp uses only its own notes (minor's V7 raises Ti on purpose), and its walks home do too.
for (const [mode, chords] of Object.entries(TL.CADENCE)) {
  const scale = new Set(TL.MODE_SCALE[mode].map((id) => TL.DEG[id].semi));
  if (mode === 'minor') scale.add(11);
  const out = chords.flat().filter((x) => !scale.has(TL.mod12(x)));
  if (out.length) { bad++; console.log('cadence', mode, 'leaves the mode:', out); }
  let par = 0;
  for (let i = 1; i < chords.length; i++) par += TL.parallels(chords[i - 1].map((x) => 60 + x), chords[i].map((x) => 60 + x));
  if (par) { bad++; console.log('cadence', mode, 'has parallels:', par); }
}
TL.Curriculum.TRACK.degrees.levels.forEach((lv, L) => {
  if (lv.type === 'mode') return;
  const mode = lv.mode || 'major';
  const allowed = new Set([...TL.MODE_SCALE[mode], ...lv.items]);
  for (const it of lv.items) {
    const foreign = TL.resolutionPath(TL.DEG[it].semi, mode).map((x) => TL.degBySemi(x).id).filter((id) => !allowed.has(id));
    if (foreign.length) { bad++; console.log('degrees L' + (L + 1), it, 'walks home through', foreign.join(' '), 'which', mode, 'lacks'); }
  }
});
console.log(bad ? `${bad} levels with coverage issues` : 'coverage OK');
process.exitCode = bad ? 1 : 0;
