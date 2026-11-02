'use strict';
// The notation renderer: every degree in every key and mode is spelled on a run of letters with no
// double accidental and nothing against the signature; the signatures match the circle of fifths;
// a staff and a rhythm render well-formed SVG for every clef, signature, value, rest, tie, chord
// and ledger line, and for every rhythm the curriculum can make; time signatures, beams, slashes,
// blanks, wrong lengths and bare rhythms draw as they should; and anything drawn without those
// options is exactly what the code on git main draws.
//   node tone-ladder/tests/notation-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
for (const f of ['theory.js', 'curriculum.js', 'notation.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, N = TL.Notation;
let bad = 0;
const fail = (m) => { bad++; if (bad <= 30) console.log('FAIL', m); };

// main's notation.js, loaded in a context of its own on this copy's theory, to compare drawings
// with. A checkout without git or a main branch (a shallow CI clone) skips the comparison.
let mainN = null, compared = 0;
for (const ref of ['main', 'origin/main']) {
  try {
    const src = require('child_process').execFileSync('git', ['show', `${ref}:./js/notation.js`], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const ctx = { TL: { ...TL, Notation: undefined } };
    ctx.window = ctx;
    vm.runInContext(src, vm.createContext(ctx), { filename: `${ref}:notation.js` });
    mainN = ctx.TL.Notation;
    break;
  } catch (e) { /* the next ref, or none */ }
}
const usesNew = (o) => o.time || o.beam || (o.notes || []).some((n) => n.slash || n.blank || n.under);
function sameAsMain(where, svg, draw) {
  if (!mainN || typeof svg !== 'string') return;
  compared++;
  let was;
  try { was = draw(mainN); } catch (e) { return fail(`${where}: main throws, this draws`); }
  if (svg !== was) fail(`${where}: drawn differently from the code on main`);
}
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
const render = (where, o) => {
  staves++;
  let svg;
  try { svg = N.staff(o); } catch (e) { return fail(where + ' threw ' + e.stack); }
  wellFormed(svg, where);
  if (/undefined|NaN/.test(svg)) fail(where + ': the drawing has an undefined part');
  if (!usesNew(o)) sameAsMain(where, svg, (M) => M.staff(o));
  return svg;
};

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
  // and only in its own octave: F♯ then an F an octave up needs no natural
  if (count(render('octave', { key: C, notes: [66, 77].map((m) => q(m)) }), 'acc') !== 1) fail('F♯4 F5: expected only the ♯');
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
  sameAsMain(where, svg, (M) => M.rhythm({ rhythm: r, width: 600 }));
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
// the treble clef with an 8: drawn exactly as the treble clef an octave up, with its 8, and never chosen by auto
const posOf = (svg) => [...svg.matchAll(/<g class="(?:head|sig)" transform="translate\(([-\d.]+) ([-\d.]+)\)">/g)].map((m) => m[2]).join();
for (const mode of ['major', 'minor']) for (let t = 0; t < 12; t++) {
  const ns = [0, 2, 4, 5, 7, 9, 11, 12].map((x) => q(48 + t + x));
  const a = render('treble8 ' + t + mode, { key: { tonic: t, mode }, clef: 'treble8', notes: ns }), b = render('treble ' + t + mode, { key: { tonic: t, mode }, clef: 'treble', notes: ns.map((n) => q(n.midi + 12)) });
  if (posOf(a) !== posOf(b)) fail(`treble8 in ${t} ${mode} is not treble an octave up`);
  if (count(a, 'clef8') !== 1 || count(b, 'clef8') !== 0) fail(`treble8 in ${t} ${mode}: its 8 is missing, or the treble clef has one`);
}
for (const [clef, midi, n] of [['treble8', 48, 1], ['treble8', 45, 2], ['treble8', 50, 0], ['treble8', 72, 2]]) if (ledgers(clef, midi) !== n) fail(`${clef} ${midi}: ${ledgers(clef, midi)} ledger lines, expected ${n}`);
for (const midi of [40, 48, 55, 60, 67, 76]) if (count(render('auto ' + midi, { key: C, notes: [q(midi), q(midi + 2)] }), 'clef8')) fail('auto chose treble8');

// ---------- time signatures, beams, slashes, blanks, wrong lengths ----------
// each element directly inside the drawing's wrapping <g>, in order
function partsOf(svg) {
  const out = [];
  let depth = 0, start = 0;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    if (m[1]) { if (--depth === 2) out.push(svg.slice(start, m.index + m[0].length)); }
    else if (m[3]) { if (depth === 2) out.push(m[0]); }
    else { if (depth === 2) start = m.index; depth++; }
  }
  return out;
}
// what a staff shows: its lines, each note's heads, stem and flags, the beams, the time signature, the rules
function look(svg) {
  const ps = partsOf(svg), H = +/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)[1];
  const lines = ps.filter((p) => /^<line x1="[-\d.]+" y1="([-\d.]+)" x2="[-\d.]+" y2="\1" stroke-width="1"\/>$/.test(p)).map((p) => +/y1="([-\d.]+)"/.exec(p)[1]);
  const notes = ps.filter((p) => p.startsWith('<g class="note')).map((p) => {
    const st = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="\1" y2="([-\d.]+)" stroke-width="1.4"\/>/.exec(p), heads = tr(p, 'head');
    return { x: heads[0][0], ys: heads.map((h) => h[1]), stem: st && { x: +st[1], from: +st[2], to: +st[3] }, flags: (p.match(/M 0 0 C 1 8 12 10 9 23/g) || []).length, slash: p.startsWith('<g class="note slash'), part: p };
  });
  const beams = ps.filter((p) => p.startsWith('<rect class="beam"')).map((p) => { const [, x, y, w] = /x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)"/.exec(p).map(Number); return { from: x + 0.7, to: x + w - 0.7, y }; });
  const time = [...svg.matchAll(/<text class="time" x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)</g)].map((m) => ({ x: +m[1], y: +m[2], s: m[3] }));
  const rules = [...svg.matchAll(/<line class="under" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)"/g)].map((m) => ({ from: +m[1], y: +m[2], to: +m[3] }));
  const bars = [...svg.matchAll(/<line class="bar" x1="([-\d.]+)"/g)].map((m) => +m[1]);
  return { ps, H, lines, notes, beams, time, rules, bars };
}
// the beams at the stems' tips, as the sizes of their groups, and the flags left over; every
// beamed note's stem ends at its beam, all one way, with no flag
function beamGroups(where, o) {
  const svg = render(where, o);
  if (!svg) return { sizes: '?', flags: -1, notes: [], beams: [] };
  const L = look(svg), sizes = [];
  for (const b of L.beams) {
    if (b.y < 0 || b.y + 5 > L.H) fail(`${where}: a beam is cut off by the drawing's edge`);
    const js = L.notes.filter((n) => n.stem && n.stem.x >= b.from - 0.3 && n.stem.x <= b.to + 0.3);
    // a second beam (or a stub) stops short of the tips
    if (js.length < 2 || !js.every((n) => Math.abs(n.stem.to - (n.stem.to < n.stem.from ? b.y : b.y + 5)) < 0.15)) continue;
    sizes.push(js.length);
    if (new Set(js.map((n) => n.stem.x > n.x)).size !== 1) fail(`${where}: a beamed group with stems both ways`);
    if (js.some((n) => n.flags)) fail(`${where}: a beamed note keeps its flag`);
    if (js.some((n) => !n.slash && Math.abs(n.stem.to - n.stem.from) < 35)) fail(`${where}: a beamed stem shorter than a flagged one`);
  }
  return { sizes: sizes.join(' '), flags: L.notes.reduce((a, n) => a + n.flags, 0), ...L };
}
const e = (midi, more) => q(midi, 0.5, more), rest = (dur) => ({ rest: true, dur });
const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
{
  const grouped = (where, o, sizes, flags) => {
    const b = beamGroups(where, o);
    if (b.sizes !== sizes || b.flags !== flags) fail(`${where}: beams over ${b.sizes || 'nothing'} and ${b.flags} flags, expected ${sizes || 'nothing'} and ${flags}`);
    return b;
  };
  grouped('4/4 eighths', { key: C, time: '4/4', beam: true, notes: SCALE.slice(0, 8).map((m) => e(m)) }, '2 2 2 2', 0);
  grouped('4/4 eighths without beam', { key: C, time: '4/4', notes: SCALE.slice(0, 8).map((m) => e(m)) }, '', 8);
  grouped('3/4 eighths', { key: C, time: '3/4', beam: true, notes: SCALE.slice(0, 6).map((m) => e(m)) }, '2 2 2', 0);
  grouped('6/8 eighths', { key: C, time: '6/8', beam: true, notes: SCALE.slice(0, 6).map((m) => e(m)) }, '3 3', 0);
  grouped('6/8 eee eee', { key: C, time: '6/8', beam: true, notes: [...SCALE.slice(0, 6), ...SCALE.slice(0, 6)].map((m) => e(m)) }, '3 3 3 3', 0);
  grouped('no time: the beat is a quarter', { key: C, bars: 3, beam: true, notes: SCALE.slice(0, 6).map((m) => e(m)) }, '2 2 2', 0);
  // a beat given with no time signature, as on a phone's second system of a 6/8 melody: in threes
  grouped('no time, a dotted-quarter beat', { key: C, bars: 3, beat: 18, beam: true, notes: SCALE.slice(0, 6).map((m) => e(m)) }, '3 3', 0);
  grouped('no time, a dotted-quarter beat: dotted quarter, three eighths', { key: C, bars: 3, beat: 18, beam: true, notes: [q(60, 1.5), e(62), e(64), e(65)] }, '3', 0);
  grouped('a rest breaks the beam', { key: C, time: '4/4', beam: true, notes: [e(60), rest(0.5), e(62), e(64), q(65), q(67)] }, '2', 1);
  grouped('6/8 a rest in the first beat', { key: C, time: '6/8', beam: true, notes: [e(60), e(62), rest(0.5), e(64), e(65), e(67)] }, '2 3', 0);
  grouped('no beam across a beat', { key: C, time: '4/4', beam: true, notes: [q(60), e(62), e(64), e(65), e(67), q(69)] }, '2 2', 0);
  grouped('off the beat: eighth, quarter, eighth', { key: C, time: '4/4', beam: true, notes: [e(60), q(62), e(64), q(65, 2)] }, '', 2);
  grouped('dotted quarter and eighth', { key: C, time: '4/4', beam: true, notes: [q(60, 1.5), e(62), q(64, 2)] }, '', 1);
  grouped('6/8 quarter and eighth', { key: C, time: '6/8', beam: true, notes: [q(60), e(62), e(64), q(65)] }, '', 2);
  grouped('across a bar line', { key: C, time: '3/4', beam: true, notes: [q(60), q(62), e(64), e(65), e(67), e(69)] }, '2 2', 0);
  const six = grouped('sixteenths', { key: C, time: '4/4', beam: true, notes: [0.25, 0.25, 0.25, 0.25, 0.5, 0.25, 0.25, 0.75, 0.25, 1].map((d, i) => q(SCALE[i], d)) }, '4 3 2', 0);
  if (six.beams.length !== 4 + 2 + 2) fail(`sixteenths: ${six.beams.length} beams, expected 8 (a second beam per pair of sixteenths, a stub for the lone one)`);
  const trip = grouped('triplet', { key: C, time: '4/4', beam: true, notes: [1 / 3, 1 / 3, 1 / 3, 1, 2].map((d, i) => q(SCALE[i], d)) }, '3', 0);
  if (count(trip.ps.join(''), 'tuplet') !== 1) fail('a beamed triplet has no 3');
  // stem direction: the note farthest from the middle line decides for the whole group
  const ways = (where, midis, beam = true) => beamGroups(where, { key: C, time: '4/4', beam, notes: midis.map((m) => e(m)) }).notes.map((n) => (n.stem.x > n.x ? 'up' : 'down')).join(' ');
  for (const [midis, want, why] of [[[64, 65], 'up up', 'low'], [[72, 74], 'down down', 'high'], [[64, 79], 'down down', 'G5 farther than E4'], [[62, 77], 'up up', 'D4 farther than F5'], [[71, 71], 'down down', 'on the middle line']]) {
    const got = ways(`stems ${midis}`, midis);
    if (got !== want) fail(`beamed ${midis} (${why}): stems ${got}, expected ${want}`);
  }
  if (ways('unbeamed 64 79', [64, 79], false) !== 'up down') fail('without beams each note keeps its own stem direction');
}
// time signatures in every clef, after the widest signatures, before the notes, with their bar lines
const SEVEN = [C, { tonic: 6, mode: 'lydian' }, { tonic: 3, mode: 'phrygian' }]; // none, seven sharps, seven flats
for (const clef of ['treble', 'treble8', 'bass']) for (const key of SEVEN) for (const time of ['4/4', '3/4', '6/8']) {
  const [num, den] = time.split('/'), dur = 4 / den, base = { treble: 67, treble8: 55, bass: 48 }[clef];
  const where = `${time} in ${clef}, ${TL.keyName(key.tonic, key.mode)}`;
  const svg = render(where, { key, clef, time, beam: true, notes: Array.from({ length: num * 2 }, (_, i) => q(base + [0, 2, 4, 5][i % 4], dur)) });
  if (!svg) continue;
  const L = look(svg), [hi, lo] = L.time;
  if (L.time.length !== 2 || hi.s !== num || lo.s !== den) { fail(`${where}: time signature ${L.time.map((t) => t.s).join('/')}`); continue; }
  if (hi.x !== lo.x || hi.y !== L.lines[2] || lo.y !== L.lines[4]) fail(`${where}: the numbers do not stand on the middle and bottom lines, one over the other`);
  const sigXs = tr(svg, 'sig').map(([x]) => x), clefRight = 8 + (clef === 'bass' ? 8 + 21 : 16 + 15);
  if (hi.x - 9 < (sigXs.length ? Math.max(...sigXs) + 5.5 : clefRight) + 2) fail(`${where}: the time signature runs into the ${sigXs.length ? 'signature' : 'clef'}`);
  const first = L.notes[0], left = Math.min(...[...first.part.matchAll(/translate\(([-\d.]+) /g)].map((m) => +m[1])) - 6.5;
  if (left < hi.x + 9 + 2) fail(`${where}: the first note runs into the time signature`);
  if (L.bars.length !== 2) fail(`${where}: ${L.bars.length} bar lines for two bars`);
  if (clef === 'treble8' && count(svg, 'clef8') !== 1) fail(`${where}: the clef lost its 8`);
}
if (look(render('12/8', { key: C, time: '12/8', beam: true, notes: Array.from({ length: 12 }, (_, i) => e(SCALE[i % 8])) })).beams.length !== 4) fail('12/8: eighths beam in threes');
// slashes: the rhythm on the middle line, no pitch, no accidental; stems and beams as for the value
{
  const slashes = [{ slash: true, dur: 1 }, { slash: true, dur: 0.5 }, { slash: true, dur: 0.5 }, { slash: true, dur: 2 }];
  for (const clef of ['treble', 'treble8', 'bass', 'auto']) {
    const where = 'slashes in ' + clef, b = beamGroups(where, { key: { tonic: 2, mode: 'major' }, clef, time: '4/4', beam: true, notes: slashes });
    if (b.notes.length !== 4 || b.notes.some((n) => !n.slash)) { fail(`${where}: ${b.notes.length} slash notes`); continue; }
    if (b.notes.some((n) => n.ys.length !== 1 || n.ys[0] !== b.lines[2])) fail(`${where}: a slash off the middle line`);
    if (b.sizes !== '2' || b.notes.some((n) => !n.stem || n.stem.x < n.x)) fail(`${where}: beams over ${b.sizes}; slash stems should go up, the eighths beamed`);
    const all = b.ps.join('');
    if (count(all, 'ledger') || count(all, 'acc')) fail(`${where}: a slash has a ledger line or an accidental`);
    if ((all.match(/Z" stroke="none"/g) || []).length !== 3 || (all.match(/Z" fill="none"/g) || []).length !== 1) fail(`${where}: quarters and eighths need filled slashes, a half an open one`);
  }
  if (!/<g class="clef" transform="translate\(24 /.test(render('auto, slashes only', { clef: 'auto', key: C, notes: slashes }))) fail('auto clef: slashes alone should read treble');
  if (!/<g class="clef" transform="translate\(16 /.test(render('auto, slashes and low notes', { clef: 'auto', key: C, notes: [q(40), q(43), ...slashes] }))) fail('auto clef: a slash should not pull the clef');
  if (count(render('slash between sharps', { key: C, time: '4/4', notes: [q(66), { slash: true, dur: 1 }, q(66), q(60)] }), 'acc') !== 1) fail('a slash between two F♯ in a bar: the second needs no sharp');
  const mixed = beamGroups('a slash beamed with a named note', { key: C, time: '4/4', beam: true, notes: [e(74), { slash: true, dur: 0.5 }, q(60, 3)] });
  if (mixed.sizes !== '2' || mixed.notes.slice(0, 2).some((n) => n.stem.x > n.x)) fail('a slash beamed with D5 should follow its stem down');
  const dotted = render('dotted slash', { key: C, notes: [{ slash: true, dur: 1.5 }, { slash: true, dur: 3 }, { slash: true, dur: 4 }] });
  if ((dotted.match(/r="2\.1"/g) || []).length !== 2 || look(dotted).notes[2].stem) fail('dotted slashes need a dot each, a whole slash no stem');
}
// blanks: an empty beat is a dashed box over its room, with no head, and counts toward the bar
{
  const svg = render('blanks', { key: C, time: '4/4', beam: true, notes: [q(60), { blank: true, dur: 1 }, { blank: true, dur: 1 }, { blank: true, dur: 1 }, { blank: true, dur: 1.5 }, e(62), q(64, 2)] });
  const L = look(svg), boxes = L.ps.filter((p) => p.startsWith('<g class="blank"'));
  if (boxes.length !== 4 || boxes.some((p) => p.includes('class="head"') || !p.includes('stroke-dasharray'))) fail(`blanks: ${boxes.length} dashed boxes with no head, expected 4`);
  const rooms = boxes.map((p) => { const [, x, w] = /<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"/.exec(p).map(Number); return [x, x + w]; });
  if (rooms.some(([a, b]) => b - a < 15) || rooms.some(([a], k) => k && a <= rooms[k - 1][1])) fail('blanks: boxes too narrow or overlapping');
  if (rooms[0][0] < L.notes[0].x + 6.3 || L.bars.length !== 2 || !(rooms[2][1] < L.bars[0] && L.bars[0] < rooms[3][0])) fail('blanks: the boxes are not in their beats, or the bar lines are wrong');
  if (L.notes.length !== 3 || count(svg, 'rest')) fail('blanks: drawn as notes or rests');
}
// wrong lengths: a rule under each, all on one line below everything else, above the names
{
  const notes = [q(60, 1, { under: true }), e(62), e(64, { under: true }), rest(1), q(79, 1, { under: true }), q(57), { ...rest(1), under: true }, q(60, 2)];
  const lyrics = notes.map((n) => (n.rest ? '' : 'Do'));
  for (const clef of ['treble', 'bass']) {
    const where = 'under in ' + clef, svg = render(where, { key: C, clef, time: '4/4', beam: true, notes, lyrics });
    if (!svg) continue;
    const L = look(svg), y = L.rules.length && L.rules[0].y;
    if (L.rules.length !== 4 || L.rules.some((r) => r.y !== y)) { fail(`${where}: ${L.rules.length} rules, expected 4 on one line`); continue; }
    const lowest = Math.max(L.lines[4], ...L.notes.flatMap((n) => [...n.ys.map((v) => v + 4.4), n.stem ? Math.max(n.stem.from, n.stem.to) : 0]), ...L.beams.map((b) => b.y + 5));
    if (y < lowest + 3) fail(`${where}: the rule at ${y} touches what is drawn above it (down to ${lowest})`);
    const names = [...svg.matchAll(/<text class="lyric" x="[-\d.]+" y="([-\d.]+)"/g)].map((m) => +m[1]);
    if (names.some((n) => n - 14 < y + 1)) fail(`${where}: the rule runs into the names`);
    const ruled = L.notes.filter((n) => n.part.includes('class="under"'));
    if (ruled.length !== 3 || ruled.some((n) => !L.rules.some((r) => r.from < n.x && n.x < r.to))) fail(`${where}: a rule is not under its note`);
    if (/class="under"[^>]*(?:stroke|style)=/.test(svg)) fail(`${where}: the rule carries its own colour; the page's CSS gives it`);
  }
  if (count(render('under off', { key: C, notes: notes.map((n) => ({ ...n, under: false })), lyrics }), 'under')) fail('rules drawn with under: false');
}
// a bare rhythm: no time signature and no bar lines, the same notes, centred in its width
for (const [c, cell] of Object.entries(TL.RCELLS)) for (const width of [60, 240]) {
  const meter = TL.cellLen(c) % 12 === 0 ? '4/4' : '6/8', [barTicks, beat] = TL.METERS[meter];
  const r = { cells: [c], ticks: cell.ticks, meter, bars: 1, barTicks, beat }, where = `bare ${c} at ${width}`;
  let full, bare;
  try { full = N.rhythm({ rhythm: r, width }); bare = N.rhythm({ rhythm: r, width, bare: true }); } catch (err) { fail(where + ' threw ' + err.stack); continue; }
  rhythms++;
  wellFormed(bare, where);
  if (count(bare, 'time') || count(bare, 'bar')) fail(`${where}: a time signature or bar line`);
  for (const cls of ['note', 'head', 'rest', 'beam', 'tie', 'tuplet']) if (count(bare, cls) !== count(full, cls)) fail(`${where}: ${count(bare, cls)} ${cls} for ${count(full, cls)}`);
  const W = +/viewBox="0 0 ([\d.]+)/.exec(bare)[1], xs = [...bare.matchAll(/<g class="(?:head|rest)"(?: transform="translate\(|><g transform="translate\()([-\d.]+) /g)].map((m) => +m[1]);
  if (Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - W / 2) > 0.5) fail(`${where}: not centred (${Math.min(...xs)}..${Math.max(...xs)} in ${W})`);
}
if (N.rhythm({ rhythm: { ticks: [], meter: '4/4' }, bare: true }).includes('NaN')) fail('an empty bare rhythm');
// every new option is off unless asked for; a staff used as a control draws as before too
{
  const o = { key: { tonic: 7, mode: 'major' }, clef: 'treble', bars: 4, notes: [q(67, 0.5), q(71, 0.5), q(74), { rest: true, dur: 1 }, q(66, 1.5), q(67, 0.5), q(79, 4)] };
  if (N.staff({ ...o, time: '', beam: false }) !== N.staff(o)) fail('time "" or beam: false changes the drawing');
  const r = { ticks: [6, 6, 12, -12, 18, 6], meter: '4/4', barTicks: 48, beat: 12 };
  if (N.rhythm({ rhythm: r, bare: false }) !== N.rhythm({ rhythm: r })) fail('bare: false changes the rhythm');
  render('grid', { key: { tonic: 2, mode: 'dorian' }, clef: 'treble', grid: true, width: 320, notes: [0, 2, 3, 5, 7, 9, 10, 12].map((s) => q(62 + s)), lyrics: ['Do', 'Re', 'Me', 'Fa', 'Sol', 'La', 'Te', 'Do'] });
  render('compact grid', { key: { tonic: 10, mode: 'minor' }, clef: 'bass', grid: true, compact: true, width: 260, notes: [q(46), q(48), q(49)] });
}
console.log(mainN ? `${compared} drawings without the new options are the same as the code on main draws` : 'note: no git main branch here, so the drawings were not compared with it');
console.log(`${staves} staves and ${rhythms} rhythms rendered`);
console.log(bad ? `${bad} problems` : 'notation OK');
process.exitCode = bad ? 1 : 0;
