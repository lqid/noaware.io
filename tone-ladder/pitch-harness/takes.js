'use strict';
// Replays saved Sing answers ("Save this take" in the app) through a pitch.js, the way the app heard
// them, and compares the grade with what the learner said it should have been.
//   node takes.js [path/to/pitch.js] [take.wav | folder ...] [--verbose] [--json]
// Defaults: the app's static/tone-ladder/js/pitch.js and the takes/ folder beside this file.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const paths = args.filter((a) => !a.startsWith('--'));
const root = path.join(__dirname, '..', '..', 'static', 'tone-ladder', 'js');
const modPath = path.resolve(paths.find((p) => p.endsWith('.js')) || path.join(root, 'pitch.js'));
const P = require(modPath);
const Take = require(path.join(root, 'take.js'));

const inputs = paths.filter((p) => !p.endsWith('.js'));
const files = [];
for (const p of inputs.length ? inputs : [path.join(__dirname, 'takes')]) {
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort()) { if (f.toLowerCase().endsWith('.wav')) files.push(path.join(p, f)); }
  else files.push(p);
}
if (!files.length) {
  console.log('No takes found. Save one in the app (Sing, with the microphone on), then put the .wav in tone-ladder/pitch-harness/takes/.');
  process.exit(0);
}

const G = { 1: 'Matched', 0.5: 'Close', 0: 'Missed', null: 'none' };
const name = (v) => (v === undefined ? '?' : G[v]);
const rows = [];
for (const f of files) {
  let take;
  try { take = Take.decode(fs.readFileSync(f)); } catch (e) { rows.push({ file: path.basename(f), error: e.message }); continue; }
  const m = take.meta, q = m.question || {};
  const { result, doneAt } = Take.replay(P, take);
  const expect = m.learner ? m.learner.expect : undefined;
  const then = m.appGrade ? m.appGrade.v : undefined;
  // a take saved because nothing was heard is right once something gradable is heard
  const ok = m.learner && m.learner.said === 'not-heard' ? result.v != null : expect == null ? null : result.v === expect;
  rows.push({
    file: path.basename(f), level: q.levelName, kind: q.kind, target: q.target, sec: +(take.samples.length / take.rate).toFixed(1),
    said: m.learner && m.learner.said, expect, then, thenVersion: m.pitchVersion, now: result.v, reason: result.reason, doneAt: doneAt == null ? null : +doneAt.toFixed(2), ok,
    notes: (result.notes || []).map((n) => `${n.semi}${n.off >= 0 ? '+' : ''}${Math.round(n.off)}`).join(' '),
    steps: result.steps,
  });
}

if (flag('json')) { console.log(JSON.stringify({ module: modPath, version: P.version, rows }, null, 1)); process.exit(0); }
console.log(`pitch.js ${P.version || '(no version)'}: ${modPath}\n`);
for (const r of rows) {
  if (r.error) { console.log(`?? ${r.file}: ${r.error}`); continue; }
  const mark = r.ok === true ? '  ' : r.ok === false ? ' x' : ' ?';
  console.log(`${mark} ${r.file}`);
  console.log(`     ${r.level} (${r.kind}, target ${r.target.join(',')}), ${r.sec} s. Learner: ${r.said}${r.expect !== undefined && r.said !== 'not-heard' ? ` → ${name(r.expect)}` : ''}. App then (${r.thenVersion}): ${name(r.then)}. Now: ${name(r.now)} '${r.reason}'${r.doneAt != null ? `, done at ${r.doneAt} s` : ', never done'}.`);
  if (flag('verbose')) console.log(`     notes ${r.notes || '-'}${r.steps && r.steps.length ? ` | steps ${r.steps.map((s) => (s.ok ? s.want : `${s.want}→${s.got == null ? '-' : s.got}`)).join(' ')}` : ''}`);
}
const graded = rows.filter((r) => r.ok != null);
console.log(`\n${rows.length} takes; ${graded.filter((r) => r.ok).length} of ${graded.length} with a stated grade agree with it now.`);
