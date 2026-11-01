'use strict';
// The app itself, run in Node (tone-ladder/app-harness/trace.mjs: a fake DOM, a recording stand-in for
// sound, a virtual clock): every view, every track page, a long daily session, Progress, Preferences
// and Explore, with no error anywhere; and on every path the trace drives, the claude.ai bundle of
// the modules does exactly what the modules do, step for step.
//   node tone-ladder/tests/app-check.js [path/to/static/tone-ladder]
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder'));
const trace = path.join(__dirname, '..', 'app-harness', 'trace.mjs');
let bad = 0;
const fail = (m) => { bad++; console.log(m); };
const run = (mode) => {
  const r = spawnSync(process.execPath, [trace, mode, dir], { encoding: 'utf8', env: { ...process.env, TZ: 'Australia/Melbourne' }, maxBuffer: 1 << 28 });
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  const errors = lines.filter((l) => /^\["(listener|timer|rejection|load|run)-error"/.test(l));
  errors.forEach((l) => fail(`${mode}: ${l.slice(0, 240)}`));
  if (r.status !== 0 && !errors.length) fail(`${mode}: the trace stopped: ${(r.stderr || '').split('\n').find((l) => /^\w*Error\b/.test(l)) || (r.stderr || '').split('\n')[0]}`);
  return { lines, stopped: r.status !== 0 };
};
const M = run('modules'), B = run('bundle');
// the rest compares what happened, which says little once a trace has stopped
if (!M.stopped && !B.stopped) {
  const steps = M.lines.filter((l) => l.startsWith('["step"'));
  if (steps.length < 40) fail(`only ${steps.length} steps ran: the session stopped early`);
  for (const want of ['"view music"', '"view prefs"', '"track sight"', '"summary"', '"explore"']) if (!steps.some((l) => l.includes(want))) fail(`the trace never reached ${want}`);
  // an error's location differs between the two builds; what it says does not
  const same = (l) => (/^\["(listener|timer|rejection)-error"/.test(l) ? l.split(' | ')[0] : l);
  const mods = M.lines.map(same), bund = B.lines.map(same);
  const i = mods.findIndex((l, k) => l !== bund[k]);
  if (i >= 0 && i < Math.min(mods.length, bund.length)) fail(`the bundle differs from the modules at line ${i + 1}: ${String(mods[i]).slice(0, 160)} | ${String(bund[i]).slice(0, 160)}`);
  else if (mods.length !== bund.length) fail(`the modules printed ${mods.length} lines and the bundle ${bund.length}`);
}
const steps = M.lines.filter((l) => l.startsWith('["step"'));
console.log(bad ? `${bad} problems` : `app OK (modules and bundle, ${steps.length} steps, ${M.lines.length} effects, no errors)`);
process.exitCode = bad ? 1 : 0;
