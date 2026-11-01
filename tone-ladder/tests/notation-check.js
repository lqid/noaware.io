'use strict';
// The notation renderer: every degree in every key and mode is spelled on a run of letters with no
// double accidental and nothing against the signature; the signatures match the circle of fifths;
// a staff and a rhythm render well-formed SVG for every clef, signature, value, rest, tie, chord
// and ledger line, and for every rhythm the curriculum can make.
//   node tone-ladder/tests/notation-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
for (const f of ['theory.js', 'curriculum.js', 'notation.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, N = TL.Notation;
let bad = 0;
const fail = (m) => { bad++; if (bad <= 30) console.log('FAIL', m); };
const MODES = Object.keys(TL.MODE_SCALE);
const LETTERS = 'CDEFGAB', NATURAL = [0, 2, 4, 5, 7, 9, 11];
const accName = (a) => ({ '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' }[a]);

// ---------- spelling ----------
for (const mode of MODES) for (let tonic = 0; tonic < 12; tonic++) {
  const key = { tonic, mode }, name = TL.keyName(tonic, mode), sig = N.keySignature(key);
  const tonicL = LETTERS.indexOf(name[0]);
  // what the signature says about each letter
  const inSig = (L) => (sig.sharps && 'FCGDAEB'.indexOf(L) < sig.sharps ? 1 : sig.flats && 'BEADGCF'.indexOf(L) < sig.flats ? -1 : 0);
  for (const d of TL.DEGREES) {
    const midi = 60 + tonic + d.semi, s = N.spell(midi, key), where = `${name} ${d.id}`;
    const L = LETTERS.indexOf(s.letter);
    if (L < 0 || !Number.isInteger(s.octave)) fail(where + ': bad spelling ' + JSON.stringify(s));
    if (Math.abs(s.acc) > 1) fail(where + ': double accidental ' + s.letter + accName(s.acc));
    if ((s.octave + 1) * 12 + NATURAL[L] + s.acc !== midi) fail(`${where}: ${s.letter}${accName(s.acc)}${s.octave} is not MIDI ${midi}`);
    // the digit of the degree picks the letter, unless that letter would need a double accidental
    const wantL = (tonicL + Number(d.id.slice(-1)) - 1) % 7;
    const wantAcc = ((TL.mod12(midi) - NATURAL[wantL] + 18) % 12) - 6;
    if (Math.abs(wantAcc) <= 1 && L !== wantL) fail(`${where}: spelled ${s.letter} instead of ${LETTERS[wantL]}`);
    if (Math.abs(wantAcc) > 1 && Math.abs(L - wantL) % 6 !== 1) fail(`${where}: fell back to ${s.letter}, not a neighbour of ${LETTERS[wantL]}`);
    // a diatonic degree is already in the signature: no accidental to show
    if (TL.MODE_SCALE[mode].includes(d.id) && s.acc !== inSig(s.letter)) fail(`${where}: ${s.letter}${accName(s.acc)} against the signature ${JSON.stringify(sig)}`);
  }
  // the seven scale degrees run through the seven letters from the tonic
  const run = TL.MODE_SCALE[mode].map((id) => N.spell(60 + tonic + TL.DEG[id].semi, key).letter).join('');
  if (run !== Array.from({ length: 7 }, (_, i) => LETTERS[(tonicL + i) % 7]).join('')) fail(`${name}: letter run ${run}`);
  // the octave number turns over at C, whatever the accidental
  if (N.spell(60, { tonic: 1, mode: 'major' }).octave !== 4 || N.spell(59, { tonic: 1, mode: 'major' }).octave !== 4) fail('octave at C♭/C');
}
// B♯ and C♭ get the octave of the C they stand next to, not of their sounding pitch
{ const s = N.spell(60, { tonic: 1, mode: 'minor' }); if (s.letter !== 'B' || s.acc !== 1 || s.octave !== 3) fail('B♯3 expected for 60 in C♯ minor, got ' + JSON.stringify(s)); }

// ---------- key signatures: the circle of fifths, by the key names the app uses ----------
// sharps positive, flats negative, in pitch-class order C .. B
const CIRCLE = {
  major: [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5],
  minor: [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2],
  dorian: [-2, 5, 0, -5, 2, -3, 4, -1, 6, 1, -4, 3],
  phrygian: [-4, 3, -2, -7, 0, -5, 2, -3, 4, -1, -6, 1],
  lydian: [1, -4, 3, -2, 5, 0, 7, 2, -3, 4, -1, 6],
  mixolydian: [-1, -6, 1, -4, 3, -2, 5, 0, -5, 2, -3, 4],
};
for (const mode of MODES) for (let tonic = 0; tonic < 12; tonic++) {
  const sig = N.keySignature({ tonic, mode }), n = (sig.sharps || 0) - (sig.flats || 0);
  if (sig.sharps && sig.flats) fail(`${TL.keyName(tonic, mode)}: both sharps and flats`);
  if (n !== CIRCLE[mode][tonic]) fail(`${TL.keyName(tonic, mode)}: signature ${n}, expected ${CIRCLE[mode][tonic]}`);
}

// ---------- rendering ----------
const count = (svg, cls) => (svg.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, 'g')) || []).length;
function wellFormed(svg, where) {
  if (typeof svg !== 'string') return fail(where + ': not a string');
  if ((svg.match(/<svg\b/g) || []).length !== 1 || !svg.startsWith('<svg') || !svg.endsWith('</svg>')) fail(where + ': not one <svg> root');
  if (!/<svg[^>]* viewBox="0 0 [\d.]+ [\d.]+"/.test(svg)) fail(where + ': no viewBox');
  if (/#[0-9a-f]{3,6}\b|rgb\(/i.test(svg)) fail(where + ': a colour of its own');
  if (/font-family="(?!inherit")/.test(svg)) fail(where + ': a font of its own');
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    if (m[1]) { if (stack.pop() !== m[2]) return fail(where + ': stray </' + m[2] + '>'); }
    else if (!m[3]) stack.push(m[2]);
  }
  if (stack.length) fail(where + ': unclosed <' + stack.join('> <') + '>');
}
const q = (midi, dur = 1, more = {}) => ({ midi, dur, ...more });
const C = { tonic: 0, mode: 'major' };
let staves = 0;
const render = (where, o) => { staves++; let svg; try { svg = N.staff(o); } catch (e) { return fail(where + ' threw ' + e.stack); } wellFormed(svg, where); if (/undefined|NaN/.test(svg)) fail(where + ': the drawing has an undefined part'); return svg; };

