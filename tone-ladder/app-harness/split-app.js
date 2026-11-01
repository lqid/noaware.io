'use strict';
// Splits the single-file app (js/app.js as of b1d424d) into the ES modules in js/app/: each module
// is the original lines, moved byte for byte with their indentation, plus computed imports and an
// export list. Four lines are edited (the two places that set the running session go through setR,
// and go() disarms the reset through disarmReset), those two functions are added, and each screen's
// entries of the action table move into a <name>Actions table that main.js spreads into ACT. It also
// points index.html and sw.js at the modules. Run once; kept so the split can be checked by
// regenerating it.
//   node tone-ladder/app-harness/split-app.js            split js/app.js into js/app/
//   node tone-ladder/app-harness/split-app.js --verify   regenerate from b1d424d into a temp folder and
//                                                        compare with js/app/ as the split committed it
//                                                        (52f93e9; prints nothing when equal)
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { tokenize } = require('../tests/js-tokens.js');
const ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'static', 'tone-ladder');
const BASE_REV = 'b1d424d';
const SPLIT_REV = '52f93e9'; // the commit of the split: js/app/ has changed since, as the app has
const verify = process.argv.includes('--verify');
const SRC = verify ? null : path.join(APP, 'js', 'app.js');
const OUT = verify ? fs.mkdtempSync(path.join(os.tmpdir(), 'tl-split-')) : path.join(APP, 'js', 'app');
const src = verify ? execFileSync('git', ['show', `${BASE_REV}:static/tone-ladder/js/app.js`], { cwd: ROOT, encoding: 'utf8' }) : fs.readFileSync(SRC, 'utf8');
const lines = src.split('\n');
const L = (n) => lines[n - 1];

const MAP = {
  'base.js': { about: 'shared names, formatting, the DOM helpers, sound settings, wake lock, item names, device info', r: [[4, 51], [54, 71], [75, 104], [652, 656], [914, 915], [1443, 1445]] },
  'state.js': { about: 'the shared mutable state: the view, and the running session (assigned only through setR)', r: [[72, 73]] },
  'plan.js': { about: 'the daily plan', r: [[106, 156]] },
  'today.js': { about: 'the Today view', r: [[158, 355], [1442, 1442], [1446, 1450], [3138, 3143], [3193, 3193], [3321, 3321]] },
  'track.js': { about: 'a track\'s page: its levels and accuracy', r: [[357, 428], [3144, 3155]] },
  'session.js': { about: 'the session runner: sets, questions, keys, playback, scoring, the end of a session', r: [[430, 651], [657, 712], [1418, 1441], [1451, 1456], [3165, 3165], [3171, 3192], [3194, 3207], [3282, 3289]] },
  'answer.js': { about: 'answering choice, sequence and sing questions', r: [[714, 855], [3166, 3170], [3208, 3210], [3227, 3228]] },
  'midi.js': { about: 'a MIDI keyboard', r: [[857, 905], [3264, 3265]] },
  'mic.js': { about: 'the microphone: the gate, the listener, grading, pause and resume, copying, takes', r: [[907, 913], [916, 1152], [1159, 1253], [3211, 3224], [3266, 3278]] },
  'rhythm.js': { about: 'rhythm questions: timing, tapping, clapping, and their rendering', r: [[1255, 1416], [2192, 2300], [3280, 3281]] },
  'session-view.js': { about: 'the session screen: header, stage, the question frame, introductions, between sets, the summary', r: [[1458, 1535], [2301, 2403]] },
  'answer-view.js': { about: 'answer inputs (ladder, piano, staff), choice and sequence bodies, feedback, the answer on a staff', r: [[1536, 1840]] },
  'sing-view.js': { about: 'sing questions on screen: target, staff, grades, takes, the microphone panels and results', r: [[1841, 2191]] },
  'explore.js': { about: 'Explore', r: [[2405, 2416], [2626, 2696], [3292, 3312]] },
  'your-music.js': { about: 'the Music view: a recording of the learner\'s own', r: [[2417, 2625], [3229, 3263]] },
  'progress.js': { about: 'Progress', r: [[2698, 2794], [3290, 3291]] },
  'method.js': { about: 'Method', r: [[2796, 2843]] },
  'prefs.js': { about: 'Preferences: settings, the microphone tools, calibration, moving progress, reset', r: [[2845, 3091], [3157, 3164], [3225, 3226], [3279, 3279], [3313, 3319], [3322, 3364]] },
  'router.js': { about: 'routing and rendering the current view', r: [[3093, 3124]] },
  'main.js': { about: 'the entry: hooks into the audio module, the action table, document events, boot', r: [[52, 53], [1153, 1158], [3126, 3137], [3156, 3156], [3320, 3320], [3365, 3544]] },
};
const ACT_IN = (a, b) => a >= 3137 && b <= 3364;
const modOf = new Map();
for (const [m, { r }] of Object.entries(MAP)) for (const [a, b] of r) for (let l = a; l <= b; l++) { if (modOf.has(l)) throw new Error('overlap ' + l); modOf.set(l, m); }
for (let l = 4; l < lines.length - 1; l++) if (lines[l - 1].trim() && !modOf.has(l)) throw new Error(`line ${l} is placed in no module: ${lines[l - 1]}`);
if (L(1).indexOf('/* Tone Ladder') !== 0 || L(2) !== '(function () {' || L(3) !== "  'use strict';" || L(lines.length - 1) !== '})();') throw new Error('the wrapper is not where it was');

