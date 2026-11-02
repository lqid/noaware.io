/* Tone Ladder — notation: a staff or a rhythm as an SVG string. Everything is lines and hand-made
   paths in currentColor, so the page's CSS colours it; only lyrics, chord names and digits are
   text. Notes are spelled by scale degree, the way the app teaches them: movable do, with minor
   and the modes read from the same Do. Pure functions, no DOM. */
(function (g) {
  const TL = g.TL || (g.TL = {});

  // ---------- spelling ----------
  const LETTERS = 'CDEFGAB', NATURAL = [0, 2, 4, 5, 7, 9, 11]; // each letter's pitch class
  const FIFTHS = [0, 2, 4, -1, 1, 3, 5]; // each letter's place on the circle of fifths, from C
  const SHARPS = 'FCGDAEB', FLATS = 'BEADGCF'; // the order accidentals enter a signature
  // A mode takes its parent major's signature. In fifths from major: Dorian is minor with La
  // (one up), Mixolydian major with Te (one down), Lydian major with Fi, Phrygian minor with Ra:
  // the same notes MODE_SIGN names.
  const MODE_SHIFT = { major: 0, lydian: 1, mixolydian: -1, dorian: -2, minor: -3, phrygian: -4 };

  // the tonic's letter and accidental, read off the name the app gives the key (F♯ major, E♭ minor)
  function tonicSpelling(key) {
    const name = (TL.minorLike(key.mode) ? TL.MINOR_KEY_NAMES : TL.KEY_NAMES)[TL.mod12(key.tonic)];
    return { L: LETTERS.indexOf(name[0]), acc: name[1] === '♯' ? 1 : name[1] === '♭' ? -1 : 0 };
  }
  // the accidental that puts letter L on pitch class pc: -2 (double flat) .. 2
  const accFor = (L, pc) => ((pc - NATURAL[L] + 18) % 12) - 6;

  function spell(midi, key) {
    const t = tonicSpelling(key), pc = TL.mod12(midi);
    const deg = TL.degBySemi(midi - TL.mod12(key.tonic)).id; // '1'..'7', 'b2', '#4'...: the digit picks the letter
    let L = (t.L + Number(deg.slice(-1)) - 1) % 7;
    let acc = accFor(L, pc);
    // a double sharp or flat gives way to the next letter: F𝄪 in C♯ minor is written G
    if (Math.abs(acc) > 1) { L = (L + 7 + Math.sign(acc)) % 7; acc = accFor(L, pc); }
    return { letter: LETTERS[L], acc, octave: Math.floor((midi - acc) / 12) - 1 };
  }
  // A chord or an interval has no key: each note is spelled on the letter its distance from the
  // lowest says (a raised fifth stays a fifth, G♯ in C+; a minor 2nd stays a second, C♯–D), and the
  // lowest takes whichever of the app's two names for it keeps every accidental single, where it can.
  const nameOf = (name) => ({ L: LETTERS.indexOf(name[0]), acc: name[1] === '♯' ? 1 : name[1] === '♭' ? -1 : 0 });
  function lettersFrom(low, midis, steps) {
    let best = null;
    for (const name of new Set([TL.KEY_NAMES[TL.mod12(low)], TL.MINOR_KEY_NAMES[TL.mod12(low)]])) {
      const L0 = nameOf(name).L, Ls = steps.map((st) => (L0 + st) % 7);
      const worst = Math.max(...midis.map((m, i) => Math.abs(accFor(Ls[i], TL.mod12(m)))));
      if (!best || worst < best.worst) best = { Ls, worst };
    }
    return best.Ls;
  }
  // letters up from the root for each chord tone; chords not listed stack thirds (root, 3rd, 5th, 7th)
  const CHORD_STEPS = { sus2: [0, 1, 4], sus4: [0, 3, 4], add9: [0, 2, 4, 1], maj6: [0, 2, 4, 5], min6: [0, 2, 4, 5] };
  function chordLetters(root, quality, midis) {
    const tones = TL.CHORD_TYPES[quality].tones, steps = CHORD_STEPS[quality] || [0, 2, 4, 6];
    return lettersFrom(root, midis, midis.map((m) => steps[Math.max(0, tones.findIndex((t) => TL.mod12(t) === TL.mod12(m - root)))]));
  }
  // letters apart for each interval: the tritone is written as an augmented 4th, Fa to Ti
  const INTERVAL_STEPS = { m2: 1, M2: 1, m3: 2, M3: 2, P4: 3, TT: 3, P5: 4, m6: 5, M6: 5, m7: 6, M7: 6, P8: 7 };
  function intervalLetters(id, midis) {
    const low = Math.min(...midis);
    return lettersFrom(low, midis, midis.map((m) => (m === low ? 0 : INTERVAL_STEPS[id] || 0)));
  }
  function keySignature(key) {
    const t = tonicSpelling(key);
    const n = FIFTHS[t.L] + 7 * t.acc + (MODE_SHIFT[key.mode] || 0);
    return n < 0 ? { flats: -n } : { sharps: n };
  }
  // what the signature already says about a letter
  const sigAcc = (sig, letter) => (sig.sharps && SHARPS.indexOf(letter) < sig.sharps ? 1 : sig.flats && FLATS.indexOf(letter) < sig.flats ? -1 : 0);
  const stepOf = (s) => s.octave * 7 + LETTERS.indexOf(s.letter); // diatonic steps from C0: a line or space

  // ---------- geometry: a staff space is 10 units; the viewBox maps units to pixels ----------
  // ticks (a quarter is 12, as in theory.js): head kind, flags, dots
  const DUR = { 48: ['w', 0, 0], 36: ['h', 0, 1], 24: ['h', 0, 0], 18: ['q', 0, 1], 12: ['q', 0, 0], 9: ['q', 1, 1], 6: ['q', 1, 0], 4: ['q', 1, 0], 3: ['q', 2, 0] };
  const DURS = Object.keys(DUR).map(Number);
  const shapeOf = (t) => DUR[t] || DUR[DURS.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a))];
  const slot = (t) => 20 + 7 * Math.log2(Math.max(3, t) / 3); // the room a value takes, growing gently with its length
  // treble8 is the treble clef with an 8 under it, as tenor parts are written: the notes sound an
  // octave lower than written, so its middle line is B3
  const MIDSTEP = { treble: 34, bass: 22, treble8: 27 }; // the step on the middle line: B4, D3, B3
  const SIG_STEPS = { sharps: [38, 35, 39, 36, 33, 37, 34], flats: [34, 37, 33, 36, 32, 35, 31] }; // treble; the bass clef's sit 14 lower
  const CLEF_X = { treble: 16, bass: 8, treble8: 16 }, CLEF_Y = { treble: 30, bass: 10, treble8: 30 }; // where the clef's reference line is
  const SIG_DROP = { treble: 0, treble8: 7, bass: 14 }; // the signature's steps below the treble clef's

  const r1 = (v) => Math.round(v * 10) / 10;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const at = (x, y, inner, cls) => `<g${cls ? ` class="${cls}"` : ''} transform="translate(${r1(x)} ${r1(y)})">${inner}</g>`;
  const ln = (x1, y1, x2, y2, w, cls) => `<line${cls ? ` class="${cls}"` : ''} x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke-width="${w}"/>`;
  const text = (x, y, s, size, cls, extra = '') => `<text class="${cls}" x="${r1(x)}" y="${r1(y)}" text-anchor="middle" font-family="inherit" font-size="${size}"${extra} stroke="none">${esc(s)}</text>`;
  const dot = (x, y) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="2.1" stroke="none"/>`;
  // a beam, or the stub of a lone sixteenth
  const beam = (x1, x2, y) => `<rect class="beam" x="${r1(x1 - 0.7)}" y="${r1(y)}" width="${r1(x2 - x1 + 1.4)}" height="5" stroke="none"/>`;
  // a tie bulging away from the stems: dir is 1 below the heads, -1 above
  const tie = (x1, x2, y, dir) => { const m = r1((x1 + x2) / 2); return `<path class="tie" d="M ${r1(x1)} ${r1(y)} Q ${m} ${r1(y + 9 * dir)} ${r1(x2)} ${r1(y)} Q ${m} ${r1(y + 6 * dir)} ${r1(x1)} ${r1(y)} Z" stroke-width="0.8"/>`; };

  // glyphs, each drawn around its own reference point (a clef's line, a note's centre)
  const GLYPH = {
    treble: '<path d="M -1 25 C -2 29 5 29 5 24 C 4 12 6 -18 8 -42 C 9 -50 4 -55 1 -49 C -4 -41 -11 -30 -13 -16 C -15 -3 -12 12 0 15 C 11 17 15 8 14 0 C 13 -10 6 -16 0 -14 C -7 -12 -9 -4 -6 2 C -3 7 4 6 5 1" fill="none" stroke-width="2.6"/><circle cx="2" cy="26" r="2.6" stroke="none"/>',
    bass: '<path d="M 0 0 C 0 -8 10 -11 13 -5 C 16 3 9 13 -4 21" fill="none" stroke-width="2.6"/><circle r="2.8" stroke="none"/><circle cx="18" cy="-5" r="1.9" stroke="none"/><circle cx="18" cy="5" r="1.9" stroke="none"/>',
    sharp: '<path d="M -2.2 -13 V 13 M 2.2 -13 V 13" fill="none" stroke-width="1.3"/><path d="M -4.6 -2.4 L 4.6 -5.6 M -4.6 6.6 L 4.6 3.4" fill="none" stroke-width="3"/>',
    flat: '<path d="M -3 -18 V 5 M -3 -5 C 1 -9 7 -5 4 0 C 2 3 -1 4 -3 5" fill="none" stroke-width="1.8"/>',
    natural: '<path d="M -2.4 -12 V 5 M 2.4 -5 V 12" fill="none" stroke-width="1.3"/><path d="M -2.4 -3 L 2.4 -5 M -2.4 6 L 2.4 4" fill="none" stroke-width="2.6"/>',
    flag: '<path d="M 0 0 C 1 8 12 10 9 23 C 11 14 6 11 0 11 Z" stroke="none"/>',
    restW: '<rect x="-6" y="-10" width="12" height="4.5" stroke="none"/>',
    restH: '<rect x="-6" y="-4.5" width="12" height="4.5" stroke="none"/>',
    restQ: '<path d="M -3 -14 L 3 -7 L -3 0 L 3 7 C -3 5 -5 9 -1 14" fill="none" stroke-width="2.8"/>',
    restE: '<path d="M 3.5 -7 L -1.5 10 M 3.5 -7 C 3 -3 -1 -2 -2 -5" fill="none" stroke-width="1.8"/><circle cx="-2.2" cy="-5.5" r="2.2" stroke="none"/>',
    restS: '<path d="M 4 -7 L -3 14 M 4 -7 C 3.5 -3 -0.5 -2 -1.5 -5 M 1.8 1 C 1.3 5 -2.7 6 -3.7 3" fill="none" stroke-width="1.8"/><circle cx="-1.7" cy="-5.5" r="2.2" stroke="none"/><circle cx="-3.9" cy="2.5" r="2.2" stroke="none"/>',
  };
  // a rhythm slash on the middle line, for a note whose pitch is not named yet: filled for a
  // quarter and shorter, open for a half or a whole, as a head would be
  GLYPH.slash = '<path d="M -8.5 8 L -2.5 8 L 8.5 -8 L 2.5 -8 Z" stroke="none"/>';
  GLYPH.slashOpen = '<path d="M -8.5 8 L -2.5 8 L 8.5 -8 L 2.5 -8 Z" fill="none" stroke-width="1.6"/>';
  // a double sharp is a cross, a double flat two flats: a chord spelled from its root can need them
  GLYPH.dsharp = '<path d="M -4.2 -4.2 L 4.2 4.2 M -4.2 4.2 L 4.2 -4.2" fill="none" stroke-width="2.8"/>';
  GLYPH.dflat = `<g transform="translate(-8 0)">${GLYPH.flat}</g>${GLYPH.flat}`; // the right flat where a single one sits
  const ACC = { 2: 'dsharp', 1: 'sharp', '-1': 'flat', '-2': 'dflat', 0: 'natural' };
  // each accidental's box around where it is placed: left, right, top, bottom
  const ACC_BOX = { sharp: [-4.6, 4.6, -13, 13], flat: [-3, 5.5, -18, 5], natural: [-2.4, 2.4, -12, 12], dflat: [-11, 5.5, -18, 5], dsharp: [-4.2, 4.2, -4.2, 4.2] };
  // A chord's accidentals, from the top note down, each as close to the heads as it can go without
  // touching one already placed: the usual stagger. x is relative to the heads' centre.
  function placeAccidentals(heads, yOf, shift) {
    const placed = [];
    for (const h of heads.slice().reverse()) {
      if (!h.shown) continue;
      const g = ACC[h.acc], [l, r, t, b] = ACC_BOX[g], y = yOf(h.step);
      let ax = -6.5 - shift - r - 1; // its right edge a unit short of the heads' left edge
      while (placed.some((p) => ax + l < p.ax + p.r + 1 && ax + r + 1 > p.ax + p.l && y + t < p.y + p.b && y + b > p.y + p.t)) ax -= 1;
      placed.push({ ax, y, l, r, t, b, g, h });
    }
    return placed;
  }
  const head = (kind) => (kind === 'w' ? '<ellipse rx="7" ry="4.6" fill="none" stroke-width="2.4"/>' : `<ellipse rx="6.3" ry="4.4" transform="rotate(-22)"${kind === 'h' ? ' fill="none" stroke-width="2"' : ' stroke="none"'}/>`);
  const restGlyph = (kind, flags) => GLYPH[kind === 'w' ? 'restW' : kind === 'h' ? 'restH' : flags === 2 ? 'restS' : flags ? 'restE' : 'restQ'];
  const flags = (x, tip, n, up) => { let s = ''; for (let f = 0; f < n; f++) s += at(x, tip + (up ? 7 : -7) * f, up ? GLYPH.flag : `<g transform="scale(1 -1)">${GLYPH.flag}</g>`); return s; };

  // a time signature's bar and beat in ticks: a compound meter (6/8, 9/8, 12/8) beats in dotted
  // quarters, the rest in their lower number's value
  function meterOf(time) {
    const [num = '4', den = '4'] = String(time).split('/'), unit = 48 / (Number(den) || 4);
    return { num, den, bar: Number(num) * unit, beat: den === '8' && num % 3 === 0 && num > 3 ? 18 : unit };
  }

  // The width asked for is the viewBox width; a layout that needs more is scaled down to fit.
  const wrap = (W, H, px, body) => `<svg xmlns="http://www.w3.org/2000/svg" class="notation" viewBox="0 0 ${r1(W)} ${r1(H)}" width="${px}" height="${r1((H * px) / W)}" style="max-width:100%;height:auto" role="img"><g fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
  // spread the notes over the room there is, up to a limit so two notes do not sit a mile apart
  const stretch = (room, natural) => Math.min(2.4, Math.max(1, room / Math.max(1, natural)));

  // For a staff used as a control: where the notes go on an even grid after the signature, as
  // fractions of the drawing's width, so buttons can sit over them. The staff drawn with
  // grid: true places its notes the same way.
  function gridBox(key, px) {
    const sig = keySignature(key || { tonic: 0, mode: 'major' }), nSig = sig.sharps || sig.flats || 0;
    const W = px / 0.8, x = 8 + 34 + nSig * 9 + (nSig ? 8 : 0) + 6;
    return { W, x, left: x / W, right: (W - 8) / W };
  }

  // ---------- a staff ----------
  // notes: [{ midi, dur, rest, tie }] or chords [{ midis, dur }], dur in quarter-note beats
  // sig: false draws no signature, so every sharp or flat is written on its note (an interval or a
  // chord with no key). A note may carry its own letter (index 0..6) and is then spelled on it.
  // time: '4/4', '3/4', '6/8'... drawn after the signature; it sets the bar (unless bars does) and
  // the beat (unless beat does, in ticks: a system that goes on from one with the time signature
  // keeps its beat without drawing it again). beam: flagged notes in one beat share a beam. A note
  // may be a slash (its rhythm, no pitch yet), a blank (an empty beat) or under (ruled beneath: its
  // length was wrong).
  function staff(o = {}) {
    const key = o.key || { tonic: 0, mode: 'major' }, notes = o.notes || [], px = o.width || 600, U = o.compact ? 0.6 : 0.8;
    const sig = o.sig === false ? {} : keySignature(key), nSig = sig.sharps || sig.flats || 0;
    const sounding = notes.flatMap((n) => (n.rest || n.slash || n.blank ? [] : n.midis || [n.midi])).sort((a, b) => a - b);
    const clef = MIDSTEP[o.clef] ? o.clef : sounding.length && sounding[sounding.length >> 1] < 60 ? 'bass' : 'treble'; // auto never picks treble8
    const MID = MIDSTEP[clef];
    const yOf = (step) => 20 - (step - MID) * 5; // from the top line; a step is half a space
    const hl = new Set(o.highlight || []);
    const meter = o.time ? meterOf(o.time) : null, perBar = o.bars || (meter ? meter.bar / 12 : 0), beat = o.beat || (meter ? meter.beat : 12);

    // an accidental holds for its letter and octave until another note on it says otherwise, or a bar line
    let active = {}, beats = 0, tick = 0;
    const spellOn = (m, L) => { const acc = accFor(L, TL.mod12(m)); return { letter: LETTERS[L], acc, octave: Math.floor((m - acc) / 12) - 1 }; };
    const items = notes.map((n) => {
      const t = Math.round((n.dur || 1) * 12), [kind, fl, dots] = shapeOf(t);
      if (perBar && beats && Math.abs(beats / perBar - Math.round(beats / perBar)) < 1e-6) active = {};
      beats += n.dur || 1;
      const letters = n.letters || (n.letter != null ? [n.letter] : null);
      // a slash stands on the middle line and is spelled as nothing; a blank has no head at all
      const heads = n.rest || n.blank ? [] : n.slash ? [{ step: MID, acc: 0, shown: false }] : (n.midis || [n.midi]).map((m, i) => {
        const s = letters && letters[i] != null ? spellOn(m, letters[i]) : spell(m, key);
        const k = s.letter + s.octave, was = k in active ? active[k] : sigAcc(sig, s.letter);
        active[k] = s.acc;
        return { ...s, step: stepOf(s), shown: s.acc !== was };
      }).sort((a, b) => a.step - b.step);
      const up = !!n.slash || !heads.length || (heads[0].step + heads[heads.length - 1].step) / 2 < MID; // slashes stem up, as rhythm is written
      const it = { n, kind, fl, dots, heads, up, t, tick, tie: n.tie };
      tick += t;
      return it;
    });
    // Flagged notes in one beat with no rest between them share a beam and a stem direction: the
    // note farthest from the middle line decides, then the majority. A slash has no say.
    const groups = [];
    const beamable = (k) => items[k].heads.length && items[k].fl, beatOf = (k) => Math.floor(items[k].tick / beat);
    if (o.beam) for (let i = 0; i < items.length;) {
      if (!beamable(i)) { i++; continue; }
      let j = i;
      while (j + 1 < items.length && beamable(j + 1) && beatOf(j + 1) === beatOf(i)) j++;
      if (j > i) groups.push({ i, j });
      i = j + 1;
    }
    for (const gr of groups) {
      const its = items.slice(gr.i, gr.j + 1), named = its.filter((it) => !it.n.slash);
      const steps = named.flatMap((it) => it.heads.map((h) => h.step));
      const above = Math.max(...steps) - MID, below = MID - Math.min(...steps), votes = named.reduce((a, it) => a + (it.up ? 1 : -1), 0);
      gr.up = !named.length || below > above || (below === above && votes > 0);
      // a level beam, just past the stem that has to reach farthest
      const tips = its.map((it) => (gr.up ? Math.min(yOf(it.heads[it.heads.length - 1].step) - 35, 20) : Math.max(yOf(it.heads[0].step) + 35, 20)));
      gr.tip = gr.up ? Math.min(...tips) - 3 : Math.max(...tips) + 3;
      for (const it of its) { it.up = gr.up; it.tip = gr.tip; }
    }
    for (const it of items) {
      const { heads } = it;
      // stems down, a second puts its lower head left of the stem: the accidentals go further left
      it.shift = !it.up && heads.some((h, k) => k && h.step - heads[k - 1].step === 1) ? 11 : 0;
      it.accs = placeAccidentals(heads, yOf, it.shift);
      it.lead = Math.max(6 + it.shift, it.accs.length ? Math.ceil(-Math.min(...it.accs.map((p) => p.ax + p.l))) + 1 : 0);
      it.w = slot(it.t) + it.lead - 6 + (it.dots ? 5 : 0);
    }
    // room above and below the staff for whatever sticks out: ledger lines, stems, the clef
    let top = -28, bottom = clef === 'treble8' ? 74 : 68; // room for the 8 under the clef
    for (const it of items) if (it.heads.length) {
      const hi = yOf(it.heads[it.heads.length - 1].step), lo = yOf(it.heads[0].step);
      top = Math.min(top, hi - (it.up ? 38 : 8)); bottom = Math.max(bottom, lo + (it.up ? 8 : 38));
      for (const h of it.heads) if (h.shown) { top = Math.min(top, yOf(h.step) - 20); bottom = Math.max(bottom, yOf(h.step) + 15); } // a flat reaches well above its head
    }
    // a beam can sit past the stems it joins, and a triplet's 3 past the beam
    for (const gr of groups) { const pad = items[gr.i].t === 4 ? 16 : 4; if (gr.up) top = Math.min(top, gr.tip - pad); else bottom = Math.max(bottom, gr.tip + pad); }
    // a wrong length is ruled under its note, on one line for the staff, clear of everything drawn
    let ruleY = 0;
    if (items.some((it) => it.n.under)) {
      ruleY = 46;
      for (const it of items) if (it.heads.length) {
        const lo = yOf(it.heads[0].step), stemTip = it.tip != null ? it.tip : Math.max(lo + 35, 20);
        ruleY = Math.max(ruleY, lo + 10, !it.up && it.kind !== 'w' ? stemTip + 6 : 0, ...it.accs.map((p) => p.y + p.b + 4));
      }
      bottom = Math.max(bottom, ruleY + 6);
    }
    const chordRow = o.chords && o.chords.length ? 18 : 0, lyricRow = o.lyrics && o.lyrics.some(Boolean) ? 20 : 0;
    const sTop = chordRow - top, H = sTop + bottom + lyricRow;
    const under = (x1, x2) => ln(x1, sTop + ruleY, x2, sTop + ruleY, 2, 'under');

    // horizontal layout: clef, signature, time, then the notes spread over the width, bar lines between
    const x0 = 8;
    const sigX = x0 + 34;
    let x = sigX + nSig * 9 + (nSig ? 8 : 0) + 6;
    // the time signature's numbers stand one over the other, each filling two spaces
    const timeX = sigX + nSig * 9 + (nSig ? 8 : 5), timeW = meter ? 18 * Math.max(meter.num.length, meter.den.length) : 0;
    if (meter) x = timeX + timeW + 12;
    const cuts = [];
    if (perBar) { let beats = 0; items.forEach((it, i) => { beats += it.n.dur || 1; if (i < items.length - 1 && Math.abs(beats / perBar - Math.round(beats / perBar)) < 1e-6) cuts.push(i); }); }
    const natural = items.reduce((a, it) => a + it.w, 0) + cuts.length * 10;
    const W = o.grid ? px / U : Math.max(px / U, x + natural + 14), gain = stretch(W - x - 14, natural);
    const bars = [];
    // each note's room, from where it starts to where the next begins, is where a blank's box goes
    if (o.grid) { const span = (W - 8 - x) / Math.max(1, items.length); items.forEach((it, i) => { it.x = x + span * (i + 0.5); it.from = it.x - span / 2; it.to = it.x + span / 2; }); }
    else items.forEach((it, i) => { it.from = x; it.x = x + it.lead; x += it.w * gain; it.to = x; if (cuts.includes(i)) { bars.push(x + 3); x += 10; } });
    const complete = perBar && items.length && Math.abs(items.reduce((a, it) => a + (it.n.dur || 1), 0) / perBar % 1) < 1e-6;
    if (complete) bars.push(W - 8);

    const parts = [];
    for (let i = 0; i < 5; i++) parts.push(ln(x0, sTop + i * 10, W - 8, sTop + i * 10, 1));
    for (const bx of bars) parts.push(ln(bx, sTop, bx, sTop + 40, 1.3, 'bar'));
    parts.push(at(x0 + CLEF_X[clef], sTop + CLEF_Y[clef], GLYPH[clef === 'treble8' ? 'treble' : clef], 'clef'));
    if (clef === 'treble8') parts.push(text(x0 + CLEF_X.treble8 + 1, sTop + CLEF_Y.treble8 + 40, '8', 11, 'clef8'));
    for (let k = 0; k < nSig; k++) parts.push(at(sigX + 4 + k * 9, sTop + yOf(SIG_STEPS[sig.sharps ? 'sharps' : 'flats'][k] - SIG_DROP[clef]), GLYPH[sig.sharps ? 'sharp' : 'flat'], 'sig'));
    if (meter) for (const [s, y] of [[meter.num, 20], [meter.den, 40]]) parts.push(text(timeX + timeW / 2, sTop + y, s, 28, 'time', ' font-weight="bold"'));

    items.forEach((it, i) => {
      const { heads, up, x, kind } = it, cls = (it.n.blank ? 'blank' : it.heads.length ? 'note' : 'rest') + (it.n.slash ? ' slash' : '') + (hl.has(i) ? ' hl' : '');
      let s = '';
      if (it.n.blank) {
        s += `<rect x="${r1(it.from + 3)}" y="${r1(sTop + 3)}" width="${r1(it.to - it.from - 6)}" height="34" rx="3" fill="none" stroke-width="1.2" stroke-dasharray="3 3"/>`;
        if (it.n.under) s += under(it.from + 3, it.to - 3);
        parts.push(`<g class="${cls}">${s}</g>`);
        return;
      }
      if (!heads.length) {
        s += at(x, sTop + 20, restGlyph(kind, it.fl));
        if (it.dots) s += dot(x + 9, sTop + 15);
        if (it.n.under) s += under(x - 8, x + 8 + (it.dots ? 6 : 0));
        parts.push(`<g class="${cls}">${s}</g>`);
        return;
      }
      const yh = (h) => sTop + yOf(h.step);
      // a second's upper head sits across the stem (stems up), or its lower head does (stems down)
      const order = up ? heads : heads.slice().reverse();
      order.forEach((h, k) => { h.dx = k && Math.abs(h.step - order[k - 1].step) === 1 && !order[k - 1].dx ? (up ? 11 : -11) : 0; });
      // ledger lines, from the staff out to the farthest head, wide enough for a head beside the stem
      const ledger = new Set();
      for (const h of heads) for (let st = h.step > MID ? MID + 6 : MID - 6; h.step > MID ? st <= h.step : st >= h.step; st += h.step > MID ? 2 : -2) ledger.add(st);
      const dxs = heads.map((h) => h.dx);
      for (const st of ledger) s += ln(x - 10 + Math.min(0, ...dxs), sTop + yOf(st), x + 10 + Math.max(0, ...dxs), sTop + yOf(st), 1.3, 'ledger');
      for (const p of it.accs) s += at(x + p.ax, yh(p.h), GLYPH[p.g], 'acc');
      for (const h of heads) {
        s += at(x + h.dx, yh(h), it.n.slash ? GLYPH[kind === 'q' ? 'slash' : 'slashOpen'] : head(kind), 'head');
        if (it.dots) s += dot(x + (it.n.slash ? 11 : 9) + Math.max(0, h.dx), yh(h) - ((h.step - MID) % 2 ? 0 : 5)); // a dot on a line moves up into the space
      }
      if (kind !== 'w') {
        const sx = x + (up ? 5.5 : -5.5), yTop = yh(heads[heads.length - 1]), yBot = yh(heads[0]);
        // a stem reaches at least the middle line, or its beam; a slash's starts where it meets the slash
        const tip = it.tip != null ? sTop + it.tip : up ? Math.min(yTop - 35, sTop + 20) : Math.max(yBot + 35, sTop + 20);
        s += ln(sx, (up ? yBot : yTop) + (it.n.slash ? (up ? -4 : 4) : 0), sx, tip, 1.4) + (it.tip != null ? '' : flags(sx, tip, it.fl, up));
      }
      const next = items[i + 1];
      if (it.tie && next && next.heads.length) for (const h of heads) {
        const to = next.heads.find((k) => k.step === h.step) || next.heads[0];
        s += tie(x + 6, next.x - 6, (yh(h) + yh(to)) / 2 + (up ? 6 : -6), up ? 1 : -1);
      }
      if (it.n.under) s += under(x - 8 + Math.min(0, ...dxs), x + 8 + Math.max(0, ...dxs) + (it.dots ? 6 : 0));
      parts.push(`<g class="${cls}">${s}</g>`);
    });
    for (const gr of groups) {
      // the beam's outer edge is at the tip; a second beam joins neighbouring sixteenths, and a
      // lone sixteenth gets a stub toward its group
      const sx = (k) => items[k].x + (gr.up ? 5.5 : -5.5), y = sTop + gr.tip - (gr.up ? 0 : 5), y2 = y + (gr.up ? 8 : -8);
      parts.push(beam(sx(gr.i), sx(gr.j), y));
      for (let k = gr.i; k <= gr.j; k++) {
        if (items[k].fl < 2) continue;
        if (k < gr.j && items[k + 1].fl >= 2) parts.push(beam(sx(k), sx(k + 1), y2));
        else if (!(k > gr.i && items[k - 1].fl >= 2)) parts.push(k > gr.i ? beam(sx(k) - 8, sx(k), y2) : beam(sx(k), sx(k) + 8, y2));
      }
      if (items[gr.i].t === 4) parts.push(text((sx(gr.i) + sx(gr.j)) / 2, gr.up ? y - 4 : y + 17, '3', 11, 'tuplet'));
    }
    for (const c of o.chords || []) if (items[c.at]) parts.push(text(items[c.at].x, 14, c.text, 14, 'chord'));
    (o.lyrics || []).forEach((w, i) => { if (items[i] && w) parts.push(text(items[i].x, H - 5, w, 14, 'lyric')); });
    return wrap(W, H, px, parts.join(''));
  }

  // ---------- a rhythm on one line ----------
  // rhythm: the app's own object, { ticks, meter, bars, barTicks, beat }; ticks are quarter = 12,
  // negative for a rest (see RCELLS and genRhythm in theory.js)
  function rhythm(o = {}) {
    const r = o.rhythm, px = o.width || 600, U = 0.8;
    const [barTicks, beat] = r.barTicks && r.beat ? [r.barTicks, r.beat] : TL.METERS[r.meter] || TL.METERS['4/4'];
    // one event per sound or silence; a note that starts off the beat and runs past the next
    // beat line is split there and tied, so the learner sees which beat it crosses
    const ev = [];
    let pos = 0;
    for (const t of r.ticks) {
      const len = Math.abs(t), end = pos + len;
      if (t < 0) ev.push({ rest: true, tick: pos, len });
      for (let a = pos; t > 0 && a < end;) {
        const b = a % beat ? Math.min(a - (a % beat) + beat, end) : end;
        ev.push({ tick: a, len: b - a, tie: b < end });
        a = b;
      }
      pos = end;
    }
    for (const e of ev) { [e.kind, e.fl, e.dots] = shapeOf(e.len); e.w = slot(e.len) + (e.dots ? 5 : 0); e.bar = Math.floor(e.tick / barTicks); e.group = Math.floor(e.tick / beat); }
    // eighths and shorter that share a beat are beamed together; a rest breaks the beam
    const beams = [];
    for (let i = 0; i < ev.length;) {
      if (ev[i].rest || !ev[i].fl) { i++; continue; }
      let j = i;
      while (j + 1 < ev.length && !ev[j + 1].rest && ev[j + 1].fl && ev[j + 1].group === ev[i].group) j++;
      if (j > i) beams.push([i, j]);
      i = j + 1;
    }
    const beamed = new Set(beams.flatMap(([i, j]) => Array.from({ length: j - i + 1 }, (_, k) => i + k)));

    const x0 = 8, L = 52, H = 78;
    let x = x0 + (o.bare ? 0 : 26); // past the time signature
    const nBars = Math.max(1, Math.ceil(pos / barTicks));
    const natural = ev.reduce((a, e) => a + e.w, 0) + (nBars - 1) * 10;
    const W = Math.max(px / U, x + natural + 14);
    // bare is a figure on its own (on a button): no time signature, no bar lines, and drawn at its
    // own spacing with its first and last heads centred in the width
    const gain = o.bare ? 1 : stretch(W - x - 14, natural);
    if (o.bare && ev.length) x = Math.max(x0, (W - (natural - ev[ev.length - 1].w)) / 2 - 7);
    const bars = [];
    ev.forEach((e, i) => { if (i && e.bar !== ev[i - 1].bar) { bars.push(x + 3); x += 10; } e.x = x + 7; x += e.w * gain; });
    bars.push(W - 8);

    const [num, den] = String(r.meter || '4/4').split('/');
    const parts = [ln(x0, L, W - 8, L, 1)];
    if (!o.bare) {
      parts.push(text(x0 + 11, L - 2, num, 16, 'time', ' font-weight="bold"'), text(x0 + 11, L + 14, den, 16, 'time', ' font-weight="bold"'));
      for (const bx of bars) parts.push(ln(bx, L - 14, bx, L + 14, 1.3, 'bar'));
    }
    ev.forEach((e, i) => {
      if (e.rest) { parts.push(`<g class="rest">${at(e.x, L + (e.kind === 'w' ? 10 : 0), restGlyph(e.kind, e.fl))}${e.dots ? dot(e.x + 9, L - 5) : ''}</g>`); return; }
      const sx = e.x + 5.5, tip = beamed.has(i) ? L - 38 : L - 35;
      let s = at(e.x, L, head(e.kind), 'head');
      if (e.dots) s += dot(e.x + 9, L - 5);
      if (e.kind !== 'w') s += ln(sx, L, sx, tip, 1.4);
      if (!beamed.has(i)) s += flags(sx, tip, e.fl, true);
      if (e.tie && ev[i + 1]) s += tie(e.x + 6, ev[i + 1].x - 6, L + 6, 1);
      parts.push(`<g class="note">${s}</g>`);
    });
    for (const [i, j] of beams) {
      const sx = (k) => ev[k].x + 5.5;
      parts.push(beam(sx(i), sx(j), L - 38));
      // the second beam of sixteenths runs between neighbours; a lone sixteenth gets a stub toward its group
      for (let k = i; k <= j; k++) {
        if (ev[k].fl < 2) continue;
        if (k < j && ev[k + 1].fl >= 2) parts.push(beam(sx(k), sx(k + 1), L - 30));
        else if (!(k > i && ev[k - 1].fl >= 2)) parts.push(k > i ? beam(sx(k) - 8, sx(k), L - 30) : beam(sx(k), sx(k) + 8, L - 30));
      }
      if (ev[i].len === 4) parts.push(text((sx(i) + sx(j)) / 2, L - 42, '3', 11, 'tuplet'));
    }
    return wrap(W, H, px, parts.join(''));
  }

  TL.Notation = { spell, keySignature, chordLetters, intervalLetters, staff, rhythm, gridBox };
  if (typeof module !== 'undefined') module.exports = TL.Notation;
})(typeof window !== 'undefined' ? window : globalThis);
