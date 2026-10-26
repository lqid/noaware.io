'use strict';
// Scores a pitch.js against synthetic singing.
//   node run.js <path/to/pitch.js> [--set=dev|holdout|final] [--only=<group prefix>] [--verbose] [--json]
//   node run.js --render [--set=...]     pre-render the audio cache
const fs = require('fs');
const path = require('path');
const { renderScene, rng } = require('./synth');
const C = require('./cases');

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const set = opt('set', 'dev');
const only = opt('only', '');
const verbose = flag('verbose');
const CACHE = process.env.TL_CACHE || path.join(__dirname, '.cache', set);
// grading rules and timings: see README.md
fs.mkdirSync(CACHE, { recursive: true });

function audioFor(key, scene) {
  const f = path.join(CACHE, key + '.f32');
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); }
  const a = renderScene(scene);
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  fs.renameSync(tmp, f);
  return a;
}
const sceneOf = (c) => ({ sr: c.sr, dur: c.dur, seed: c.seed, singer: c.singer, notes: c.notes, app: c.app, leakDb: c.leakDb, speakerHp: c.speakerHp, micHp: c.micHp, voiceDb: c.voiceDb, noise: c.noise, roomWet: c.roomWet, rt60: c.rt60 });

const cases = C.cases(set).filter((c) => !only || c.group.startsWith(only));
const frames = C.detectFrames(set);

if (flag('render')) {
  let n = 0;
  for (const c of cases) { audioFor(c.name, sceneOf(c)); n++; }
  frames.forEach((d, i) => audioFor('det-' + i, { seed: 5000 + i, ...d.scene }));
  console.log(`rendered ${n} scenes and ${frames.length} detector clips into ${CACHE}`);
  process.exit(0);
}

const modPath = path.resolve(args.find((a) => !a.startsWith('--')) || '');
const P = require(modPath);
const FRAME = 2048;
// the app's analyser holds about 43 ms at any rate
const frameFor = (sr) => Math.min(8192, Math.max(1024, 2 ** Math.round(Math.log2(sr * 0.043))));

// ---------- detector accuracy ----------
const det = { voiced: 0, gross: 0, octave: 0, miss: 0, abs: [], unvoiced: 0, falseVoiced: 0, ms: 0, calls: 0 };
frames.forEach((d, i) => {
  const a = audioFor('det-' + i, { seed: 5000 + i, ...d.scene });
  for (const t of d.at) {
    const end = Math.round(t * d.scene.sr);
    const fr = a.slice(end - FRAME, end);
    const t0 = process.hrtime.bigint();
    const res = P.detect(fr, d.scene.sr);
    det.ms += Number(process.hrtime.bigint() - t0) / 1e6; det.calls++;
    if (d.kind === 'voiced') {
      det.voiced++;
      if (!res || !(res.hz > 0)) { det.miss++; continue; }
      const err = 1200 * Math.log2(res.hz / d.hz);
      if (Math.abs(err) <= 50) det.abs.push(Math.abs(err));
      else { det.gross++; if (Math.abs(Math.abs(err) - 1200) <= 60 || Math.abs(Math.abs(err) - 2400) <= 60) det.octave++; }
    } else {
      det.unvoiced++;
      if (res && res.hz > 0) det.falseVoiced++;
    }
  }
});
det.abs.sort((x, y) => x - y);
const detSummary = {
  voicedFrames: det.voiced,
  missRate: +(det.miss / det.voiced).toFixed(4),
  grossRate: +(det.gross / det.voiced).toFixed(4),
  octaveErrors: det.octave,
  medianAbsCents: +(det.abs[Math.floor(det.abs.length / 2)] || 0).toFixed(2),
  p95AbsCents: +(det.abs[Math.floor(det.abs.length * 0.95)] || 0).toFixed(2),
  falseVoicedRate: +(det.falseVoiced / det.unvoiced).toFixed(4),
  detectMs: +(det.ms / det.calls).toFixed(3),
};

