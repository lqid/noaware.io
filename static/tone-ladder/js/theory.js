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
  const an = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a'); // the article before a name ("an Octave")
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const MINOR_KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
  // the modes, as a composer names them; 'minor' is the do-based natural minor
  const MODE_NAMES = { major: 'major', minor: 'minor', dorian: 'Dorian', mixolydian: 'Mixolydian', lydian: 'Lydian', phrygian: 'Phrygian' };
  const minorLike = (mode) => mode === 'minor' || mode === 'dorian' || mode === 'phrygian';
  const keyName = (tonicMidi, mode) =>
    (minorLike(mode) ? MINOR_KEY_NAMES : KEY_NAMES)[mod12(tonicMidi)] + ' ' + (MODE_NAMES[mode] || 'major');

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
    dorian: ['1', '2', 'b3', '4', '5', '6', 'b7'],
    mixolydian: ['1', '2', '3', '4', '5', '6', 'b7'],
    lydian: ['1', '2', '3', '#4', '5', '6', '7'],
    phrygian: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'],
  };
  // the note that gives each mode away, against the major or minor it is nearest to
  const MODE_SIGN = { dorian: '6', mixolydian: 'b7', lydian: '#4', phrygian: 'b2' };

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
  // A mode walks home through its own notes: the nearest table (minor for Dorian and Phrygian,
  // major for the others), with the steps that would pass through a note the mode lacks rewritten.
  const MODE_RESOLVE = {
    dorian: { 6: [6, 7, 9, 10, 12], 7: [7, 9, 10, 12], 8: [8, 7, 5, 3, 2, 0], 9: [9, 10, 12] },
    mixolydian: { 6: [6, 7, 9, 10, 12], 7: [7, 9, 10, 12], 9: [9, 10, 12] },
    phrygian: { 3: [3, 1, 0], 4: [4, 3, 1, 0], 5: [5, 3, 1, 0], 9: [9, 10, 12] },
    lydian: { 8: [8, 7, 6, 4, 2, 0] },
  };
  function resolutionPath(semiAbs, mode) {
    const oct = Math.floor(semiAbs / 12);
    const pc = semiAbs - oct * 12;
    const over = MODE_RESOLVE[mode];
    return ((over && over[pc]) || RESOLVE[minorLike(mode) ? 'minor' : 'major'][pc]).map((p) => p + oct * 12);
  }

  // ---------- cadence (I–IV–V7–I with smooth voice leading), offsets from tonic ----------
  const CADENCE = {
    major: [[-12, 4, 7, 12], [-7, 5, 9, 12], [-5, 5, 7, 11], [-12, 4, 7, 12]],
    minor: [[-12, 3, 7, 12], [-7, 5, 8, 12], [-5, 5, 7, 11], [-12, 3, 7, 12]],
    // a mode has no V7: these vamps set it with its own chords and end on home (no parallels, no
    // note outside the mode, the bass moving by step or a leap it can sing)
    dorian: [[-12, 3, 7, 12], [-7, 5, 9, 12], [-5, 2, 7, 10], [-12, 3, 7, 12]],         // i IV v i
    mixolydian: [[-12, 4, 7, 12], [-14, 5, 10, 14], [-7, 5, 9, 12], [-12, 4, 7, 12]],   // I ♭VII IV I
    lydian: [[-12, 4, 7, 12], [-10, 2, 6, 9], [-5, 4, 7, 12], [-12, 4, 7, 12]],         // I II I(on Sol) I
    phrygian: [[-12, 3, 7, 12], [-7, 5, 8, 13], [-14, 5, 10, 13], [-12, 3, 7, 12]],     // i ♭II(on Fa) ♭vii i
  };
  function cadenceEvents(tonic, mode, start = 0, beat = 0.62) {
    const ch = CADENCE[mode] || CADENCE.major;
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
    I64: { root: 0, q: 'maj', inv: 2, fn: 'D', desc: 'I with Sol in the bass: the cadential six-four. It sounds like home but sits on V’s bass, so it is really a decoration of V, and it goes on to V or V7.' },
    V65: { root: 7, q: 'dom7', inv: 1, fn: 'D', desc: 'V7 with Ti in the bass. The bass presses up into Do; it resolves to I.' },
    V43: { root: 7, q: 'dom7', inv: 2, fn: 'D', desc: 'V7 with Re in the bass. A passing chord: the bass steps down to Do or up to Mi.' },
    V42: { root: 7, q: 'dom7', inv: 3, fn: 'D', desc: 'V7 with Fa in the bass. Fa must fall to Mi, so it resolves to I6.' },
    'V7/V': { root: 2, q: 'dom7', fn: 'PD', desc: 'The V7 of V: a seventh chord on Re that pulls hard toward V. Held long enough, it makes V sound like a new home.' },
    'V7/IV': { root: 0, q: 'dom7', fn: 'PD', desc: 'The home chord with Te added: the V7 of IV. It tips the music toward IV.' },
    'V7/vi': { root: 4, q: 'dom7', fn: 'PD', desc: 'The V7 of vi: a seventh chord on Mi that pulls toward vi, the relative minor.' },
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
    ii: { V: 4, V7: 3, 'vii°': 1, I6: 1, V6: 1, I64: 2, V65: 0.5 },
    ii6: { V: 4, V7: 3, V6: 0.5, I6: 0.5, I64: 2 },
    iii: { vi: 3, IV: 2, ii: 1, 'V/vi': 0.5 },
    IV: { V: 3, I: 2, ii: 1, V7: 2, iv: 2, I6: 1, 'vii°': 0.6, V6: 0.5, vi: 0.5, I64: 2, V42: 0.5 },
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
    I64: { V: 4, V7: 4 },
    V65: { I: 4 },
    V43: { I: 3, I6: 3 },
    V42: { I6: 4 },
    'V7/V': { V: 4 },
    'V7/IV': { IV: 4 },
    'V7/vi': { vi: 4 },
    '♭III': { I: 3, '♭VI': 1, IV: 1, V: 1 },
    i: { iv: 3, V: 3, VI: 3, III: 2, VII: 2, 'ii°': 1.5, V7: 1.5, v: 1 },
    'ii°': { V: 4, V7: 3 },
    III: { VI: 3, iv: 2, VII: 1 },
    VI: { iv: 2, 'ii°': 2, VII: 2, V: 1.5, III: 1 },
    VII: { III: 3, i: 2, VI: 1 },
    v: { VI: 2, iv: 2, i: 1 },
  };

  // `bias`: extra next-chord weights for this call, as { from: { to: weight } } (a level can let
  // a chord go somewhere it normally does not, without changing the table for every level)
  function genProgression({ pool, length = 4, mode = 'major', allowRepeat = false, focus = [], tries = 80, bias = {} }) {
    const tonicRN = mode === 'minor' ? 'i' : 'I';
    const inPool = new Set(pool);
    let best = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      const seq = [tonicRN];
      for (let k = 1; k < length; k++) {
        const cur = seq[k - 1];
        const table = { ...(NEXT[cur] || {}), ...(bias[cur] || {}) };
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

  // Two voicers share the same part-writing rules: no parallel fifths or octaves, the leading tone
  // rises, the seventh falls, no augmented seconds, no doubled leading tone, small smooth motion.
  // LIVE voices one chord at a time and looks ahead to the chords likely to follow (Explore, Sing);
  // WHOLE voices a known progression all at once by dynamic programming (Harmony questions, intros).
  const LIVE = (() => {
    const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    // Distinct orderings of a multiset (a doubled note gives fewer orderings).
    const uniquePerms = (a) => {
      const seen = new Set();
      return perms(a).filter((p) => { const k = p.join(','); return seen.has(k) ? false : (seen.add(k), true); });
    };
    // Voice pairs that keep a perfect fifth or octave while both voices move (parallel or contrary).
    function parallels(p, v) {
      let n = 0;
      for (let x = 0; x < v.length; x++) for (let y = x + 1; y < v.length; y++) {
        const i1 = mod12(p[y] - p[x]), i2 = mod12(v[y] - v[x]);
        if ((i1 === 0 || i1 === 7) && i1 === i2 && p[x] !== v[x] && p[y] !== v[y]) n++;
      }
      return n;
    }

    // Costs of the voice-leading choices (chorale style). Faults cost far more than motion, so the
    // voicer gives up a rule only when every alternative breaks a worse one. Tuned on the shared
    // harness (seeded Harmony questions and random Explore chains) and checked on a second seed.
    const VL = {
      parallel: 1000,     // parallel or contrary fifths/octaves, per voice pair
      tiSop: 130,         // leading tone of a dominant not rising to Do, soprano
      tiInner: 72,        // ... alto or tenor
      tiBass: 4,          // ... bass (V6)
      seventh: 72,        // seventh of V7 (Fa) not stepping down
      seventhDim: 4,      // Fa of vii° not stepping down
      secondaryLt: 5,     // third of a secondary dominant not rising to the new root
      secondarySev: 5,    // seventh of a secondary dominant not stepping down
      augSecondSop: 140,  // Le-Ti in the soprano, either way
      augSecond: 65,      // ... in any other voice
      doubledTi: 34,      // per extra leading tone
      unequalFifths: 10,  // a diminished fifth over the bass moving to a perfect fifth
      tritone: 34,        // melodic tritone, any voice
      bigLeap: 44,        // upper-voice leap of a fifth or more
      sopLeap: 0.1,       // per semitone of a soprano leap beyond a whole step
      bassLeap: 25,       // bass leap of a sixth or seventh
      overlap: 8.5,       // a voice passes the previous note of its neighbour
      directOuter: 28,    // outer voices reach a fifth/octave in similar motion with a soprano leap
      similarOuter: 0.45, // outer voices in similar motion
      allSame: 2.25,      // all four voices move the same way
      wide: 0.5,          // soprano more than an octave above the tenor
      motion: 0.7,        // per semitone of upper-voice motion
      bassMotion: 0.2,    // per semitone of bass motion
      // doublings: root-position triads (third, fifth, tripled root, root + two thirds), first
      // inversions (doubled bass for major / minor, doubled fifth), diminished triads, seventh chords
      d3maj: 1.3, d3min: 0.45, d5: 0.5, r3: 2, rtt: 3.5, inv3maj: 1.7, inv3min: 0.1, inv5: 0.35, dimRoot: 1.1, dim5: 8, sev5: 0.25,
      // looking ahead
      ahead: 0.3,         // weight of how well the chord moves on to the chords that usually follow it
      aheadAll: 2,        // weight of how well it moves on to any chord at all (Explore)
      aheadBass: 1,       // weight of how near the bass is to the usual next bass
      aheadMotion: 0.9,   // how much motion counts in that look, against faults
      aheadKeep: 10,      // how many of the cheapest voicings get that look
      aheadTop: 4,        // how many of the usual next chords to try
      aheadCap: 100,      // a move that cannot be made well costs at most this
      ahead2: 0.5,        // weight of the usual next chords' own continuations (two steps ahead)
      ahead2Keep: 6,      // how many moves get that second look
      maxSpan: 18,        // widest tenor-to-soprano span
      bassGap: 2,         // closest the bass comes to the tenor
    };

    // Upper-voice pitch-class multisets for a chord, each with a doubling cost. Sets marked std are
    // the textbook default (what voiceChord(..., null) has always used).
    function upperSets(pcs, bassPc) {
      if (pcs.length === 3) {
        const [r, t, f] = pcs;
        const minor = mod12(t - r) === 3, dim = mod12(f - r) === 6;
        if (bassPc === r) return [
          { set: [r, t, f], cost: dim ? VL.dimRoot : 0, std: true },     // doubled root
          { set: [t, t, f], cost: dim ? 0 : minor ? VL.d3min : VL.d3maj }, // doubled third (vi after V; vii°, ii°)
          { set: [t, f, f], cost: dim ? VL.dim5 : VL.d5 },                 // doubled fifth
          { set: [r, r, t], cost: VL.r3 },                                 // tripled root, no fifth (V7 to I)
          { set: [r, t, t], cost: VL.rtt },                                // doubled third, no fifth
        ];
        if (bassPc === t) return [
          { set: [r, t, f], cost: dim ? 0 : minor ? VL.inv3min : VL.inv3maj, std: true }, // doubled bass
          { set: [r, r, f], cost: 0 },                                                   // doubled root
          { set: [r, f, f], cost: dim ? VL.dim5 : VL.inv5 },                             // doubled fifth
        ];
        return [{ set: [r, t, f], cost: 0, std: true }];
      }
      if (pcs.length === 4) {
        // seventh chord over its root: root doubled with the fifth left out, or complete
        return [
          { set: [pcs[0], pcs[1], pcs[3]], cost: VL.sev5, std: true },
          { set: [pcs[1], pcs[2], pcs[3]], cost: 0, std: true },
        ];
      }
      return [{ set: pcs.slice(0, 3), cost: 0, std: true }];
    }
    const multisetKey = (a) => a.map(mod12).sort((x, y) => x - y).join(',');
    // leading tones beyond the first (never double Ti)
    const extraTi = (v, tonic) => Math.max(0, v.reduce((n, m) => n + (mod12(m - tonic) === 11), 0) - 1);
    // Every voicing of a chord in range, cached per chord and key. old marks the voicings the
    // original close-position voicer allowed (upper span up to 14, bass at least 3 below the tenor).
    const voicingCache = new Map();
    function chordVoicings(pcs, bassPc, tonic) {
      const key = pcs.join(',') + '|' + bassPc + '|' + tonic;
      if (voicingCache.has(key)) return voicingCache.get(key);
      const lo = tonic - 3, hi = tonic + 17, bLo = tonic - 19, bHi = tonic - 6;
      const notesOf = (pc, from, to) => {
        const out = [];
        for (let m = from; m <= to; m++) if (mod12(m) === mod12(tonic + pc)) out.push(m);
        return out;
      };
      const basses = notesOf(bassPc, bLo, bHi);
      const sets = upperSets(pcs, bassPc);
      const list = [];
      const setCost = new Map();
      for (const { set, cost, std } of sets) {
        if (!setCost.has(multisetKey(set))) setCost.set(multisetKey(set), cost);
        for (const order of uniquePerms(set)) {
          const options = order.map((pc) => notesOf(pc, lo, hi));
          for (const a of options[0]) for (const b of options[1]) for (const c of options[2]) {
            if (!(a < b && b < c) || c - a > VL.maxSpan || b - a > 12 || c - b > 12) continue;
            for (const bass of basses) {
              if (bass > a - VL.bassGap) continue;
              const v = [bass, a, b, c];
              list.push({ v, cost, std, ti: extraTi(v, tonic), wide: c - a > 12, old: c - a <= 14 && bass <= a - 3 });
            }
          }
        }
      }
      const out = { pcs, bassPc, key: pcs.join(',') + '|' + bassPc, list, setCost, basses, notes: [...new Set(pcs.map(mod12))], lo, hi };
      voicingCache.set(key, out);
      return out;
    }
    const ownCost = (c) => c.cost + VL.doubledTi * c.ti + (c.wide ? VL.wide : 0);

    // Where a chord usually goes next (from NEXT), as [pcs, bassPc, weight], with the mode guessed
    // from the notes in play. Used only to prefer voicings that can move on well.
    const MINOR_ONLY = new Set(['i', 'ii°', 'III', 'v', 'VI', 'VII']);
    const MAJOR_ONLY = new Set(['I', 'ii', 'iii', 'vi', 'vii°', 'I6', 'ii6', 'V6', 'IV', 'V/V', 'V/vi', 'V/ii', '♭VI', '♭VII', '♭III']);
    let shapeNames = null, allShapes = null;
    const nextCache = new Map();
    function likelyNext(pcs, bassPc, minor) {
      const key = pcs.join(',') + '|' + bassPc + '|' + minor;
      if (nextCache.has(key)) return nextCache.get(key);
      if (!shapeNames) {
        shapeNames = new Map();
        for (const n of Object.keys(RN)) {
          const k = rnPcs(n).join(',') + '|' + rnBassPc(n);
          if (!shapeNames.has(k)) shapeNames.set(k, []);
          shapeNames.get(k).push(n);
        }
      }
      const off = minor ? MAJOR_ONLY : MINOR_ONLY;
      const names = (shapeNames.get(pcs.join(',') + '|' + bassPc) || []).filter((n) => !off.has(n));
      const w = {};
      for (const n of names) for (const [t, x] of Object.entries(NEXT[n] || {})) if (!off.has(t) && x > 0) w[t] = (w[t] || 0) + x;
      const all = Object.entries(w).sort((a, b) => b[1] - a[1]);
      const top = all.slice(0, VL.aheadTop);
      // the dominant is the most demanding chord to move to, so it is always looked at
      for (const e of all.slice(VL.aheadTop)) if (e[0] === 'V' || e[0] === 'V7') top.push(e);
      const tot = top.reduce((s, [, x]) => s + x, 0);
      const out = top.map(([t, x]) => [rnPcs(t), rnBassPc(t), x / tot]);
      nextCache.set(key, out);
      return out;
    }

    // What the previous chord asks of this one: tendency tones to resolve.
    function tendencies(prev, pcs, tonic) {
      const pr = prev.map((m) => mod12(m - tonic)), ps = new Set(pr), cur = new Set(pcs.map(mod12));
      const dom = ps.has(11) && (ps.has(2) || ps.has(5));
      let R = null; // root of a major or dominant-seventh previous chord
      for (const r of ps) {
        if (!ps.has(mod12(r + 4))) continue;
        let ok = true;
        for (const x of ps) if (![0, 4, 7, 10].includes(mod12(x - r))) ok = false;
        if (ok) { R = r; break; }
      }
      const secondary = R !== null && R !== 7 && mod12(R - pcs[0]) === 7;
      return {
        pr,
        tiRes: dom && cur.has(0) && !cur.has(11),
        sevRes: dom && ps.has(5) && (cur.has(3) || cur.has(4)) ? (ps.has(7) ? VL.seventh : VL.seventhDim) : 0,
        secLt: secondary ? mod12(R + 4) : null,
        secSev: secondary && ps.has(mod12(R + 10)) ? mod12(R + 10) : null,
      };
    }
    // m scales the motion costs (the look ahead cares more about faults than about distance)
    function transitionCost(p, v, ctx, tonic, m = 1) {
      const d = [v[0] - p[0], v[1] - p[1], v[2] - p[2], v[3] - p[3]];
      const pr = ctx.pr;
      let cost = VL.bassMotion * m * Math.abs(d[0]);
      for (let k = 0; k < 4; k++) {
        const ad = Math.abs(d[k]);
        if (k > 0) {
          cost += VL.motion * m * ad;
          if (ad >= 7) cost += VL.bigLeap;
        } else if (ad > 7 && ad !== 12) cost += VL.bassLeap;
        if (ad === 6) cost += VL.tritone;
        if (ad === 3 && (pr[k] === 8 || pr[k] === 11)) {
          const cp = mod12(v[k] - tonic);
          if ((pr[k] === 8 && cp === 11) || (pr[k] === 11 && cp === 8)) cost += k === 3 ? VL.augSecondSop : VL.augSecond;
        }
        // tendency tones
        if (ctx.tiRes && pr[k] === 11 && d[k] !== 1) cost += k === 3 ? VL.tiSop : k === 0 ? VL.tiBass : VL.tiInner;
        if (k > 0) {
          if (ctx.sevRes && pr[k] === 5 && d[k] !== -1 && d[k] !== -2) cost += ctx.sevRes;
          if (pr[k] === ctx.secLt && d[k] !== 1) cost += VL.secondaryLt;
          if (pr[k] === ctx.secSev && d[k] !== -1 && d[k] !== -2) cost += VL.secondarySev;
        }
      }
      if (Math.abs(d[3]) > 2) cost += VL.sopLeap * (Math.abs(d[3]) - 2);
      cost += VL.parallel * parallels(p, v);
      // a diminished fifth over the bass moving to a perfect fifth in similar motion (Ti-Fa to Do-Sol)
      for (let k = 1; k < 4; k++) {
        if (d[0] && Math.sign(d[k]) === Math.sign(d[0]) && mod12(p[k] - p[0]) === 6 && mod12(v[k] - v[0]) === 7) cost += VL.unequalFifths;
      }
      for (let k = 0; k < 3; k++) if (v[k] > p[k + 1] || v[k + 1] < p[k]) cost += VL.overlap;
      const sb = Math.sign(d[0]), ss = Math.sign(d[3]);
      if (sb && sb === ss) {
        cost += VL.similarOuter;
        const iv = mod12(v[3] - v[0]);
        if ((iv === 0 || iv === 7) && Math.abs(d[3]) > 2) cost += VL.directOuter;
        if (Math.sign(d[1]) === sb && Math.sign(d[2]) === sb) cost += VL.allSame;
      }
      return cost;
    }

    // Cheapest bass move to one of the given bass notes.
    function bassMove(bass, basses) {
      let best = Infinity;
      for (const b of basses) {
        const d = Math.abs(b - bass);
        best = Math.min(best, VL.bassMotion * d + (d > 7 && d !== 12 ? VL.bassLeap : 0) + (d === 6 ? VL.tritone : 0));
      }
      return best;
    }
    // Moves from voicing v to voicings of chord T near it (each upper voice within a fifth), cheapest first.
    function movesTo(v, T, tonic) {
      const ctx = tendencies(v, T.pcs, tonic);
      const opts = [1, 2, 3].map((k) => {
        const out = [];
        for (const pc of T.notes) {
          const base = tonic + pc;
          for (let m = base + 12 * Math.ceil((v[k] - 7 - base) / 12); m <= v[k] + 7; m += 12) if (m >= T.lo && m <= T.hi) out.push(m);
        }
        return out;
      });
      const out = [];
      for (const a of opts[0]) for (const b of opts[1]) {
        if (b <= a || b - a > 12) continue;
        for (const c of opts[2]) {
          if (c <= b || c - b > 12 || c - a > VL.maxSpan) continue;
          const sc = T.setCost.get(multisetKey([a - tonic, b - tonic, c - tonic]));
          if (sc === undefined) continue;
          for (const bass of T.basses) {
            if (bass > a - VL.bassGap) continue;
            const u = [bass, a, b, c];
            const own = sc + VL.doubledTi * extraTi(u, tonic) + (c - a > 12 ? VL.wide : 0);
            out.push({ u, cost: own + transitionCost(v, u, ctx, tonic, VL.aheadMotion) });
          }
        }
      }
      return out.sort((x, y) => x.cost - y.cost);
    }
    // How well voicing v can move on to chord T (capped), optionally also looking one chord further.
    // Cached by the voicing's position relative to the tonic, so every key shares the work.
    const moveCache = new Map();
    function moveOn(v, T, tonic, depth, minor) {
      const key = (depth > 1 ? (minor ? '2m' : '2M') : '1') + v.map((m) => m - tonic).join(',') + '|' + T.key;
      const hit = moveCache.get(key);
      if (hit !== undefined) return hit;
      if (moveCache.size > 300000) moveCache.clear();
      const moves = movesTo(v, T, tonic);
      let val = moves.length ? moves[0].cost : Infinity;
      if (depth > 1 && moves.length) {
        const next = likelyNext(T.pcs, T.bassPc, minor).map(([p, b, w]) => [chordVoicings(p, b, tonic), w]);
        val = Infinity;
        for (const m of moves.slice(0, VL.ahead2Keep)) {
          let a = 0;
          for (const [T2, w] of next) a += w * moveOn(m.u, T2, tonic, 1, minor);
          val = Math.min(val, m.cost + VL.ahead2 * a);
        }
      }
      val = Math.min(val, VL.aheadCap * (depth > 1 ? 1 + VL.ahead2 : 1));
      moveCache.set(key, val);
      return val;
    }

    // Voice a chord: bass plus three upper voices, chosen together. With no previous chord it is the
    // standard close voicing around the tonic. Otherwise every doubling and spacing is scored against
    // the previous voicing: smooth motion and held common tones, no parallel or contrary fifths and
    // octaves, tendency tones resolved (Ti up to Do, the seventh down), no augmented seconds, no
    // doubled leading tone, no overlap, no direct fifths or octaves in the outer voices. The cheapest
    // few are then also scored on how well they can move on to the chords that usually follow, so a
    // V is voiced so that its Ti can still rise to Do in I or in vi. Nothing depends on later chords.
    function voiceChord(pcs, bassPc, tonic, prev) {
      const V = chordVoicings(pcs, bassPc, tonic);
      let best = null, bestCost = Infinity;
      if (!prev) {
        for (const c of V.list) {
          if (!c.old) continue;
          const [bass, a, b, cc] = c.v;
          let cost = Math.abs((a + b + cc) / 3 - (tonic + 7)) * 1.5 + 0.5 * Math.abs(bass - (tonic - 12));
          if (!c.std) cost += 20 + c.cost;
          cost += 40 * c.ti;
          if (c.wide) cost += VL.wide;
          if (cost < bestCost) { bestCost = cost; best = c.v; }
        }
        return best ? best.slice() : best;
      }
      const ctx = tendencies(prev, pcs, tonic);
      // the mode, guessed from the notes in play: Me or Le without Mi or La
      const ev = new Set([...prev.map((m) => mod12(m - tonic)), ...pcs]);
      const minor = !ev.has(4) && !ev.has(9) && (ev.has(3) || ev.has(8));
      const next = likelyNext(pcs, bassPc, minor).map(([p, b, w]) => [chordVoicings(p, b, tonic), w]);
      const scored = V.list.map((c) => {
        let cost = ownCost(c) + transitionCost(prev, c.v, ctx, tonic);
        // the bass line: take the octave from which the usual next bass is near (IV on low Fa before V)
        for (const [T, w] of next) cost += VL.aheadBass * w * bassMove(c.v[0], T.basses);
        return { v: c.v, cost };
      });
      scored.sort((x, y) => x.cost - y.cost);
      const targets = [];
      if (VL.ahead > 0) for (const [T, w] of next) targets.push([T, w * VL.ahead, VL.ahead2 > 0 ? 2 : 1]);
      if (VL.aheadAll > 0) {
        if (!allShapes) allShapes = [...new Set(Object.keys(RN).map((n) => rnPcs(n).join(',') + '|' + rnBassPc(n)))].map((k) => { const [p, b] = k.split('|'); return [p.split(',').map(Number), +b]; });
        for (const [p, b] of allShapes) targets.push([chordVoicings(p, b, tonic), VL.aheadAll / allShapes.length, 1]);
      }
      if (!targets.length) return scored.length ? scored[0].v.slice() : null;
      for (const s of scored.slice(0, VL.aheadKeep)) {
        let cost = s.cost;
        for (const [T, w, depth] of targets) cost += w * moveOn(s.v, T, tonic, depth, minor);
        if (cost < bestCost) { bestCost = cost; best = s.v; }
      }
      return best ? best.slice() : best;
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
    return { voiceChord, parallels };
  })();
  const WHOLE = (() => {
    const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    // Voice pairs that keep a perfect fifth or octave while both voices move (parallel or contrary).
    function parallels(p, v) {
      let n = 0;
      for (let x = 0; x < v.length; x++) for (let y = x + 1; y < v.length; y++) {
        const i1 = mod12(p[y] - p[x]), i2 = mod12(v[y] - v[x]);
        if ((i1 === 0 || i1 === 7) && i1 === i2 && p[x] !== v[x] && p[y] !== v[y]) n++;
      }
      return n;
    }

    // ---------- four-part voicing (chorale style) ----------
    // A voicing is [bass, tenor, alto, soprano] in MIDI, strictly ascending: upper voices within
    // [tonic-3, tonic+17], bass within [tonic-19, tonic-6]. Each candidate voicing of a chord has a static
    // cost (doubling, spacing); each move between two voicings has a transition cost (motion, parallels,
    // leaps, tendency tones). voiceChord picks the cheapest next voicing greedily (Explore, Sing);
    // voiceProgression picks the cheapest path through the whole progression (Viterbi).
    const VW = {
      bass: 0.3, // per semitone of bass motion (upper voices cost 1 per semitone)
      leap: 0.5, // per semitone beyond a major third in an upper voice
      sop: 0.7, // per semitone beyond a whole step in the soprano (keep the top line smooth)
      bigLeap: 10, // upper-voice leap of a fifth or more
      tritone: 24, // melodic tritone in any voice
      aug2: 50, aug2Sop: 90, // augmented second Le <-> Ti
      parallel: 120, // parallel or contrary fifths/octaves, per voice pair
      overlap: 2.25, // a voice passing where its neighbour just was
      similar: 1.5, // outer voices in similar motion
      direct: 20, // fifth or octave reached in the outer voices by similar motion with a soprano leap
      ti: 40, tiSop: 64, // a dominant's leading tone that does not rise to Do
      seventh: 60, // the seventh of V7 (Fa) that does not step down
      fa: 12, // Fa of vii° that does not step down
      melodic: 6, // another augmented or diminished melodic interval (Ti-Me, Me-Ti, Si-Do...)
      slt: 8, // a secondary dominant's leading tone that does not rise
      tiDouble: 40, // leading tone doubled in a dominant chord
      sltDouble: 12, // secondary leading tone doubled
      // doublings (root position doubles the root unless noted)
      thirdMajor: 1, thirdMinor: 0.5, // doubled third
      fifth: 3, // doubled fifth
      noFifth: 3, // fifth left out (tripled root, or root and third doubled)
      dimRoot: 0, dimFifth: 5, // diminished triad: doubled root, doubled fifth (doubled third is free)
      sixThird: 2.5, sixFifth: 1.5, // first inversion: doubled bass (third), doubled fifth
      v7NoFifth: 1, // V7 with doubled root and no fifth
    };
    // greedy voiceChord: weight of a candidate's flexibility, and how many chords ahead it looks
    const LOOKAHEAD = 2, LOOK_DEPTH = 2, LOOK_GAMMA = 1;

    // Upper-voice pitch-class sets (three voices over the bass), each with a small doubling cost.
    function upperSets(pcs, bassPc) {
      const [r, t, f, s] = pcs;
      if (pcs.length >= 4) {
        // seventh chord: complete, or root doubled without the fifth
        if (bassPc === r) return [[[r, t, s], VW.v7NoFifth], [[t, f, s], 0]];
        return [[pcs.filter((x) => x !== bassPc).slice(0, 3), 0]];
      }
      const minor = mod12(t - r) === 3, dim = minor && mod12(f - r) === 6;
      if (bassPc === r) {
        // diminished: double the third
        if (dim) return [[[r, t, f], VW.dimRoot], [[t, t, f], 0], [[t, f, f], VW.dimFifth]];
        return [[[r, t, f], 0], [[t, t, f], minor ? VW.thirdMinor : VW.thirdMajor], [[r, r, t], VW.noFifth], [[t, f, f], VW.fifth], [[r, t, t], VW.noFifth + VW.thirdMajor]];
      }
      // first inversion: double the root or the fifth, rarely the bass
      if (bassPc === t) return [[[r, t, f], dim ? 0 : VW.sixThird], [[r, r, f], 0], [[r, f, f], VW.sixFifth], [[r, r, t], VW.noFifth]];
      return [[[r, t, f], 0], [[r, r, t], VW.noFifth]];
    }

    // A voicing with what the transition cost needs to know about it.
    function voicingInfo(v, tonic, st) {
      const pc = v.map((x) => mod12(x - tonic));
      let mask = 0;
      for (const x of pc) mask |= 1 << x;
      const has = (x) => (mask >> x) & 1;
      // dominant (V, V6, V7, vii°): Ti without Mi or Le (those make it iii or V/vi)
      const dom = !!(has(11) && !has(4) && !has(8));
      const v7 = dom && !!(has(5) && has(7));
      // secondary leading tone: Fi (V/V), Di (V/ii), Si = Le with Mi (V/vi)
      const lt = has(6) ? 6 : has(1) ? 1 : has(8) && has(4) ? 8 : -1;
      // letter-name step of each voice above Do (0-6), so melodic intervals can be spelled
      const sp = pc.map((x) => (x === lt ? LT_STEP[x] : STEP[x]));
      return { v, pc, sp, mask, dom, v7, lt, st };
    }
    const STEP = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6]; // Ra/Re = 2nd, Me/Mi = 3rd, Le/La = 6th, Te/Ti = 7th
    const LT_STEP = { 1: 0, 6: 3, 8: 4 }; // secondary leading tones are sharps: Di, Fi, Si
    // MELODIC[step][semitones]: 1 when a melodic interval is perfect, major or minor (or a chromatic
    // semitone); augmented and diminished ones (Ti up to Me, Le down to Ti...) are 0.
    const MELODIC = [[0, 1], [1, 2], [3, 4], [5], [7], [8, 9], [10, 11]].map((ok) => Array.from({ length: 12 }, (_, i) => +ok.includes(i)));

    const VCACHE = new Map();
    function chordCandidates(pcs, bassPc, tonic) {
      pcs = pcs.map(mod12);
      bassPc = mod12(bassPc);
      const key = tonic + '|' + pcs.join(',') + '|' + bassPc;
      let out = VCACHE.get(key);
      if (out) return out;
      out = [];
      const lo = tonic - 3, hi = tonic + 17, bLo = tonic - 19, bHi = tonic - 6;
      const notesOf = (pc, from, to) => {
        const r = [];
        for (let m = from; m <= to; m++) if (mod12(m - tonic) === pc) r.push(m);
        return r;
      };
      const basses = notesOf(bassPc, bLo, bHi);
      const seen = new Set();
      for (const [set, sc] of upperSets(pcs, bassPc)) {
        for (const order of perms(set)) {
          const opt = order.map((pc) => notesOf(pc, lo, hi));
          for (const a of opt[0]) for (const b of opt[1]) for (const c of opt[2]) {
            if (!(a < b && b < c) || b - a > 12 || c - b > 12) continue; // adjacent upper voices within an octave
            for (const bass of basses) {
              const id = bass * 1e6 + a * 1e4 + b * 100 + c;
              if (seen.has(id)) continue;
              seen.add(id);
              const info = voicingInfo([bass, a, b, c], tonic, sc);
              const count = (x) => info.pc.filter((y) => y === x).length;
              if (info.dom && count(11) > 1) info.st += VW.tiDouble;
              if (info.lt >= 0 && count(info.lt) > 1) info.st += VW.sltDouble;
              out.push(info);
            }
          }
        }
      }
      VCACHE.set(key, out);
      return out;
    }

    // Cost of moving from voicing P to voicing C (both from voicingInfo); never negative.
    function transCost(P, C) {
      const p = P.v, c = C.v, pp = P.pc, cp = C.pc;
      let cost = 0;
      for (let k = 0; k < 4; k++) {
        const d = c[k] - p[k], ad = d < 0 ? -d : d;
        if (k === 0) cost += VW.bass * ad;
        else {
          cost += ad;
          if (ad > 4) cost += VW.leap * (ad - 4);
          if (k === 3 && ad > 2) cost += VW.sop * (ad - 2);
          if (ad >= 7) cost += VW.bigLeap;
        }
        if (ad === 6) cost += VW.tritone;
        else if (ad === 3 && ((pp[k] === 8 && cp[k] === 11) || (pp[k] === 11 && cp[k] === 8))) cost += k === 3 ? VW.aug2Sop : VW.aug2;
        else if (d !== 0 && !MELODIC[(d > 0 ? C.sp[k] - P.sp[k] + 7 : P.sp[k] - C.sp[k] + 7) % 7][ad % 12]) cost += VW.melodic;
      }
      cost += VW.parallel * parallels(p, c);
      for (let k = 0; k < 3; k++) if (c[k] > p[k + 1] || c[k + 1] < p[k]) cost += VW.overlap;
      const db = c[0] - p[0], ds = c[3] - p[3];
      if ((db > 0 && ds > 0) || (db < 0 && ds < 0)) {
        cost += VW.similar;
        const iv = mod12(c[3] - c[0]);
        if ((iv === 0 || iv === 7) && (ds > 2 || ds < -2)) cost += VW.direct;
      }
      const cm = C.mask;
      if (P.dom) {
        // Ti rises to Do when the next chord has Do (and no Ti of its own)
        if ((cm & 1) && !(cm & 2048)) for (let k = 1; k < 4; k++) if (pp[k] === 11 && c[k] - p[k] !== 1) cost += k === 3 ? VW.tiSop : VW.ti;
        // Fa (the seventh of V7, the fifth of vii°) steps down to Mi or Me
        if (cm & 24) for (let k = 1; k < 4; k++) if (pp[k] === 5) { const d = c[k] - p[k]; if (d !== -1 && d !== -2) cost += P.v7 ? VW.seventh : VW.fa; }
      }
      if (P.lt >= 0) {
        // a secondary leading tone rises a half step (Fi may also slide down to Fa, the seventh of V7)
        const tg = (P.lt + 1) % 12;
        if ((cm >> tg) & 1 && !((cm >> P.lt) & 1)) for (let k = 0; k < 4; k++) {
          const d = c[k] - p[k];
          if (pp[k] === P.lt && d !== 1 && !(d === -1 && C.v7)) cost += VW.slt;
        }
      }
      return cost;
    }

    // Cost of a voicing heard on its own: close, centred register (the standard root-position sound).
    const aloneCost = (C, tonic) => {
      const [bass, a, b, c] = C.v;
      return Math.abs((a + b + c) / 3 - (tonic + 7)) * 1.5 + 0.5 * Math.abs(bass - (tonic - 12)) + 2.5 * C.st;
    };

    // How well a voicing can move on when the next chord is unknown (Explore): the average, over every
    // Roman numeral, of the cheapest move to it (plus, at depth 2, how well that voicing moves on in
    // turn). Computed once per candidate and cached on it, so a new key costs a few ms once.
    let RN_CHORDS = null;
    function flexibility(C, tonic, depth = LOOK_DEPTH) {
      const key = 'flex' + depth;
      if (C[key] !== undefined) return C[key];
      if (!RN_CHORDS) RN_CHORDS = Object.keys(RN).map((n) => [rnPcs(n), rnBassPc(n)]);
      let sum = 0;
      for (const [pcs, bass] of RN_CHORDS) {
        let m = Infinity;
        for (const D of chordCandidates(pcs, bass, tonic)) {
          let x = D.st + transCost(C, D);
          if (depth > 1 && x < m) x += LOOK_GAMMA * flexibility(D, tonic, depth - 1);
          if (x < m) m = x;
        }
        sum += m;
      }
      return (C[key] = sum / RN_CHORDS.length);
    }

    // Voice one chord. With prev (the previous 4-note voicing), the cheapest move from it that also
    // leaves good moves for whatever chord comes next; without, the standard voicing heard on its own.
    function voiceChord(pcs, bassPc, tonic, prev) {
      const cands = chordCandidates(pcs, bassPc, tonic);
      let best = null, bestCost = Infinity;
      if (Array.isArray(prev) && prev.length === 4) {
        const P = voicingInfo(prev, tonic, 0);
        for (const C of cands) {
          const base = C.st + transCost(P, C);
          if (base >= bestCost) continue;
          const cost = base + LOOKAHEAD * flexibility(C, tonic);
          if (cost < bestCost) { bestCost = cost; best = C; }
        }
      } else {
        for (const C of cands) {
          if (C.v[3] - C.v[1] > 14) continue;
          const cost = aloneCost(C, tonic);
          if (cost < bestCost) { bestCost = cost; best = C; }
        }
      }
      return best ? best.v.slice() : null;
    }

    // Voice a whole progression at once: the cheapest path through every chord's candidate voicings.
    // The first chord is always voiceChord(..., null), so it never depends on what follows.
    // fixed (optional): voicings to keep for the first fixed.length chords (e.g. the shared start of a
    // question and a wrong answer); the rest is voiced to follow on from them.
    function voiceProgression(seq, tonic, fixed) {
      const n = seq.length;
      if (!n) return [];
      const fx = [];
      if (Array.isArray(fixed)) for (let i = 0; i < Math.min(n, fixed.length); i++) {
        if (!Array.isArray(fixed[i]) || fixed[i].length !== 4) break;
        fx.push(fixed[i].slice());
      }
      const first = fx.length ? fx[0] : voiceChord(rnPcs(seq[0]), rnBassPc(seq[0]), tonic, null);
      const layers = [[voicingInfo(first, tonic, 0)]];
      const back = [];
      let costs = [0];
      for (let i = 1; i < n; i++) {
        const prev = layers[i - 1];
        const cands = i < fx.length ? [voicingInfo(fx[i], tonic, 0)] : chordCandidates(rnPcs(seq[i]), rnBassPc(seq[i]), tonic);
        const nc = new Array(cands.length), bk = new Array(cands.length);
        for (let j = 0; j < cands.length; j++) {
          const C = cands[j];
          let bc = Infinity, bi = 0;
          for (let k = 0; k < prev.length; k++) {
            if (costs[k] >= bc) continue;
            const y = costs[k] + transCost(prev[k], C);
            if (y < bc) { bc = y; bi = k; }
          }
          nc[j] = bc + C.st;
          bk[j] = bi;
        }
        layers.push(cands);
        back.push(bk);
        costs = nc;
      }
      let j = 0;
      for (let k = 1; k < costs.length; k++) if (costs[k] < costs[j]) j = k;
      const out = new Array(n);
      for (let i = n - 1; i >= 0; i--) {
        out[i] = layers[i][j].v.slice();
        if (i > 0) j = back[i - 1][j];
      }
      return out;
    }
    return { voiceProgression };
  })();
  const { voiceChord, parallels } = LIVE;
  // voiceProgression(seq, tonic, fixed): fixed keeps the given voicings for the first chords, so a
  // re-voiced answer sounds like the question up to the first chord that differs.
  const voiceProgression = WHOLE.voiceProgression;

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

  // ticks per bar and per beat (a quarter note is 12 ticks); 5/4 is counted in a group of three
  // beats then two
  const METERS = { '4/4': [48, 12], '3/4': [36, 12], '5/4': [60, 12], '6/8': [36, 18] };
  function genRhythm({ cells, focus = [], bars = 1, meter = '4/4' }) {
    const [barTicks, beat] = METERS[meter] || METERS['4/4'];
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
    rand, randInt, pick, weightedPick, shuffle, mod12, mtof, an,
    KEY_NAMES, MINOR_KEY_NAMES, MODE_NAMES, MODE_SIGN, minorLike, keyName, METERS,
    DEGREES, DEG, degBySemi, MODE_SCALE, resolutionPath,
    CADENCE, cadenceEvents, cadenceLength,
    INTERVALS, IV, CHORD_TYPES, chordVoicing,
    RN, rnPcs, rnBassPc, NEXT, genProgression, voiceChord, voiceProgression, parallels,
    genMelody, RCELLS, cellLen, genRhythm, rhythmOnsets, countLabel,
  });
})(typeof window !== 'undefined' ? window : globalThis);