// every clef, every signature, 1 to 16 notes of every value, with rests, ties and chords mixed in
const VALUES = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];
for (const clef of ['treble', 'bass', 'auto']) for (const mode of MODES) for (let tonic = 0; tonic < 12; tonic += 5) {
  const key = { tonic, mode };
  for (let n = 1; n <= 16; n++) {
    const notes = [];
    for (let i = 0; i < n; i++) {
      const dur = VALUES[(i * 3 + n) % VALUES.length];
      if (i % 5 === 4) notes.push({ rest: true, dur });
      else if (i % 7 === 6) notes.push({ midis: [48 + (i * 5) % 24, 55 + (i * 3) % 12, 60 + (i * 4) % 17], dur });
      else notes.push(q(36 + ((i * 7 + tonic) % 60), dur, { tie: i % 3 === 0 }));
    }
    render(`${clef} ${TL.keyName(tonic, mode)} ${n} notes`, { clef, key, notes, lyrics: notes.map((_, i) => 'la' + i), chords: [{ at: 0, text: 'I' }, { at: n - 1, text: 'V7/V <&>' }], highlight: [0, n - 1], width: 320 + n * 20, bars: n % 2 ? 4 : 0, compact: n % 4 === 0 });
  }
}
// what the drawing says: ledger lines, accidentals, highlights, clef choice, ties, bar lines
const ledgers = (clef, midi) => count(render('ledger ' + clef + ' ' + midi, { clef, key: C, notes: [q(midi)] }), 'ledger');
for (const [clef, midi, n] of [['treble', 60, 1], ['treble', 57, 2], ['treble', 62, 0], ['treble', 81, 1], ['treble', 84, 2], ['treble', 79, 0], ['bass', 40, 1], ['bass', 43, 0], ['bass', 60, 1], ['bass', 64, 2], ['bass', 57, 0]]) {
  if (ledgers(clef, midi) !== n) fail(`${clef} ${midi}: ${ledgers(clef, midi)} ledger lines, expected ${n}`);
}
{
  const chrom = render('chromatic', { key: C, notes: Array.from({ length: 12 }, (_, i) => q(60 + i, 0.5)) });
  // five flats and sharps, and the four naturals that cancel them on the same letter (D♭ D, E♭ E, A♭ A, B♭ B)
  if (count(chrom, 'acc') !== 9) fail('C major chromatic: ' + count(chrom, 'acc') + ' accidentals, expected 9');
  // an accidental holds for its letter until a note cancels it: F F♯ G F needs ♯ then ♮; in C minor B B♭ C needs ♮ then ♭
  if (count(render('cancel', { key: C, notes: [65, 66, 67, 65].map((m) => q(m)) }), 'acc') !== 2) fail('F F♯ G F: expected ♯ then ♮');
  if (count(render('cancel minor', { key: { tonic: 0, mode: 'minor' }, notes: [59, 58, 60].map((m) => q(m)) }), 'acc') !== 2) fail('B B♭ C in C minor: expected ♮ then ♭');
  // a chord spelled from its root by letter: A♭ diminished wants A♭ C♭ E𝄫, so the double flat is drawn
  const dim = render('A flat diminished', { key: { tonic: 8, mode: 'major' }, sig: false, notes: [{ midis: [56, 59, 62], dur: 1, letters: [5, 0, 2] }] });
  if (count(dim, 'acc') !== 3 || !dim.includes('translate(-8 0)')) fail('A♭ diminished: expected three accidentals with a double flat, got ' + count(dim, 'acc'));
  // without a signature every sharp or flat is written, naturals only when they cancel
  if (count(render('unsigned', { key: { tonic: 2, mode: 'major' }, sig: false, notes: [62, 66, 69].map((m) => q(m)) }), 'sig') !== 0 || count(render('unsigned', { key: { tonic: 2, mode: 'major' }, sig: false, notes: [62, 66, 69].map((m) => q(m)) }), 'acc') !== 1) fail('an unsigned D major triad should show one sharp and no signature');
  if (count(chrom, 'head') !== 12 || count(chrom, 'note') !== 12) fail('C major chromatic: heads ' + count(chrom, 'head'));
  const eMaj = render('E major', { key: { tonic: 4, mode: 'major' }, notes: [64, 66, 68, 69, 71, 73, 75, 76].map((m) => q(m)) });
  if (count(eMaj, 'acc') !== 0) fail('E major scale shows accidentals');
  if (count(eMaj, 'sig') !== 4) fail('E major: ' + count(eMaj, 'sig') + ' signature accidentals');
  const fMin = render('F minor', { clef: 'bass', key: { tonic: 5, mode: 'minor' }, notes: [q(41), q(52), q(53)] });
  if (count(fMin, 'sig') !== 4 || count(fMin, 'acc') !== 1) fail('F minor bass: sig ' + count(fMin, 'sig') + ' acc ' + count(fMin, 'acc'));
  const hl = render('highlight', { key: C, notes: [q(60), q(62), { rest: true, dur: 1 }, q(64)], highlight: [1, 2] });
  if (count(hl, 'hl') !== 2) fail('highlight: ' + count(hl, 'hl'));
  const low = render('auto low', { clef: 'auto', key: C, notes: [q(40), q(43), q(48), q(72)] }), high = render('auto high', { clef: 'auto', key: C, notes: [q(40), q(64), q(67)] });
  if (!/<g class="clef" transform="translate\(16 /.test(low) || low === high) fail('auto clef does not follow the median');
  const tied = render('ties', { key: C, notes: [q(67, 1, { tie: true }), q(67, 2, { tie: true }), q(69, 1), { midis: [60, 64], dur: 1, tie: true }, { midis: [60, 64], dur: 1 }] });
  if (count(tied, 'tie') !== 4) fail('ties: ' + count(tied, 'tie') + ', expected 4');
  const barred = render('bars', { key: C, notes: [q(60, 3), q(60, 1), q(62, 2), { rest: true, dur: 1 }, q(64, 1)], bars: 4 });
  if (count(barred, 'bar') !== 2) fail('bars: ' + count(barred, 'bar') + ' bar lines, expected 2');
  if (count(render('no bars', { key: C, notes: [q(60, 4), q(60, 4)] }), 'bar')) fail('bar lines without bars');
  const lyr = render('lyrics', { key: C, notes: [q(60), q(62)], lyrics: ['Do', 'R<e'], chords: [{ at: 1, text: 'V&' }] });
  if (!lyr.includes('>Do<') || !lyr.includes('R&lt;e') || !lyr.includes('V&amp;')) fail('lyrics or chords not escaped as text');
  const a = N.staff({ key: C, notes: [q(60), q(64)] }), b = N.staff({ key: C, notes: [q(60), q(64)] });
  if (a !== b) fail('staff() is not a pure function');
  if (N.staff({}) !== N.staff({ notes: [] }) || !N.staff({}).startsWith('<svg')) fail('an empty staff');
}

// ---------- rhythms: everything the curriculum makes, and every cell on its own ----------
const rh = TL.Curriculum.TRACK.rhythm;
let rhythms = 0;
const renderR = (where, r) => {
  rhythms++;
  let svg;
  try { svg = N.rhythm({ rhythm: r, width: 600 }); } catch (e) { return fail(where + ' threw ' + e.stack); }
  wellFormed(svg, where);
  const sounds = r.ticks.filter((t) => t > 0).length, rests = r.ticks.filter((t) => t < 0).length;
  if (count(svg, 'head') < sounds) fail(`${where}: ${count(svg, 'head')} heads for ${sounds} sounds`);
  if (count(svg, 'rest') !== rests) fail(`${where}: ${count(svg, 'rest')} rests for ${rests}`);
  if (count(svg, 'bar') !== r.bars) fail(`${where}: ${count(svg, 'bar')} bar lines for ${r.bars} bars`);
  if (count(svg, 'tie') !== count(svg, 'head') - sounds) fail(`${where}: ties ${count(svg, 'tie')} do not join the split notes`);
  if (count(svg, 'tuplet') !== r.cells.filter((c) => c === 'trip').length) fail(`${where}: ${count(svg, 'tuplet')} triplet digits`);
  return svg;
};
rh.levels.forEach((lv, L) => {
  for (let n = 0; n < 150; n++) {
    const r = rh.generate(L).rhythm;
    renderR(`rhythm L${L + 1} ${r.cells.join(' ')}`, r);
  }
  for (const card of rh.intro(L).cards) renderR(`rhythm L${L + 1} intro ${card.id}`, card.rhythm);
});
// every cell on its own, filling a bar of its meter (the way an intro card shows it)
for (const [c, cell] of Object.entries(TL.RCELLS)) {
  const meter = TL.cellLen(c) % 12 === 0 ? '4/4' : '6/8', [barTicks, beat] = TL.METERS[meter];
  const cells = Array.from({ length: barTicks / TL.cellLen(c) }, () => c);
  renderR(`cell ${c} in ${meter}`, { cells, ticks: cells.flatMap(() => cell.ticks), meter, bars: 1, barTicks, beat });
}
{
  const r = { cells: ['eqe'], ticks: [6, 12, 6], meter: '4/4', bars: 1, barTicks: 48, beat: 12 };
  const svg = renderR('syncopation', r);
  if (count(svg, 'head') !== 4 || count(svg, 'tie') !== 1) fail('eqe: the quarter across the beat is not two tied eighths');
  const two = renderR('two bars', { cells: ['h', 'h', 'q', 'q', 'h'], ticks: [24, 24, 12, 12, 24], meter: '4/4', bars: 2, barTicks: 48, beat: 12 });
  if (count(two, 'tie')) fail('a half note on the beat was split');
  const r58 = renderR('6/8 eq', { cells: ['eq', 'dq'], ticks: [6, 12, 18], meter: '6/8', bars: 1, barTicks: 36, beat: 18 });
  if (count(r58, 'tie')) fail('6/8: a quarter inside the beat was split');
  if (count(r58, 'beam') !== 0) fail('6/8 eq: nothing to beam, got ' + count(r58, 'beam'));
  const beamed = renderR('beams', { cells: ['ssss', 'ee', 'ess', 'des'], ticks: [3, 3, 3, 3, 6, 6, 6, 3, 3, 9, 3], meter: '4/4', bars: 1, barTicks: 48, beat: 12 });
  if (count(beamed, 'beam') !== 4 + 1 + 2 + 2) fail('beams: ' + count(beamed, 'beam') + ', expected 9');
  if (!renderR('5/4', { cells: ['dh', 'h'], ticks: [36, 24], meter: '5/4', bars: 1, barTicks: 60, beat: 12 }).includes('>5<')) fail('5/4 time signature');
}

// notes with no key: a chord spelled from its root by chord tone, an interval by its number
const accOf = (L, m) => ((TL.mod12(m) - NATURAL[L] + 18) % 12) - 6;
let doubles = 0;
for (const [quality, ct] of Object.entries(TL.CHORD_TYPES)) for (let root = 48; root < 72; root++) {
  const midis = ct.tones.map((t) => root + t), Ls = N.chordLetters(root, quality, midis);
  const accs = midis.map((m, i) => accOf(Ls[i], m));
  if (accs.some((a) => Math.abs(a) > 2)) fail(`${quality} on ${root}: an accidental beyond a double`);
  doubles += accs.filter((a) => Math.abs(a) === 2).length;
  const steps = Ls.map((L) => (L - Ls[0] + 7) % 7);
  const want = { sus2: [0, 1, 4], sus4: [0, 3, 4], add9: [0, 2, 4, 1], maj6: [0, 2, 4, 5], min6: [0, 2, 4, 5] }[quality] || [0, 2, 4, 6].slice(0, ct.tones.length);
  if (steps.join() !== want.join()) fail(`${quality} on ${root}: letters ${steps} from the root, expected ${want}`);
}
{
  const name = (root, quality) => { const midis = TL.CHORD_TYPES[quality].tones.map((t) => root + t); return N.chordLetters(root, quality, midis).map((L, i) => LETTERS[L] + accName(accOf(L, midis[i]))).join(' '); };
  if (name(60, 'aug') !== 'C E G♯') fail('C augmented: ' + name(60, 'aug'));
  if (name(60, 'dim7') !== 'C E♭ G♭ B𝄫') fail('C diminished 7: ' + name(60, 'dim7'));
  if (name(68, 'dim7') !== 'G♯ B D F') fail('A♭ diminished 7 should take the name G♯: ' + name(68, 'dim7'));
}
for (const iv of TL.INTERVALS) for (let low = 48; low <= 70; low++) {
  const midis = [low, low + iv.semi], Ls = N.intervalLetters(iv.id, midis);
  const apart = (Ls[1] - Ls[0] + 7) % 7, want = { m2: 1, M2: 1, m3: 2, M3: 2, P4: 3, TT: 3, P5: 4, m6: 5, M6: 5, m7: 6, M7: 6, P8: 0 }[iv.id];
  if (apart !== want) fail(`${iv.id} from ${low}: ${apart} letters apart`);
  if (midis.some((m, i) => Math.abs(accOf(Ls[i], m)) > 1)) fail(`${iv.id} from ${low}: a double accidental`);
  const falling = N.intervalLetters(iv.id, [low + iv.semi, low]); // a falling interval lists the high note first
  if (falling[0] !== Ls[1] || falling[1] !== Ls[0]) fail(`${iv.id} from ${low}: falling spelled differently`);
}
// every chord voicing, every inversion: no accidental runs into a head, none is cut off by the drawing's edge
let voicings = 0;
const tr = (chunk, cls) => [...chunk.matchAll(new RegExp(`<g class="${cls}" transform="translate\\(([-\\d.]+) ([-\\d.]+)\\)">`, 'g'))].map((m) => [+m[1], +m[2]]);
for (const [quality, ct] of Object.entries(TL.CHORD_TYPES)) for (let inv = 0; inv < ct.tones.length; inv++) for (let root = 50; root < 74; root += 1) {
  const midis = TL.chordVoicing(root, quality, inv, false);
  const svg = render(`${quality} ${inv} on ${root}`, { key: { tonic: root, mode: 'major' }, sig: false, notes: [{ midis, dur: 1, letters: N.chordLetters(root, quality, midis) }] });
  if (!svg) continue;
  voicings++;
  const H = +/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)[1];
  const accs = tr(svg, 'acc'), heads = tr(svg, 'head');
  for (const [ax, ay] of accs) {
    if (ay - 18 < 0 || ay + 13 > H) fail(`${quality} inversion ${inv} on ${root}: an accidental is cut off (y ${ay}, height ${H})`);
    for (const [hx, hy] of heads) if (Math.abs(hy - ay) < 12 && hx - ax < 8 && hx > ax - 4) fail(`${quality} inversion ${inv} on ${root}: an accidental runs into a head`);
  }
  // and no two accidentals touch: each one's box, from the shape drawn
  const SHAPE = [['translate(-8 0)', [-11, 5.5, -18, 5]], ['M -2.2 -13', [-4.6, 4.6, -13, 13]], ['M -3 -18', [-3, 5.5, -18, 5]], ['M -2.4 -12', [-2.4, 2.4, -12, 12]], ['M -4.2 -4.2', [-4.2, 4.2, -4.2, 4.2]]];
  const boxes = [...svg.matchAll(/<g class="acc" transform="translate\(([-\d.]+) ([-\d.]+)\)">(.{0,40})/g)].map((m) => { const [l, r, t, b] = SHAPE.find(([k]) => m[3].includes(k))[1]; return [+m[1] + l, +m[1] + r, +m[2] + t, +m[2] + b]; });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, c] = [boxes[i], boxes[j]];
    if (a[0] < c[1] && c[0] < a[1] && a[2] < c[3] && c[2] < a[3]) { fail(`${quality} inversion ${inv} on ${root}: two accidentals overlap`); break; }
  }
}
console.log(`${voicings} chord voicings drawn, ${doubles} double accidentals among the chords`);
console.log(`${staves} staves and ${rhythms} rhythms rendered`);
console.log(bad ? `${bad} problems` : 'notation OK');
process.exitCode = bad ? 1 : 0;
