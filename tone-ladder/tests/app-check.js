'use strict';
// The app itself, run in Node (tone-ladder/app-harness/trace.mjs: a fake DOM, a recording stand-in for
// sound, a virtual clock): every view, every track page, a long daily session, Progress (and its
// week-by-week charts for every track, over twelve weeks of history with a step back after a new
// level and a finished track), Preferences and Explore, with no error anywhere, no chart drawing a
// missing number and no chart line across a new level, a step back after finishing a track called
// one, and an answer while the question still sounds timed at nothing (one after a replayed part
// of it not timed); and on every path the trace drives, the claude.ai bundle of the modules does
// exactly what the modules do, step for step.
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
  for (const want of ['"view music"', '"view prefs"', '"track sight"', '"summary"', '"progress weeks"', '"explore"']) if (!steps.some((l) => l.includes(want))) fail(`the trace never reached ${want}`);
  // the week-by-week charts draw numbers, never a missing one
  const charts = M.lines.filter((l) => l.startsWith('["html"')).map((l) => JSON.parse(l)[2]).filter((h) => typeof h === 'string' && h.includes('<svg class="chart"'));
  if (!charts.some((h) => h.includes('class="dot"'))) fail('no week-by-week chart drew a point');
  // and the history reaches each kind of chart and sentence: all eight tracks, a step back after a
  // new level, a finished track
  for (const t of ['Scale Degrees', 'Intervals', 'Chord Qualities', 'Harmony', 'Melodic Dictation', 'Rhythm', 'Sing', 'Sight-Singing']) if (!charts.some((h) => h.includes(`aria-label="Accuracy in ${t},`))) fail(`no accuracy chart for ${t}`);
  for (const want of ['Answer speed in Harmony', 'Intonation in Sight-Singing', 'and a new level is harder.', 'You finished the track on', '>Done</text>', '<td>Finished</td>', 'Times are kept from', 'A week shows here once it has 20 answers']) if (!charts.some((h) => h.includes(want))) fail(`the week-by-week charts never showed: ${want}`);
  // a line never runs across a new level: no level mark inside a segment, or on its right-hand dot
  for (const svg of charts.flatMap((h) => h.split('<svg class="chart"').slice(1))) {
    const marks = [...svg.matchAll(/<line class="lvl" x1="([\d.]+)"/g)].map((x) => +x[1]);
    for (const x of svg.matchAll(/<path class="(?:line|gap)" d="M([\d.]+),[\d.]+ L([\d.]+),/g)) {
      if (marks.some((mx) => mx > +x[1] + 1e-6 && mx <= +x[2] + 1e-6)) { fail(`a chart line runs across a new level: ${svg.match(/aria-label="([^"]*)"/)[1]}`); break; }
    }
  }
  // finishing a track is not a new level: a step back after it is called one
  if (charts.some((h) => /You finished the track on [^.<]*, and /.test(h))) fail('a step back after finishing a track was put down to a new level');
  if (!charts.some((h) => /Down from \d+% the 7 days before\. You finished the track on/.test(h))) fail('no step back after finishing a track was called one');
  const broken = charts.find((h) => /NaN|undefined|Infinity/.test(h));
  if (broken) fail(`a chart drew a missing number: ${broken.match(/.{0,80}(NaN|undefined|Infinity).{0,40}/)[0]}`);
  // an error's location differs between the two builds; what it says does not
  const same = (l) => (/^\["(listener|timer|rejection)-error"/.test(l) ? l.split(' | ')[0] : l);
  const mods = M.lines.map(same), bund = B.lines.map(same);
  const i = mods.findIndex((l, k) => l !== bund[k]);
  if (i >= 0 && i < Math.min(mods.length, bund.length)) fail(`the bundle differs from the modules at line ${i + 1}: ${String(mods[i]).slice(0, 160)} | ${String(bund[i]).slice(0, 160)}`);
  else if (mods.length !== bund.length) fail(`the modules printed ${mods.length} lines and the bundle ${bund.length}`);
}
// an answer while the question still sounds counts toward the day's times at no time; one after a
// part of the question was replayed over it does not count
if (!M.stopped) {
  const soon = M.lines.filter((l) => l.startsWith('["soon"')).map((l) => JSON.parse(l));
  const s1 = soon.find((x) => x[1] === 1), s4 = soon.find((x) => x[1] === 4);
  if (!s1 || !s4) fail('the trace never answered while the question still sounded');
  else {
    if (!(s1[4][0] === s1[3][0] + 1 && s1[4][1] === s1[3][1])) fail(`an answer during the sound was not counted at no time: ${JSON.stringify(s1)}`);
    if (JSON.stringify(s4[4]) !== JSON.stringify(s4[3])) fail(`an answer after a replayed part was counted as during the sound: ${JSON.stringify(s4)}`);
  }
}
const steps = M.lines.filter((l) => l.startsWith('["step"'));
console.log(bad ? `${bad} problems` : `app OK (modules and bundle, ${steps.length} steps, ${M.lines.length} effects, no errors)`);
process.exitCode = bad ? 1 : 0;
