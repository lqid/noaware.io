'use strict';
// Your music: the key estimate finds the key of a plain progression in every key, and the
// per-file store keeps marks, refuses junk and stays small.
//   node tone-ladder/tests/music-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', 'music.js'), 'utf8'), { filename: 'music.js' });
const M = TL.Music;
let bad = 0;
const fail = (m) => { bad++; console.log(m); };

// a progression as a mix of partials: I IV V I in major, i iv V i in minor, two bars each, with a
// bass note an octave down
const sr = 22050;
function render(pc, mode) {
  const third = mode === 'major' ? 4 : 3;
  const chords = mode === 'major' ? [[0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]] : [[0, 3, 7], [5, 8, 0], [7, 11, 2], [0, 3, 7]];
  const secs = 1.6, len = Math.round(sr * secs * chords.length), d = new Float32Array(len);
  chords.forEach((ch, c) => {
    const s0 = Math.round(c * secs * sr), s1 = Math.round((c + 1) * secs * sr);
    const midis = ch.map((semi, i) => 48 + ((pc + semi) % 12) + (i === 0 ? 0 : 12)); // root low, the rest above
    midis.push(midis[0] - 12);
    for (const m of midis) {
      const f = 440 * 2 ** ((m - 69) / 12);
      for (let h = 1; h <= 5; h++) {
        const a = 0.25 / h, w = (2 * Math.PI * f * h) / sr;
        for (let i = s0; i < s1; i++) d[i] += a * Math.sin(w * (i - s0)) * Math.exp(-((i - s0) / sr) * 0.8);
      }
    }
  });
  void third;
  return { data: d, sampleRate: sr };
}
(async () => {
  let top1 = 0, top3 = 0, n = 0;
  const NAME = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (const mode of ['major', 'minor']) {
    for (let pc = 0; pc < 12; pc++) {
      const an = await M.analyse(render(pc, mode));
      const r = M.keysOver(an);
      n++;
      const idx = r.keys.findIndex((k) => k.pc === pc && k.mode === mode);
      if (idx === 0) top1++;
      if (idx >= 0 && idx < 3) top3++;
      else fail(`${NAME[pc]} ${mode}: estimated ${NAME[r.keys[0].pc]} ${r.keys[0].mode}, ${NAME[r.keys[1].pc]} ${r.keys[1].mode}, ${NAME[r.keys[2].pc]} ${r.keys[2].mode}`);
      if (!(r.frames > 10) || r.chroma.length !== 12 || Math.max(...r.chroma) !== 1 || an.frames.length !== 12 * an.count || an.peaks.length !== 2000 || Math.abs(an.duration - 6.4) > 0.01) fail(`${NAME[pc]} ${mode}: analysis shape wrong`);
    }
  }
  console.log(`key estimate: top candidate right in ${top1}/${n}, in the top three in ${top3}/${n}`);
  if (top1 < n - 2) fail('the key estimate misses too often');
  // a range inside the file analyses only that part
  const an = await M.analyse(render(7, 'major'));
  const r = M.keysOver(an, 0, 1.5); // the first chord only: G major
  if (!(r.frames > 5 && r.frames < 40) || r.keys[0].pc !== 7) fail('range not honoured: ' + r.frames + ' frames, ' + NAME[r.keys[0].pc]);
  if (await M.analyse(render(0, 'major'), { cancelled: () => true }) !== null) fail('a cancelled analysis did not stop');
  const p = M.makePlayer();
  if (p.state().file !== null || p.time !== 0) fail('a player with no document is not idle');

  // the per-file store
  const F = M.files;
  const fp = M.fingerprint({ name: 'song.mp3', size: 1234 }, 200.04);
  if (fp !== 'song.mp3|1234|2000') fail('fingerprint ' + fp);
  F.put(fp, { name: 'song.mp3', dur: 200.04, key: { pc: 7, mode: 'major' }, loop: [10, 20], speed: 0.75, drone: 1.5, marks: [{ t: 12.5, rn: 'I', bass: 'Do' }, { t: 3, rn: 'V', note: 'pickup' }] });
  const e = F.get(fp);
  if (!e || e.marks.length !== 2 || e.marks[0].t !== 3 || e.key.pc !== 7 || e.loop[1] !== 20 || e.speed !== 0.75 || e.drone !== 1.5) fail('round trip lost something: ' + JSON.stringify(e));
  if (M.marksText(e) !== '0:03.0 V · pickup\n0:12.5 I on Do') fail('marks text: ' + JSON.stringify(M.marksText(e)));
  // junk is dropped field by field, not the whole entry
  store[M.KEY] = JSON.stringify({ files: [{ fp: 'x|1|1', key: { pc: 99, mode: 'lydian' }, loop: [5, 2], speed: 9, marks: [{ t: -1 }, { t: 4, rn: 'I'.repeat(40), note: 7 }, 'nope'] }, 'junk', null] });
  const j = F.get('x|1|1');
  if (!j || j.key !== null || j.loop !== null || j.speed !== 1 || j.marks.length !== 1 || j.marks[0].rn.length !== 12 || j.marks[0].note !== '') fail('junk not cleaned: ' + JSON.stringify(j));
  if (F.recent().length !== 1) fail('junk entries kept');
  store[M.KEY] = '{not json';
  if (F.recent().length !== 0) fail('bad JSON not tolerated');
  // the list stays short and most recent first
  for (let i = 0; i < 60; i++) F.put('f' + i, { name: 'f' + i, dur: 1 });
  const all = F.recent();
  if (all.length !== 50 || all[0].fp !== 'f59' || all[49].fp !== 'f10') fail('cap or order wrong: ' + all.length + ' ' + all[0].fp);
  F.forget('f59');
  if (F.get('f59')) fail('forget did not');
  console.log(bad ? `${bad} problems` : 'music OK');
  process.exitCode = bad ? 1 : 0;
})();
