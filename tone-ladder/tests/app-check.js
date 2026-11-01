'use strict';
// The app itself, run in Node (tone-ladder/app-harness/trace.mjs: a fake DOM, a recording stand-in for
// sound, a virtual clock): every view, every track page, a long daily session, Progress, Preferences
// and Explore, with no error anywhere; and the claude.ai bundle of the modules does exactly what the
// modules do, step for step.
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
  if (r.status !== 0) {
    const why = lines.find((l) => /^\["(load-error|run-error)"/.test(l));
    fail(`${mode}: the trace stopped: ${why ? why.slice(0, 240) : (r.stderr || '').split('\n').slice(0, 3).join(' | ')}`);
  }
  return lines;
};
const mods = run('modules'), bund = run('bundle');
for (const [name, lines] of [['modules', mods], ['bundle', bund]]) {
  for (const l of lines) if (/^\["(listener-error|timer-error|load-error|run-error)"/.test(l)) fail(`${name}: ${l.slice(0, 240)}`);
}
const steps = mods.filter((l) => l.startsWith('["step"'));
if (steps.length < 40) fail(`only ${steps.length} steps ran: the session stopped early`);
for (const want of ['"view music"', '"view prefs"', '"track sight"', '"summary"', '"explore"']) if (!steps.some((l) => l.includes(want))) fail(`the trace never reached ${want}`);
if (mods.length !== bund.length || mods.some((l, i) => l !== bund[i])) {
  const i = mods.findIndex((l, k) => l !== bund[k]);
  if (i < 0) fail(`the modules printed ${mods.length} lines and the bundle ${bund.length}`);
  else fail(`the bundle differs from the modules at line ${i + 1}: ${String(mods[i]).slice(0, 160)} | ${String(bund[i]).slice(0, 160)}`);
}
console.log(bad ? `${bad} problems` : `app OK (modules and bundle, ${steps.length} steps, ${mods.length} effects, no errors)`);
process.exitCode = bad ? 1 : 0;