// ---------- grading ----------
const rows = [];
let pushMs = 0, pushes = 0;
for (const c of cases) {
  const a = audioFor(c.name, sceneOf(c));
  const sr = c.sr;
  const wins = c.app.map((tn) => [tn.t0, tn.t0 + tn.dur + (tn.timbre === 'organ' ? 0.12 : 0.25)]);
  const playing = (t) => wins.some(([x, y]) => t >= x && t <= y);
  const L = P.listener({ sampleRate: sr, doMidi: c.doMidi, kind: c.kind, target: c.target.slice() });
  const hr = rng(c.seed + 9);
  const FR = frameFor(sr);
  let i = FR, firstDone = null, doneWhilePlaying = false;
  const buf = new Float32Array(FR); // reused, as the app does
  while (i <= a.length) {
    const t = i / sr;
    buf.set(a.subarray(i - FR, i));
    const fr = buf;
    const ap = playing(t);
    const t0 = process.hrtime.bigint();
    L.push(fr, t, { appPlaying: ap });
    const st = L.status(t);
    pushMs += Number(process.hrtime.bigint() - t0) / 1e6; pushes++;
    if (st && st.done && firstDone == null) { firstDone = t; if (ap) doneWhilePlaying = true; }
    i += Math.round((0.015 + 0.02 * hr()) * sr);
  }
  const res = L.result() || {};
  const v = res.v === undefined ? null : res.v;
  const ok = v === c.expect;
  let severe = false;
  if (c.expect === 1 && v === 0) severe = true;
  if (c.expect === 0 && v === 1) severe = true;
  if (c.expect == null && v === 1) severe = true; // credited the app's own sound or noise
  if (c.expect == null && v === 0.5) severe = true;
  let doneIssue = null;
  if (c.noDone) { if (firstDone != null) doneIssue = 'spurious'; }
  else if (firstDone == null) doneIssue = 'never';
  else if (firstDone < c.earliestDone) doneIssue = 'early';
  else if (firstDone > c.latestDone) doneIssue = 'late';
  if (doneWhilePlaying) doneIssue = 'whilePlaying';
  rows.push({ name: c.name, group: c.group, expect: c.expect, v, ok, severe, reason: res.reason, doneIssue, firstDone: firstDone && +(firstDone - (c.singEnd || 0)).toFixed(2), target: c.target, sung: c.sung, steps: res.steps, notes: (res.notes || []).map((n) => `${n.semi}${n.off >= 0 ? '+' : ''}${Math.round(n.off)}`).join(' ') });
}

const groups = {};
for (const r of rows) { const g = groups[r.group] || (groups[r.group] = { n: 0, ok: 0, severe: 0, done: 0 }); g.n++; if (r.ok) g.ok++; if (r.severe) g.severe++; if (r.doneIssue) g.done++; }
const n = rows.length;
const summary = {
  set, cases: n,
  gradeAccuracy: +(rows.filter((r) => r.ok).length / n).toFixed(4),
  severe: rows.filter((r) => r.severe).length,
  doneIssues: rows.filter((r) => r.doneIssue).length,
  pushMs: +(pushMs / pushes).toFixed(3),
  detector: detSummary,
};
summary.score = +(100 * summary.gradeAccuracy - 300 * (summary.severe / n) - 50 * (summary.doneIssues / n) - 100 * Math.max(0, detSummary.grossRate - 0.02) - 100 * Math.max(0, detSummary.falseVoicedRate - 0.02) - 5 * Math.max(0, summary.pushMs - 1)).toFixed(2);

if (flag('json')) { console.log(JSON.stringify({ summary, groups, rows }, null, 1)); process.exit(0); }
console.log('group'.padEnd(20), 'n'.padStart(4), 'ok'.padStart(5), 'severe'.padStart(7), 'done!'.padStart(6));
for (const [g, s] of Object.entries(groups)) console.log(g.padEnd(20), String(s.n).padStart(4), String(s.ok).padStart(5), String(s.severe).padStart(7), String(s.done).padStart(6));
for (const r of rows) if (!r.ok || r.doneIssue || verbose) {
  console.log(`${r.ok ? '  ' : r.severe ? '!!' : ' x'} ${r.name.padEnd(22)} want ${String(r.expect).padEnd(4)} got ${String(r.v).padEnd(4)} ${String(r.reason || '').padEnd(8)} done:${r.doneIssue || 'ok'}(${r.firstDone}) target ${r.target.join(',')}${r.sung ? ' sung ' + r.sung.join(',') : ''} | ${r.notes}`);
}
console.log(JSON.stringify(summary, null, 1));
