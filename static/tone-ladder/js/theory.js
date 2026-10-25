/* Tone Ladder — music theory: pitches, degrees, intervals, chords, voice leading,
   melody and rhythm generators. Pure functions, no DOM or audio. */
(function (g) {
  const TL = g.TL || (g.TL = {});

  // ---------- small random helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function weightedPick(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const [, w] of entries) total += Math.max(0, w);
    if (total <= 0) return entries.length ? entries[0][0] : undefined;
    let r = Math.random() * total;
    for (const [v, w] of entries) {
      r -= Math.max(0, w);
      if (r <= 0) return v;
    }
    return entries[entries.length - 1][0];
  }
  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }
  const mod12 = (n) => ((n % 12) + 12) % 12;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const MINOR_KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
  const keyName = (tonicMidi, mode) =>
    (mode === 'minor' ? MINOR_KEY_NAMES : KEY_NAMES)[mod12(tonicMidi)] + (mode === 'minor' ? ' minor' : ' major');

  // ---------- scale degrees (movable do, do-based minor) ----------
  // hue: the degree's color on the tone ladder; chromatic degrees sit between their neighbours.
  const DEGREES = [
    { id: '1', semi: 0, sol: 'Do', num: '1', hue: 25, diatonic: true },
    { id: 'b2', semi: 1, sol: 'Ra', num: '♭2', hue: 40, diatonic: false },
    { id: '2', semi: 2, sol: 'Re', num: '2', hue: 58, diatonic: true },
    { id: 'b3', semi: 3, sol: 'Me', num: '♭3', hue: 74, diatonic: false },
    { id: '3', semi: 4, sol: 'Mi', num: '3', hue: 92, diatonic: true },
    { id: '4', semi: 5, sol: 'Fa', num: '4', hue: 145, diatonic: true },
    { id: '#4', semi: 6, sol: 'Fi', num: '♯4', hue: 170, diatonic: false },
    { id: '5', semi: 7, sol: 'Sol', num: '5', hue: 195, diatonic: true },
    { id: 'b6', semi: 8, sol: 'Le', num: '♭6', hue: 225, diatonic: false },
    { id: '6', semi: 9, sol: 'La', num: '6', hue: 255, diatonic: true },
    { id: 'b7', semi: 10, sol: 'Te', num: '♭7', hue: 280, diatonic: false },
    { id: '7', semi: 11, sol: 'Ti', num: '7', hue: 305, diatonic: true },
  ];
  const DEG = Object.fromEntries(DEGREES.map((d) => [d.id, d]));
  const degBySemi = (semi) => DEGREES[mod12(semi)];

  // In minor (do-based), b3 b6 b7 are the "home" versions; mark which ids are native per mode.
  const MODE_SCALE = {
    major: ['1', '2', '3', '4', '5', '6', '7'],
    minor: ['1', '2', 'b3', '4', '5', 'b6', 'b7'],
  };

  // Each degree resolves stepwise to the nearest Do (Benbassat-style resolution).
  // Values are semitones from Do; 12 = the Do above.
  const RESOLVE = {
    major: {
      0: [0], 1: [1, 0], 2: [2, 0], 3: [3, 2, 0], 4: [4, 2, 0], 5: [5, 4, 2, 0],
      6: [6, 7, 9, 11, 12], 7: [7, 9, 11, 12], 8: [8, 7, 5, 4, 2, 0], 9: [9, 11, 12], 10: [10, 12], 11: [11, 12],
    },
    minor: {
      0: [0], 1: [1, 0], 2: [2, 0], 3: [3, 2, 0], 4: [4, 2, 0], 5: [5, 3, 2, 0],
      6: [6, 7, 8, 10, 12], 7: [7, 8, 10, 12], 8: [8, 10, 12], 9: [9, 11, 12], 10: [10, 12], 11: [11, 12],
    },
  };
  function resolutionPath(semiAbs, mode) {
    const oct = Math.floor(semiAbs / 12);
    const pc = semiAbs - oct * 12;
    return RESOLVE[mode === 'minor' ? 'minor' : 'major'][pc].map((p) => p + oct * 12);
  }

  // ---------- cadence (I–IV–V7–I with smooth voice leading), offsets from tonic ----------
  const CADENCE = {
    major: [[-12, 4, 7, 12], [-7, 5, 9, 12], [-5, 5, 7, 11], [-12, 4, 7, 12]],
    minor: [[-12, 3, 7, 12], [-7, 5, 8, 12], [-5, 5, 7, 11], [-12, 3, 7, 12]],
  };
  function cadenceEvents(tonic, mode, start = 0, beat = 0.62) {
    const ch = CADENCE[mode === 'minor' ? 'minor' : 'major'];
    return ch.map((c, i) => ({
      t: start + i * beat,
      notes: c.map((o) => tonic + o),
      dur: i === ch.length - 1 ? beat * 1.7 : beat * 0.95,
      vel: 0.55,
      role: 'context',
    }));
  }
  const cadenceLength = (beat = 0.62) => beat * 3 + beat * 1.7;

  // ---------- intervals ----------
  // plain: how to find it by counting scale notes from the low note (shown on intro cards).
  const INTERVALS = [
    { id: 'm2', semi: 1, short: 'm2', name: 'Minor 2nd', deg: 'Ti → High Do, Mi → Fa', up: 'Jaws', down: 'Für Elise', plain: 'The smallest step: one half step, the very next key on a piano. Mi up to Fa and Ti up to High Do are minor 2nds.' },
    { id: 'M2', semi: 2, short: 'M2', name: 'Major 2nd', deg: 'Do → Re', up: 'Happy Birthday (“-py birth-”)', down: 'Mary Had a Little Lamb', plain: 'Count two scale notes: Do, Re. It is the next note up.' },
    { id: 'm3', semi: 3, short: 'm3', name: 'Minor 3rd', deg: 'Mi → Sol, La → High Do', up: 'Greensleeves (“A-las”)', down: 'Hey Jude', plain: 'Like a major 3rd (Do, Re, Mi), but the top note is one half step lower, so it sounds darker. A half step is the very next key on a piano. Mi up to Sol and La up to High Do are minor 3rds too.' },
    { id: 'M3', semi: 4, short: 'M3', name: 'Major 3rd', deg: 'Do → Mi', up: 'When the Saints Go Marching In (“Oh when”)', down: 'Swing Low, Sweet Chariot', plain: 'Count three scale notes from the low note: Do, Re, Mi. If the low note is Do, the high note is Mi.' },
    { id: 'P4', semi: 5, short: 'P4', name: 'Perfect 4th', deg: 'Sol → High Do, Do → Fa', up: 'Here Comes the Bride (“Here comes”)', down: 'Eine kleine Nachtmusik', plain: 'Count four scale notes from the low note: Do, Re, Mi, Fa. Sol up to High Do is a 4th too.' },
    { id: 'TT', semi: 6, short: 'TT', name: 'Tritone', deg: 'Fa → Ti', up: 'Maria (West Side Story)', down: '', plain: 'Halfway to the octave, between a 4th and a 5th. Fa up to Ti is a tritone. It sounds restless.' },
    { id: 'P5', semi: 7, short: 'P5', name: 'Perfect 5th', deg: 'Do → Sol', up: 'Twinkle, Twinkle, Little Star (the jump from the first “twinkle” to the second)', down: 'The Flintstones theme', plain: 'Count five scale notes from the low note: Do, Re, Mi, Fa, Sol.' },
    { id: 'm6', semi: 8, short: 'm6', name: 'Minor 6th', deg: 'Mi → High Do', up: 'The Entertainer (3rd–4th notes)', down: '', plain: 'Like a major 6th (Do up to La), but the top note is one half step lower. Mi up to High Do is a minor 6th.' },
    { id: 'M6', semi: 9, short: 'M6', name: 'Major 6th', deg: 'Do → La, Sol → Mi', up: 'My Bonnie Lies Over the Ocean', down: 'Nobody Knows the Trouble I’ve Seen', plain: 'Count six scale notes from the low note: Do, Re, Mi, Fa, Sol, La.' },
    { id: 'm7', semi: 10, short: 'm7', name: 'Minor 7th', deg: 'Sol → Fa', up: 'Somewhere (West Side Story)', down: '', plain: 'Like a major 7th (Do up to Ti), but one half step lower: a whole step short of the octave. Sol up to the Fa above is a minor 7th.' },
    { id: 'M7', semi: 11, short: 'M7', name: 'Major 7th', deg: 'Do → Ti', up: '', down: '', plain: 'Count seven scale notes from the low note: Do up to Ti. It sits one half step short of the octave.' },
    { id: 'P8', semi: 12, short: 'P8', name: 'Octave', deg: 'Do → High Do', up: 'Somewhere Over the Rainbow (“Some-where”)', down: '', plain: 'Count eight scale notes, from Do up to High Do: the same note name, higher.' },
  ];
  const IV = Object.fromEntries(INTERVALS.map((i) => [i.id, i]));

  // ---------- chord qualities ----------
  // feel: what it sounds like. build: how it differs from a simpler chord (shown on intro cards).
  const CHORD_TYPES = {
    maj: { name: 'Major', sym: '', tones: [0, 4, 7], feel: 'Bright and settled. The sound most people hear as happy.' },
    min: { name: 'Minor', sym: 'm', tones: [0, 3, 7], feel: 'Darker and sadder than major, but still settled. A piece can end on it.', build: 'Like major, but the middle of the three notes is one half step lower.' },
    dim: { name: 'Diminished', sym: '°', tones: [0, 3, 6], feel: 'Tense and narrow. It wants to move on to another chord.', build: 'A minor chord with its top note one half step lower.' },
    aug: { name: 'Augmented', sym: '+', tones: [0, 4, 8], feel: 'Dreamy and unsettled, like a question left open.', build: 'A major chord with its top note one half step higher.' },
    maj7: { name: 'Major 7', sym: 'maj7', tones: [0, 4, 7, 11], feel: 'Lush and soft-focus.', build: 'A major chord with a fourth note on top that rubs gently against the bottom one.' },
    dom7: { name: 'Dominant 7', sym: '7', tones: [0, 4, 7, 10], feel: 'Bluesy and restless. It pulls the music onward.', build: 'A major chord with a fourth note on top, one half step lower than in Major 7. Over a major chord it sounds restless.' },
    min7: { name: 'Minor 7', sym: 'm7', tones: [0, 3, 7, 10], feel: 'Mellow and soulful; calmer than dominant 7.', build: 'A minor chord with the same added note as Dominant 7. Over a minor chord it sounds mellow.' },
    m7b5: { name: 'Half-diminished', sym: 'ø7', tones: [0, 3, 6, 10], feel: 'Dark and searching.', build: 'A diminished chord with a fourth note on top.' },
    dim7: { name: 'Diminished 7', sym: '°7', tones: [0, 3, 6, 9], feel: 'Maximum tension, evenly stacked. The shiver of a silent-film villain.', build: 'A diminished chord with one more note, the same distance up again.' },
    mmaj7: { name: 'Minor-major 7', sym: 'm(maj7)', tones: [0, 3, 7, 11], feel: 'Noir and mysterious.', build: 'A minor chord with a bright, rubbing note on top.' },
    sus2: { name: 'Sus 2', sym: 'sus2', tones: [0, 2, 7], feel: 'Open and airy. Neither major nor minor.', build: 'The middle note of a major chord moved down to the next scale note.' },
    sus4: { name: 'Sus 4', sym: 'sus4', tones: [0, 5, 7], feel: 'Suspended: it wants to settle into major.', build: 'The middle note of a major chord pushed up to the next scale note.' },
    add9: { name: 'Add 9', sym: 'add9', tones: [0, 4, 7, 14], feel: 'Shimmering major.', build: 'A major chord with an extra high note sparkling on top.' },
    maj6: { name: 'Major 6', sym: '6', tones: [0, 4, 7, 9], feel: 'Sweet and vintage; the final chord of a swing tune.', build: 'A major chord with an added note just above its top.' },
    min6: { name: 'Minor 6', sym: 'm6', tones: [0, 3, 7, 9], feel: 'Bittersweet, a little cinematic.', build: 'A minor chord with an added note just above its top.' },
  };

  function chordVoicing(root, quality, inversion = 0, doubleBass = true) {
    const tones = CHORD_TYPES[quality].tones.slice();
    const t = tones.map((x) => x);
    for (let k = 0; k < inversion; k++) t[k] += 12;
    t.sort((a, b) => a - b);
    const notes = t.map((x) => root + x);
    if (doubleBass) notes.unshift(notes[0] - 12);
    return notes;
  }

  // ---------- Roman numerals ----------
  const RN = {
    I: { root: 0, q: 'maj', fn: 'T', desc: 'The home chord, built on Do. Music comes to rest here. Its classic name is the tonic.' },
    ii: { root: 2, q: 'min', fn: 'PD', desc: 'The minor chord built on Re. Soft, and it leads toward V.' },
    iii: { root: 4, q: 'min', fn: 'T', desc: 'The minor chord built on Mi. Hazy; it shares two notes with I.' },
    IV: { root: 5, q: 'maj', fn: 'PD', desc: 'The major chord built on Fa. Open and lifting; the “amen” at the end of a hymn.' },
    V: { root: 7, q: 'maj', fn: 'D', desc: 'Built on Sol. It sounds unfinished and pulls back to I. Its classic name is the dominant.' },
    vi: { root: 9, q: 'min', fn: 'T', desc: 'The minor chord built on La. The darker twin of I.' },
    'vii°': { root: 11, q: 'dim', fn: 'D', desc: 'The diminished chord built on Ti. Tense and compact; it pulls to I the way V does.' },
    V7: { root: 7, q: 'dom7', fn: 'D', desc: 'V with Fa added on top. The strongest pull back to I.' },
    I6: { root: 0, q: 'maj', inv: 1, fn: 'T', desc: 'I with Mi in the bass instead of Do. Lighter, still home.' },
    V6: { root: 7, q: 'maj', inv: 1, fn: 'D', desc: 'V with Ti in the bass, pressing up to Do.' },
    ii6: { root: 2, q: 'min', inv: 1, fn: 'PD', desc: 'ii with Fa in the bass. A classic step toward V.' },
    iv: { root: 5, q: 'min', fn: 'PD', desc: 'The minor chord built on Fa. In a major key it is borrowed from minor: a sigh.' },
    '♭VI': { root: 8, q: 'maj', fn: 'PD', desc: 'A major chord built on Le (♭6), borrowed from minor. An epic, cinematic lift.' },
    '♭VII': { root: 10, q: 'maj', fn: 'D', desc: 'A major chord built on Te (♭7), borrowed from minor. A heroic, rock-anthem way back to I.' },
    '♭III': { root: 3, q: 'maj', fn: 'T', desc: 'A major chord built on Me (♭3), borrowed from minor. Bold and anthemic.' },
    'V/V': { root: 2, q: 'maj', fn: 'PD', desc: 'A major chord built on Re. It acts as the V of V, so it leans hard toward V.' },
    'V/vi': { root: 4, q: 'maj', fn: 'PD', desc: 'A major chord built on Mi. It acts as the V of vi and pulls toward vi.' },
    'V/ii': { root: 9, q: 'maj', fn: 'PD', desc: 'A major chord built on La. It acts as the V of ii and pulls toward ii.' },
    i: { root: 0, q: 'min', fn: 'T', desc: 'The home chord of a minor key. Home, in shadow.' },
    'ii°': { root: 2, q: 'dim', fn: 'PD', desc: 'The diminished chord built on Re in minor. Tense; it leads toward V.' },
    III: { root: 3, q: 'maj', fn: 'T', desc: 'The major chord built on Me. A ray of light inside a minor key.' },
    v: { root: 7, q: 'min', fn: 'D', desc: 'The minor chord built on Sol. A softer pull home than V.' },
    VI: { root: 8, q: 'maj', fn: 'PD', desc: 'The major chord built on Le. Warm and broad.' },
    VII: { root: 10, q: 'maj', fn: 'D', desc: 'The major chord built on Te. It leads to III or back to i.' },
  };
  function rnPcs(name) {
    const c = RN[name];
    return CHORD_TYPES[c.q].tones.map((t) => mod12(c.root + t));
  }
  function rnBassPc(name) {
    const c = RN[name];
    const tones = CHORD_TYPES[c.q].tones;
    return mod12(c.root + tones[c.inv || 0]);
  }

  // Functional transition weights. Targets outside the active pool are ignored.
  const NEXT = {
    I: { IV: 3, V: 3, vi: 3, ii: 2, iii: 1, I6: 1, V6: 1, iv: 1, '♭VI': 1, '♭VII': 1, 'V/V': 1, 'V/vi': 1, 'V/ii': 1, 'vii°': 0.6, V7: 1.5, ii6: 1 },
    I6: { IV: 3, ii: 2, ii6: 2, V: 2, V7: 1, vi: 0.5 },
    ii: { V: 4, V7: 3, 'vii°': 1, I6: 1, V6: 1 },
    ii6: { V: 4, V7: 3, V6: 0.5, I6: 0.5 },
    iii: { vi: 3, IV: 2, ii: 1, 'V/vi': 0.5 },
    IV: { V: 3, I: 2, ii: 1, V7: 2, iv: 2, I6: 1, 'vii°': 0.6, V6: 0.5, vi: 0.5 },
    V: { I: 4, i: 4, vi: 2, VI: 2, I6: 1, V7: 0.5 },
    V6: { I: 4, i: 4, vi: 0.5 },
    V7: { I: 4, i: 4, vi: 1.5, VI: 1.5 },
    vi: { ii: 3, IV: 3, V: 1, iii: 1, ii6: 1.5, 'V/V': 1, I6: 0.5 },
    'vii°': { I: 3, I6: 1, iii: 0.5 },
    iv: { I: 3, i: 3, V: 2, V7: 1.5, '♭VII': 0.5, VII: 1, 'ii°': 0.5 },
    '♭VI': { '♭VII': 3, V: 1, I: 1, iv: 1 },
    '♭VII': { I: 4, IV: 1, '♭VI': 0.5 },
    'V/V': { V: 4, V7: 3 },
    'V/vi': { vi: 4 },
    'V/ii': { ii: 4, ii6: 1 },
    i: { iv: 3, V: 3, VI: 3, III: 2, VII: 2, 'ii°': 1.5, V7: 1.5, v: 1 },
    'ii°': { V: 4, V7: 3 },
    III: { VI: 3, iv: 2, VII: 1 },
    VI: { iv: 2, 'ii°': 2, VII: 2, V: 1.5, III: 1 },
    VII: { III: 3, i: 2, VI: 1 },
    v: { VI: 2, iv: 2, i: 1 },
  };

  function genProgression({ pool, length = 4, mode = 'major', allowRepeat = false, focus = [], tries = 80 }) {
    const tonicRN = mode === 'minor' ? 'i' : 'I';
    const inPool = new Set(pool);
    let best = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      const seq = [tonicRN];
      for (let k = 1; k < length; k++) {
        const cur = seq[k - 1];
        const table = NEXT[cur] || {};
        const entries = [];
        for (const name of pool) {
          let w = table[name] || 0;
          if (name === cur) w = allowRepeat ? 0.8 : 0;
          if (w <= 0 && allowRepeat && name !== cur) w = 0.4; // tiny pools need slack
          if (focus.includes(name)) w *= 2.5;
          if (w > 0) entries.push([name, w]);
        }
        if (!entries.length) entries.push([tonicRN, 1]);
        seq.push(weightedPick(entries));
      }
      const last = seq[seq.length - 1];
      const endsWell = [tonicRN, 'V', 'V7', 'vi', 'VI', 'I6'].includes(last);
      const answers = seq.slice(1);
      const hasFocus = !focus.length || answers.some((x) => focus.includes(x));
      const notAllSame = new Set(answers).size > 1 || answers.length === 1;
      const ok = endsWell && hasFocus && notAllSame && seq.every((x) => inPool.has(x) || x === tonicRN);
      if (ok) return seq;
      if (!best && endsWell) best = seq;
    }
    return best || [tonicRN, ...Array.from({ length: length - 1 }, (_, k) => (k % 2 ? tonicRN : pool.find((p) => p !== tonicRN) || tonicRN))];
  }

  // Voice a chord: bass + three upper voices, moving as little as possible from the previous voicing.
  function voiceChord(pcs, bassPc, tonic, prev) {
    const lo = tonic - 3, hi = tonic + 17;
    const abs = (pc) => mod12(tonic + pc);
    // choose upper pitch-class sets (3 voices)
    let sets;
    if (pcs.length <= 3) sets = [pcs];
    else sets = [[pcs[0], pcs[1], pcs[3]], [pcs[1], pcs[2], pcs[3]]];
    const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    let best = null, bestCost = Infinity;
    for (const set of sets) {
      for (const order of perms(set)) {
        const options = order.map((pc) => {
          const out = [];
          for (let m = lo; m <= hi; m++) if (mod12(m) === abs(pc)) out.push(m);
          return out;
        });
        for (const a of options[0]) for (const b of options[1]) for (const c of options[2]) {
          if (!(a < b && b < c)) continue;
          if (c - a > 14) continue;
          let cost;
          if (prev) cost = Math.abs(a - prev[1]) + Math.abs(b - prev[2]) + Math.abs(c - prev[3]);
          else cost = Math.abs((a + b + c) / 3 - (tonic + 7)) * 1.5;
          if (c - a > 12) cost += 1.5;
          if (cost < bestCost) { bestCost = cost; best = [a, b, c]; }
        }
      }
    }
    // bass
    const bLo = tonic - 19, bHi = tonic - 6;
    const target = prev ? prev[0] : tonic - 12;
    let bass = null, bd = Infinity;
    for (let m = bLo; m <= bHi; m++) {
      if (mod12(m) !== abs(bassPc)) continue;
      const d = Math.abs(m - target) + (m >= best[0] - 2 ? 50 : 0);
      if (d < bd) { bd = d; bass = m; }
    }
    return [bass, ...best];
  }
  function voiceProgression(seq, tonic) {
    const out = [];
    let prev = null;
    for (const name of seq) {
      const v = voiceChord(rnPcs(name), rnBassPc(name), tonic, prev);
      out.push(v);
      prev = v;
    }
    return out;
  }

  // ---------- melody generator ----------
  // pool: allowed semitone offsets from Do (sorted). chromatic: {semi: resolveTo}.
  function genMelody({ pool, length, starts = [0], ends = [0], maxLeap = 4, leapProb = 0.25, chromatic = {}, tries = 200 }) {
    const P = pool.slice().sort((a, b) => a - b);
    const diatonic = P.filter((s) => !(s in chromatic));
    for (let attempt = 0; attempt < tries; attempt++) {
      const mel = [pick(starts.filter((s) => P.includes(s)).length ? starts.filter((s) => P.includes(s)) : [P[0]])];
      let lastLeap = 0;
      let ok = true;
      for (let k = 1; k < length; k++) {
        const cur = mel[k - 1];
        if (cur in chromatic) { mel.push(chromatic[cur]); lastLeap = 0; continue; }
        const cands = [];
        for (const s of P) {
          const d = s - cur;
          const ad = Math.abs(d);
          if (ad === 0 || ad > maxLeap) continue;
          const isChrom = s in chromatic;
          if (isChrom && k === length - 1) continue; // chromatic notes need room to resolve
          if (isChrom && !P.includes(chromatic[s])) continue;
          const idxCur = diatonic.indexOf(cur), idxS = diatonic.indexOf(s);
          const isStep = isChrom ? ad <= 2 : Math.abs(idxS - idxCur) === 1;
          let w = isStep ? 1 - leapProb : leapProb / 2;
          if (isChrom) w = 0.5;
          // after a big leap, prefer stepping back the other way
          if (Math.abs(lastLeap) > 4 && Math.sign(d) === Math.sign(lastLeap)) w *= 0.15;
          // avoid three notes in the same direction too often
          if (k >= 2 && Math.sign(d) === Math.sign(cur - mel[k - 2]) && Math.sign(cur - mel[k - 2]) === Math.sign(mel[k - 2] - (mel[k - 3] ?? mel[k - 2]))) w *= 0.6;
          // don't revisit the note from two steps back too much (oscillation)
          if (k >= 2 && s === mel[k - 2]) w *= 0.6;
          cands.push([s, w]);
        }
        if (!cands.length) { ok = false; break; }
        const nxt = weightedPick(cands);
        lastLeap = nxt - cur;
        mel.push(nxt);
      }
      if (!ok) continue;
      const lastPc = mod12(mel[mel.length - 1]);
      if (!ends.map(mod12).includes(lastPc)) continue;
      return mel;
    }
    // fallback: stepwise descent to Do
    const fb = [];
    for (let k = 0; k < length; k++) fb.push(diatonic[Math.max(0, Math.min(diatonic.length - 1, diatonic.indexOf(0) + (length - 1 - k)))]);
    return fb;
  }

  // ---------- rhythm ----------
  // ticks: quarter = 12 (so 16ths = 3, triplet 8ths = 4). Negative = rest.
  const RCELLS = {
    q: { ticks: [12], label: 'quarter note' },
    h: { ticks: [24], label: 'half note' },
    qr: { ticks: [-12], label: 'quarter rest' },
    dh: { ticks: [36], label: 'dotted half note' },
    w: { ticks: [48], label: 'whole note' },
    ee: { ticks: [6, 6], label: 'two eighth notes' },
    dqe: { ticks: [18, 6], label: 'dotted quarter + eighth' },
    ssss: { ticks: [3, 3, 3, 3], label: 'four sixteenths' },
    ess: { ticks: [6, 3, 3], label: 'eighth + two sixteenths' },
    sse: { ticks: [3, 3, 6], label: 'two sixteenths + eighth' },
    eqe: { ticks: [6, 12, 6], label: 'syncopation (eighth–quarter–eighth)' },
    ere: { ticks: [-6, 6], label: 'off-beat eighth' },
    des: { ticks: [9, 3], label: 'dotted eighth + sixteenth' },
    trip: { ticks: [4, 4, 4], label: 'eighth-note triplet' },
    // 6/8 cells (beat = dotted quarter = 18 ticks)
    eee: { ticks: [6, 6, 6], label: 'three eighths' },
    qe: { ticks: [12, 6], label: 'quarter + eighth' },
    eq: { ticks: [6, 12], label: 'eighth + quarter' },
    dq: { ticks: [18], label: 'dotted quarter' },
    ssee: { ticks: [3, 3, 6, 6], label: 'two sixteenths + two eighths' },
    dqr: { ticks: [-18], label: 'dotted quarter rest' },
  };
  const cellLen = (c) => RCELLS[c].ticks.reduce((a, t) => a + Math.abs(t), 0);

  function genRhythm({ cells, focus = [], bars = 1, meter = '4/4' }) {
    const barTicks = meter === '6/8' ? 36 : 48;
    const beat = meter === '6/8' ? 18 : 12;
    for (let attempt = 0; attempt < 200; attempt++) {
      const out = [];
      let ok = true;
      for (let b = 0; b < bars; b++) {
        let rem = barTicks;
        const used = [];
        while (rem > 0) {
          const pos = barTicks - rem;
          const fits = cells.filter((c) => cellLen(c) <= rem && cellLen(c) % beat === 0 && pos % beat === 0);
          if (!fits.length) { ok = false; break; }
          const entries = fits.map((c) => {
            let w = 1;
            if (focus.includes(c)) w *= 2.2;
            if (RCELLS[c].ticks[0] < 0 && pos === 0 && b === 0) w = 0; // start with a sound
            if (cellLen(c) >= 36) w *= 0.35;
            return [c, w];
          });
          const c = weightedPick(entries);
          if (c === undefined) { ok = false; break; }
          used.push(c);
          rem -= cellLen(c);
        }
        if (!ok) break;
        out.push(...used);
      }
      if (!ok) continue;
      if (focus.length && !out.some((c) => focus.includes(c))) continue;
      const ticks = out.flatMap((c) => RCELLS[c].ticks);
      if (ticks.filter((t) => t > 0).length < 2) continue;
      return { cells: out, ticks, meter, bars, barTicks, beat };
    }
    return { cells: ['q', 'q', 'q', 'q'], ticks: [12, 12, 12, 12], meter: '4/4', bars: 1, barTicks: 48, beat: 12 };
  }
  function rhythmOnsets(r) {
    const on = [];
    let pos = 0;
    for (const t of r.ticks) {
      if (t > 0) on.push({ tick: pos, len: t });
      pos += Math.abs(t);
    }
    return on;
  }
  // "1 e & a" style count label for a tick position.
  function countLabel(tick, r) {
    if (r.meter === '6/8') {
      const eighth = Math.floor(tick / 6), sub = tick % 6;
      return sub === 0 ? String((eighth % 6) + 1) : '&';
    }
    const inBar = tick % r.barTicks;
    const beatN = Math.floor(inBar / 12) + 1;
    const sub = inBar % 12;
    if (sub === 0) return String(beatN);
    if (sub === 6) return '&';
    if (sub === 3) return 'e';
    if (sub === 9) return 'a';
    if (sub === 4) return 'trip';
    if (sub === 8) return 'let';
    return '·';
  }

  Object.assign(TL, {
    rand, randInt, pick, weightedPick, shuffle, mod12, mtof,
    KEY_NAMES, MINOR_KEY_NAMES, keyName,
    DEGREES, DEG, degBySemi, MODE_SCALE, resolutionPath,
    CADENCE, cadenceEvents, cadenceLength,
    INTERVALS, IV, CHORD_TYPES, chordVoicing,
    RN, rnPcs, rnBassPc, NEXT, genProgression, voiceChord, voiceProgression,
    genMelody, RCELLS, cellLen, genRhythm, rhythmOnsets, countLabel,
  });
})(typeof window !== 'undefined' ? window : globalThis);
