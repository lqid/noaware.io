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
    const missing = (lv.introduce || []).filter((x) => !seen[x]);
    const rare = (lv.introduce || []).filter((x) => seen[x] && seen[x] < 30);
    if (missing.length || rare.length) { bad++; console.log(tr.id, 'L' + (L + 1), 'missing', missing, 'rare', rare.map((x) => x + ':' + seen[x])); }
  });
}
console.log(bad ? `${bad} levels with coverage issues` : 'coverage OK');
process.exitCode = bad ? 1 : 0;
