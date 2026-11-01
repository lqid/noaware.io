'use strict';
// Recorded instruments: the build script reads note names, measures a note's start, loudness and
// tuning, and (where ffmpeg is on the PATH) turns a folder of notes into a set the app can load.
//   node tone-ladder/tests/sampler-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), os = require('os');
const B = require(path.join(__dirname, '..', 'samples', 'build.js'));
let bad = 0;
const fail = (m) => { bad++; console.log(m); };

for (const [name, midi] of [['C4', 60], ['c4', 60], ['F#2', 42], ['Db3', 49], ['A4', 69], ['B-1', 11], ['H3', null], ['C', null], ['C#', null], ['Cb4', 59]]) {
  if (B.midiOf(name) !== midi) fail(`midiOf(${name}) = ${B.midiOf(name)}, not ${midi}`);
}

// a note with a known start, level and tuning
const sr = 44100;
function tone(midi, cents, lead, amp, secs = 1.2) {
  const f = 440 * 2 ** ((midi - 69 + cents / 100) / 12), d = new Float32Array(Math.round(sr * secs));
  for (let i = Math.round(sr * lead); i < d.length; i++) { const t = i / sr - lead; d[i] = amp * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 0.6); }
  return d;
}
let m = B.measure(tone(69, 12, 0.05, 0.4), sr, 69);
if (Math.abs(m.onset - 0.05) > 0.002) fail('onset ' + m.onset);
if (Math.abs(m.cents - 12) > 2) fail('cents ' + m.cents);
if (!(m.gain > 0.25 && m.gain < 1)) fail('gain ' + m.gain);
m = B.measure(tone(40, -20, 0, 0.1), sr, 40);
if (Math.abs(m.cents + 20) > 3) fail('low note cents ' + m.cents);
if (!(m.gain > 1)) fail('quiet note not lifted: ' + m.gain);
if (!B.measure(new Float32Array(1000), sr, 60).error) fail('silence not refused');
if (!B.measure(tone(60, 0, 0, 0.3, 0.2), sr, 60).short) fail('a short note not reported as short');
// AAC's pre-echo must not count as the start: a note with noise before it at about 34 dB under its
// peak, well above the old -60 dBFS floor
const pre = tone(69, 0, 0.1, 0.4); for (let i = 0; i < Math.round(sr * 0.1); i++) pre[i] = (Math.random() - 0.5) * 0.02;
m = B.measure(pre, sr, 69);
if (Math.abs(m.onset - 0.1) > 0.003) fail('onset with pre-echo ' + m.onset);
// a note an octave or two above its name is refused, a low note with a weak fundamental is not
if (!B.measure(tone(60, 0, 0, 0.4), sr, 48).error) fail('a C4 in a file named C3 was not refused');
if (!B.measure(tone(72, 0, 0, 0.4), sr, 48).error) fail('a C5 in a file named C3 was not refused');
{
  const weak = new Float32Array(sr), f = 440 * 2 ** ((28 - 69) / 12);
  for (let i = 0; i < weak.length; i++) { const t = i / sr; weak[i] = (0.1 * Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.4 * Math.sin(6 * Math.PI * f * t)) * Math.exp(-t * 0.6); }
  const w = B.measure(weak, sr, 28);
  if (w.error || Math.abs(w.cents) > 3) fail('a low E1 with a weak fundamental: ' + JSON.stringify(w));
}

// the whole pipeline, when ffmpeg is here
if (!B.has('ffmpeg')) {
  console.log('ffmpeg is not on the PATH: the encoder is not run here');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-samples-'));
  const src = path.join(tmp, 'src'), out = path.join(tmp, 'out');
  fs.mkdirSync(src);
  const wav = (file, d) => {
    const b = Buffer.alloc(44 + d.length * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + d.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(d.length * 2, 40);
    for (let i = 0; i < d.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767))), 44 + i * 2);
    fs.writeFileSync(path.join(src, file), b);
  };
  wav('C3.wav', tone(48, 5, 0.3, 0.5));
  wav('A4.wav', tone(69, -8, 0.1, 0.2));
  wav('E5.wav', tone(76, 0, 0, 0.6));
  wav('G4.wav', tone(70, 0, 0, 0.4)); // labelled G4, sounds G#4: refused
  wav('D4.wav', tone(62, 0, 0, 0.5, 0.2)); // too short: refused
  wav('B2.wav', tone(47, 0, 0.05, 0.05)); // quiet: lifted to full scale like the others
  wav('C2.wav', tone(48, 0, 0, 0.4)); // labelled C2, sounds C3: refused
  wav('notes.txt', new Float32Array(10));
  const logs = [];
  const r = B.build(src, 'piano', { out, release: 0.35, loop: null, source: 'a test', licence: 'none', log: (l) => logs.push(l) });
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  if (man.notes.length !== 4 || man.notes.map((n) => n.midi).join() !== '47,48,69,76') fail('manifest notes: ' + man.notes.map((n) => n.midi).join());
  if (r.refused.sort().join() !== 'C2.wav,D4.wav,G4.wav') fail('refused: ' + r.refused.join());
  const quiet = man.notes.find((n) => n.midi === 47), loud = man.notes.find((n) => n.midi === 48);
  if (!quiet || !loud || Math.abs(quiet.gain / loud.gain - 1) > 0.25) fail(`a quiet note was not lifted: gains ${quiet && quiet.gain} vs ${loud && loud.gain}`);
  if (man.source !== 'a test' || man.licence !== 'none' || man.release !== 0.35) fail('manifest header');
  for (const n of man.notes) {
    if (!/^\d+-[0-9a-f]{8}\.m4a$/.test(n.file) || !fs.existsSync(path.join(out, n.file))) fail('file missing or unhashed: ' + n.file);
    // the trim keeps 10 ms before a note that had silence in front of it, none before one that did not
    const lead = { 47: 0.01, 48: 0.01, 69: 0.01, 76: 0 }[n.midi];
    if (!(Math.abs(n.onset - lead) <= 0.003)) fail(`onset after trimming is ${n.onset} for ${n.midi}, expected about ${lead}`);
    if (Math.abs(n.cents) > 12) fail(`cents ${n.cents} for ${n.midi}`);
    if (!(n.gain > 0.2 && n.gain < 4)) fail(`gain ${n.gain} for ${n.midi}`);
  }
  if (fs.readdirSync(out).some((f) => /^tmp-/.test(f))) fail('a temp file was left behind');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`built ${man.notes.length} notes: ` + man.notes.map((n) => `${n.midi} onset ${Math.round(n.onset * 1000)} ms ${n.cents} c`).join(', '));
}
console.log(bad ? `${bad} problems` : 'sampler OK');
process.exitCode = bad ? 1 : 0;
