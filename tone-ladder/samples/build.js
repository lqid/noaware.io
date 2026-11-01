'use strict';
// Turns a folder of recorded notes into a sample set the app can load.
//   node tone-ladder/samples/build.js <source folder> <piano|strings> [--out <dir>] [--release 0.4]
//        [--loop 1.0,2.5] [--source "Salamander Grand Piano by Alexander Holm"] [--licence "CC BY 3.0"]
// The source holds one WAV, AIFF or FLAC per note, named by the note: C2.wav, F#2.wav, Db3.aiff,
// A4.wav (middle C is C4). Each file is trimmed of leading silence, brought to full scale, mixed
// to mono and written as AAC (.m4a, 96 kbps) under a name that carries a hash of its bytes, so the
// service worker can keep it for ever. The encoded file is then decoded again and measured: where
// the sound starts (AAC adds a few milliseconds), how loud it is (so notes sit level), and how far
// from equal temperament it sits (so the app can correct the rate). A note more than 30 cents off
// is refused as mislabelled. The manifest the app reads: { name, release, source, licence,
// notes: [{ midi, file, onset, gain, cents, loop? }] }. Needs ffmpeg (brew install ffmpeg).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'F#2' → 42; null when the name is not a note
const midiOf = (name) => {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name));
  return m ? (+m[3] + 1) * 12 + LETTER[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null;
};
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const TARGET_RMS = 0.12, FLOOR = 10 ** (-60 / 20), MAX_CENTS = 30;

// What the app needs to know about a decoded note (mono float samples at sr): where it starts,
// a gain that brings its first half second to the target loudness, and its tuning against the
// labelled note, from the autocorrelation of a window on its steady part.
function measure(d, sr, midi) {
  // the start: where the sound first reaches 24 dB under its own peak, stepped back to the foot of
  // that rise (AAC's faint pre-echo, 30 dB and more under the attack, would otherwise count as the start)
  let peak = 0;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
  if (peak < FLOOR) return { error: 'silent' };
  const thr = peak * 10 ** (-24 / 20);
  let onset = 0;
  while (onset < d.length && Math.abs(d[onset]) < thr) onset++;
  while (onset > 0 && Math.abs(d[onset - 1]) > thr / 8 && d[onset - 1] * d[onset] > 0) onset--;
  const w0 = onset, w1 = Math.min(d.length, onset + Math.round(sr * 0.5));
  let sum = 0;
  for (let i = w0; i < w1; i++) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / Math.max(1, w1 - w0));
  const gain = Math.min(4, Math.max(0.25, TARGET_RMS / (rms || 1e-6)));
  // the tuning: a window after the attack, the lag nearest the labelled period, refined between samples
  const f0 = mtof(midi), p0 = sr / f0;
  const start = Math.min(d.length - 1, onset + Math.round(sr * 0.15)), len = Math.min(Math.round(sr * 0.1) + Math.ceil(p0 * 4), d.length - start - Math.ceil(p0 * 1.5));
  if (len < Math.round(sr * 0.1)) return { onset: onset / sr, gain, cents: 0, short: true }; // under a tenth of a second of steady tone: too short to hear its tuning
  const ac = (lag) => { let s = 0; for (let i = start; i < start + len; i++) s += d[i] * d[i + lag]; return s; };
  // A sound repeats at every multiple of its period, so a note an octave above its name also peaks
  // at the named period. Look down to two octaves above for the shortest lag that repeats as well
  // as the best one; if it is shorter than the named period, the file holds a higher note.
  {
    const lo = Math.max(2, Math.floor(p0 / 4.2)), hi = Math.ceil(p0 * 1.06), v = [];
    for (let lag = lo; lag <= hi + 1; lag++) v.push(ac(lag));
    const top = Math.max(...v);
    for (let i = 1; i < v.length - 1; i++) {
      if (v[i] > v[i - 1] && v[i] >= v[i + 1] && v[i] >= 0.8 * top) {
        if (lo + i < p0 / 1.06) return { error: 'sounds an octave or more above its name' };
        break;
      }
    }
  }
  let best = -1, bestV = -Infinity;
  for (let lag = Math.floor(p0 / 1.06); lag <= Math.ceil(p0 * 1.06); lag++) { const v = ac(lag); if (v > bestV) { bestV = v; best = lag; } }
  let lag = best;
  if (best > 1) { const a = ac(best - 1), b = bestV, c = ac(best + 1); const den = a - 2 * b + c; if (den < 0) lag = best + (0.5 * (a - c)) / den; }
  const cents = 1200 * Math.log2(sr / lag / f0);
  return { onset: onset / sr, gain: +gain.toFixed(3), cents: +cents.toFixed(1) };
}