// edits by original line: [line, expected, replacement]
const EDITS = [
  [438, '    R = {', '    setR({'],
  [442, '    };', '    });'],
  [1454, '    R = null;', '    setR(null);'],
  [3102, '    resetArmed = false;', '    disarmReset();'],
];
const text = new Map(lines.map((s, i) => [i + 1, s]));
for (const [n, old, nu] of EDITS) { if (L(n) !== old) throw new Error(`edit at ${n}: expected ${JSON.stringify(old)}, found ${JSON.stringify(L(n))}`); text.set(n, nu); }
const INSERT_AFTER = { 2848: ['  function disarmReset() { resetArmed = false; } // go() leaves the reset unarmed'] };

// top-level names and references (as in analyse.js)
const toks = tokenize(src).filter((t) => t.t !== 'cmt');
let depth = 0, bodyDepth = null; const top = new Map();
for (let k = 0; k < toks.length; k++) {
  const t = toks[k];
  if (t.t === 'p' && '([{'.includes(t.v)) { depth++; if (bodyDepth === null && t.v === '{') bodyDepth = depth; continue; }
  if (t.t === 'p' && ')]}'.includes(t.v)) { depth--; continue; }
  if (bodyDepth === null || depth !== bodyDepth || t.t !== 'id') continue;
  if (t.v === 'function' && toks[k + 1].t === 'id') top.set(toks[k + 1].v, toks[k + 1].line);
  if (t.v === 'const' || t.v === 'let') {
    let j = k + 1, d = 0, expect = true;
    for (; j < toks.length; j++) {
      const u = toks[j];
      if (u.t === 'p' && '([{'.includes(u.v)) {
        if (expect && u.v === '{' && d === 0) { let q = j + 1, dd = 1; for (; dd > 0; q++) { const w = toks[q]; if (w.t === 'p' && '([{'.includes(w.v)) dd++; else if (w.t === 'p' && ')]}'.includes(w.v)) dd--; else if (w.t === 'id' && dd === 1 && toks[q + 1].v !== ':') top.set(w.v, w.line); } j = q - 1; expect = false; continue; }
        d++; continue;
      }
      if (u.t === 'p' && ')]}'.includes(u.v)) { d--; if (d < 0) break; continue; }
      if (d === 0 && u.v === ';') break;
      if (d === 0 && u.v === ',') { expect = true; continue; }
      if (expect && u.t === 'id') { top.set(u.v, u.line); expect = false; }
    }
  }
}
top.delete('ACT'); top.set('ACT', 3136);
const owner = (nm) => (nm === 'ACT' ? 'main.js' : modOf.get(top.get(nm)));
const need = {};
for (let k = 0; k < toks.length; k++) {
  const t = toks[k];
  if (t.t !== 'id' || !top.has(t.v)) continue;
  const p = toks[k - 1], nx = toks[k + 1];
  if (p && p.t === 'p' && (p.v === '.' || p.v === '?.')) continue;
  if (nx && nx.t === 'p' && nx.v === ':' && p && p.t === 'p' && (p.v === '{' || p.v === ',')) continue;
  const m = modOf.get(t.line); const o = owner(t.v);
  if (!m || o === m) continue;
  if (t.v === 'h') continue; // boot's local in main.js; every other h is a local
  if (m === 'mic.js' && t.v === 'go') continue; // micResume's own go
  if (t.v === 'resetArmed' && m === 'router.js') continue; // replaced by disarmReset()
  ((need[m] ||= {})[o] ||= new Set()).add(t.v);
}
((need['session.js'] ||= {})['state.js'] ||= new Set()).add('setR');
((need['router.js'] ||= {})['prefs.js'] ||= new Set()).add('disarmReset');
const ACTNAME = (m) => m.replace('.js', '').replace(/-(\w)/g, (_, c) => c.toUpperCase()) + 'Actions';
const exportsOf = {};
for (const m of Object.keys(need)) for (const [o, s] of Object.entries(need[m])) s.forEach((x) => (exportsOf[o] ||= new Set()).add(x));
(exportsOf['state.js'] ||= new Set()).add('setR');
// action tables
const actMods = Object.keys(MAP).filter((m) => m !== 'main.js' && MAP[m].r.some(([a, b]) => ACT_IN(a, b)));
for (const m of actMods) { (exportsOf[m] ||= new Set()).add(ACTNAME(m)); ((need['main.js'] ||= {})[m] ||= new Set()).add(ACTNAME(m)); }

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
const ORDER = (a, b) => { const w = (x) => (x === 'base.js' ? 0 : x === 'state.js' ? 1 : 2); return w(a) - w(b) || a.localeCompare(b); };
let total = 0;
for (const [m, { about, r }] of Object.entries(MAP)) {
  const out = [`/* Tone Ladder — ${about}. */`];
  for (const o of Object.keys(need[m] || {}).sort(ORDER)) out.push(`import { ${[...need[m][o]].sort().join(', ')} } from './${o}';`);
  out.push('');
  const body = r.filter(([a, b]) => !ACT_IN(a, b) || m === 'main.js');
  const acts = r.filter(([a, b]) => ACT_IN(a, b) && m !== 'main.js');
  let last = null;
  const emit = (a, b) => {
    if (last !== null && a !== last + 1 && out[out.length - 1] !== '') out.push('');
    for (let l = a; l <= b; l++) {
      if (m === 'main.js' && l === 3365) for (const am of actMods) out.push(`    ...${ACTNAME(am)},`);
      out.push(text.get(l));
      if (INSERT_AFTER[l]) out.push(...INSERT_AFTER[l]);
    }
    last = b;
  };
  for (const [a, b] of body) emit(a, b);
  if (m === 'state.js') out.push('  function setR(v) { R = v; } // only the session runner starts and ends a session');
  if (acts.length) {
    if (out[out.length - 1] !== '') out.push('');
    out.push(`  // this screen's part of the action table (data-act), merged in main.js`);
    out.push(`  const ${ACTNAME(m)} = {`);
    last = null;
    for (const [a, b] of acts) for (let l = a; l <= b; l++) out.push(text.get(l));
    out.push('  };');
  }
  while (out[out.length - 1] === '') out.pop();
  const ex = [...(exportsOf[m] || [])].sort();
  if (ex.length) { out.push(''); out.push(`export { ${ex.join(', ')} };`); }
  out.push('');
  fs.writeFileSync(path.join(OUT, m), out.join('\n'));
  total += out.length;
  if (!verify) console.log(m.padEnd(16), String(out.length).padStart(4), 'lines; imports from', Object.keys(need[m] || {}).length, 'modules; exports', ex.length);
}
if (verify) {
  // the modules as the split committed them must be exactly what the split produces
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const committed = git('ls-tree', '--name-only', `${SPLIT_REV}:static/tone-ladder/js/app/`).split('\n').filter(Boolean);
  const names = new Set([...committed, ...fs.readdirSync(OUT)]);
  let diff = 0;
  for (const f of [...names].sort()) {
    const a = committed.includes(f) ? git('show', `${SPLIT_REV}:static/tone-ladder/js/app/${f}`) : null;
    const b = fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), 'utf8') : null;
    if (a !== b) { diff++; console.log(`differs: js/app/${f}${a === null ? ' (not in the split commit)' : b === null ? ' (not produced)' : ''}`); }
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exitCode = diff ? 1 : 0;
} else {
  console.log('total', total);
  // the page loads the entry module, with the whole graph preloaded; the worker keeps every module
  const edit = (file, pairs) => {
    let s = fs.readFileSync(file, 'utf8');
    for (const [a, b] of pairs) { if (s.split(a).length !== 2) throw new Error(`${path.basename(file)}: expected once: ${a}`); s = s.replace(a, b); }
    fs.writeFileSync(file, s);
  };
  const order = moduleOrder();
  edit(path.join(APP, 'index.html'), [
    ['<script src="js/app.js"></script>', '<script src="js/start-guard.js"></script>\n<script type="module" src="js/app/main.js"></script>'],
    ['(registered by app.js)', '(registered by js/app/main.js)'],
    ['<link rel="stylesheet" href="studio.css">', '<link rel="stylesheet" href="studio.css">\n<!-- The app is a set of ES modules (js/app/); preloading them fetches the whole graph at once.\n     tone-ladder/tests/modules-check.js keeps this list equal to the import graph. -->\n' + order.map((m) => `<link rel="modulepreload" href="js/app/${m}">`).join('\n')],
  ]);
  edit(path.join(APP, 'sw.js'), [
    ["'js/notation.js', 'js/music.js', 'js/app.js',", "'js/notation.js', 'js/music.js', 'js/start-guard.js',\n  " + order.map((m) => `'js/app/${m}'`).join(', ') + ','],
  ]);
  fs.unlinkSync(SRC);
}
// the modules in evaluation order: a depth-first walk from main.js over the imports, in source order
function moduleOrder() {
  const seen = new Set(), out = [];
  const visit = (m) => {
    if (seen.has(m)) return;
    seen.add(m);
    const s = fs.readFileSync(path.join(OUT, m), 'utf8');
    for (const x of s.matchAll(/^import \{[^}]*\} from '\.\/([\w-]+\.js)';$/gm)) visit(x[1]);
    out.push(m);
  };
  visit('main.js');
  return out;
}