const has = (cmd) => spawnSync('which', [cmd]).status === 0;
function run(args, opts = {}) { return spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { maxBuffer: 1 << 28, ...opts }); }
// one note: trim, normalise, encode, hash, decode again and measure
function encodeNote(srcFile, midi, outDir) {
  const probe = spawnSync('ffmpeg', ['-nostats', '-loglevel', 'info', '-i', srcFile, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const mv = /max_volume:\s*(-?[\d.]+) dB/.exec(probe.stderr || '');
  const lift = mv ? -parseFloat(mv[1]) - 0.5 : 0; // to half a decibel under full scale
  const tmp = path.join(outDir, `tmp-${midi}.m4a`);
  // lifted first, so the trim's threshold is relative to full scale
  const enc = run(['-i', srcFile, '-af', `volume=${lift.toFixed(2)}dB,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01`, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp]);
  if (enc.status !== 0) return { error: (enc.stderr || '').toString().trim() || 'encode failed' };
  const bytes = fs.readFileSync(tmp);
  const file = `${midi}-${crypto.createHash('md5').update(bytes).digest('hex').slice(0, 8)}.m4a`;
  fs.renameSync(tmp, path.join(outDir, file));
  const dec = run(['-i', path.join(outDir, file), '-f', 'f32le', '-ac', '1', '-ar', '44100', '-']);
  if (dec.status !== 0) return { error: 'decode failed' };
  const d = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, Math.floor(dec.stdout.length / 4));
  return { file, ...measure(d, 44100, midi) };
}
function build(src, setName, { out, release, loop, source, licence, log = () => {} }) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (/\.m4a$/.test(f)) fs.unlinkSync(path.join(out, f)); // the set is rebuilt whole
  const notes = [], refused = [];
  for (const f of fs.readdirSync(src).sort()) {
    if (!/\.(wav|aiff?|flac)$/i.test(f)) continue;
    const midi = midiOf(f.replace(/\.[^.]+$/, ''));
    if (midi == null) { log(`skipped (the name is not a note): ${f}`); continue; }
    const r = encodeNote(path.join(src, f), midi, out);
    if (r.error) { log(`failed: ${f} ${r.error}`); if (r.file) fs.unlinkSync(path.join(out, r.file)); refused.push(f); continue; }
    if (Math.abs(r.cents) > MAX_CENTS) { log(`refused: ${f} is ${r.cents} cents from ${f.replace(/\.[^.]+$/, '')} (mislabelled?)`); fs.unlinkSync(path.join(out, r.file)); refused.push(f); continue; }
    if (r.short) { log(`refused: ${f} is too short to measure its tuning (under a third of a second of tone)`); fs.unlinkSync(path.join(out, r.file)); refused.push(f); continue; }
    const note = { midi, file: r.file, onset: +r.onset.toFixed(4), gain: r.gain, cents: r.cents };
    if (loop) note.loop = loop;
    notes.push(note);
    log(`${f.padEnd(12)} → ${r.file}  onset ${Math.round(r.onset * 1000)} ms, gain ${r.gain}, ${r.cents >= 0 ? '+' : ''}${r.cents} cents`);
  }
  notes.sort((a, b) => a.midi - b.midi);
  const manifest = { name: setName, release, source, licence, notes };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, refused };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const src = args[0], setName = args[1];
  const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
  if (!src || !['piano', 'strings'].includes(setName)) {
    console.log('usage: node tone-ladder/samples/build.js <source folder> <piano|strings> [--out <dir>] [--release 0.4] [--loop 1.0,2.5] [--source "..."] [--licence "..."]');
    process.exit(1);
  }
  if (!has('ffmpeg')) { console.log('needs ffmpeg on the PATH (brew install ffmpeg)'); process.exit(1); }
  const out = opt('out', path.join(__dirname, '..', '..', 'static', 'tone-ladder', 'samples', setName));
  const r = build(src, setName, {
    out, release: +opt('release', setName === 'strings' ? 0.5 : 0.35), loop: opt('loop', null) ? opt('loop').split(',').map(Number) : null,
    source: opt('source', ''), licence: opt('licence', ''), log: console.log,
  });
  console.log(`${r.manifest.notes.length} notes → ${path.relative(process.cwd(), out)}/manifest.json${r.refused.length ? `, ${r.refused.length} refused` : ''}`);
  process.exitCode = r.manifest.notes.length ? 0 : 1;
}
module.exports = { midiOf, measure, build, has };
