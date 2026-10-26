/* Tone Ladder — curriculum: tracks, levels, introductions and question generators.
   Generators return plain question objects; the app plays and grades them.
   introV on a level: bump it when that level's introduction is rewritten, so people
   who saw the old one see the new one once. */
(function (g) {
  const TL = g.TL || (g.TL = {});
  const { DEG, DEGREES, IV, INTERVALS, CHORD_TYPES, RN, pick, randInt } = TL;

  const ALL7 = ['1', '2', '3', '4', '5', '6', '7'];
  const ALL12 = DEGREES.map((d) => d.id);
  const GAP = 0.45; // silence between context and question

  // ---------- shared helpers ----------
  const noteEv = (t, notes, dur, extra = {}) => ({ t, notes: Array.isArray(notes) ? notes : [notes], dur, vel: 0.72, ...extra });
  function contextEvents(tonic, mode, withContext) {
    return withContext ? TL.cadenceEvents(tonic, mode) : [];
  }
  const contextLen = (withContext) => (withContext ? TL.cadenceLength() + GAP : 0.15);
  const shift = (events, dt) => events.map((e) => ({ ...e, t: e.t + dt }));
  function seqEvents(midis, start, step, last = 1.1, extra = (i) => ({})) {
    return midis.map((m, i) => noteEv(start + i * step, m, i === midis.length - 1 ? last : step * 0.92, extra(i)));
  }
  const degOption = (id) => ({ id, deg: id, label: DEG[id].sol, sub: DEG[id].num, hue: DEG[id].hue });
  function nearestSemi(id, around) {
    const base = DEG[id].semi;
    let best = base, bd = Infinity;
    for (let o = -24; o <= 24; o += 12) {
      const d = Math.abs(base + o - around);
      if (d < bd) { bd = d; best = base + o; }
    }
    return best;
  }
  function resolutionEvents(tonic, semi, mode, start = 0) {
    const path = TL.resolutionPath(semi, mode);
    return path.map((s, i) => noteEv(start + i * 0.42, tonic + s, i === path.length - 1 ? 1.1 : 0.4, { deg: TL.degBySemi(s).id }));
  }
  const sortBySemi = (ids) => ids.slice().sort((a, b) => DEG[a].semi - DEG[b].semi);
  // a note's name as the user has chosen to see it (Preferences > Note names)
  const nameOf = (id, labels) => (labels === 'numbers' ? DEG[id].num : DEG[id].sol);

  // ======================================================================
  // 1. SCALE DEGREES
  // ======================================================================
  const DEG_TEXT = {
    '1': 'Do is home: the note music sounds finished on. The four chords end on the home chord, with Do as its top and bottom note. Every other note is named by where it sits above Do.',
    '5': 'Note 5 of the scale: Do, Re, Mi, Fa, Sol. Stable but open, like a pillar. The music could rest here, or go on. After the chords, Sol walks up to High Do through La and Ti, two notes you meet later.',
    '3': 'Warm and bright. Do, Mi and Sol together make the home chord, so Mi sounds settled.',
    '2': 'The next note up from Do. It sounds unfinished and wants to fall back to Do.',
    '6': 'Wistful, a little tender. It sits just above Sol. It can lean down to Sol, or climb through Ti, a note you meet later, to High Do.',
    '4': 'Tense and heavy. It sits just above Mi and pulls down onto it.',
    '7': 'One half step below Do (the very next key on a piano). It pulls up into Do harder than any other note. Its classic name is the leading tone.',
    'b7': 'Bluesy and open. A folk, rock and film-score color, one half step below Ti.',
    '#4': 'Bright and floating, one half step above Fa. It pushes up toward Sol.',
    'b3': 'Borrowed darkness: Mi lowered by a half step, heard inside a major key.',
    'b6': 'The bittersweet note borrowed from minor: La lowered by a half step. It sinks toward Sol.',
    'b2': 'Exotic and dark: Re lowered by a half step. It slides down onto Do.',
    '6min': 'In a minor key, raising Le to La brightens the scale (the dorian color).',
    '7min': 'In a minor key, raising Te to Ti gives a leading tone that pulls hard into Do.',
  };
  const DEG_L1_NOTE = {
    cadence: 'Every question starts with four chords that set the key.',
    sometimes: 'Four chords set the key whenever it changes.',
    chords: ' They end on the home chord, the one that sounds finished; its top and bottom notes are both Do. Then one more note plays.',
    drone: 'Every question plays over a drone: a low, steady sound built on Do, the home note. Then one more note plays.',
    judge: ' If it sounds completely at rest, it is Do. If it sounds open, as if the music could go on, it is Sol. Each note of the key has a name and a number, counting up from Do: Do 1, Re 2, Mi 3, Fa 4, Sol 5, La 6, Ti 7.',
    ladder: { both: ' Do is on the answer ladder twice, Do at the bottom and High Do at the top. Either one is right.', solfege: ' Do is on the answer ladder twice, Do at the bottom and High Do at the top. Either one is right.', numbers: ' 1 is on the answer ladder twice, 1 at the bottom and 1 (high) at the top. Either one is right.' },
  };
  function degL1Note({ context = 'cadence', cadenceEvery = true, labels = 'both' }) {
    const lead = context === 'drone' ? DEG_L1_NOTE.drone : (cadenceEvery ? DEG_L1_NOTE.cadence : DEG_L1_NOTE.sometimes) + DEG_L1_NOTE.chords;
    return lead + DEG_L1_NOTE.judge + (DEG_L1_NOTE.ladder[labels] || DEG_L1_NOTE.ladder.both);
  }
  const DEG_LEVELS = [
    { name: 'Do and Sol', items: ['1', '5'], introduce: ['1', '5'], introV: 2 },
    { name: 'Mi', items: ['1', '3', '5'], introduce: ['3'] },
    { name: 'Re', items: ['1', '2', '3', '5'], introduce: ['2'] },
    { name: 'La', items: ['1', '2', '3', '5', '6'], introduce: ['6'], note: 'With La you have Do, Re, Mi, Sol and La: the major pentatonic scale, five notes behind countless folk songs.' },
    { name: 'Fa', items: ['1', '2', '3', '4', '5', '6'], introduce: ['4'] },
    { name: 'Ti', items: ALL7, introduce: ['7'], note: 'All seven notes of the major scale.' },
    { name: 'Two octaves', items: ALL7, wide: true, introduce: [], note: 'Notes now appear below Do and above High Do. A note keeps its name at any height: a low Sol is still Sol.' },
    { name: 'Te and Fi', items: [...ALL7, 'b7', '#4'], introduce: ['b7', '#4'], note: 'Now the notes between the scale notes begin. Each one is a color against the key, and each leans toward its neighbor.' },
    { name: 'Me and Le', items: [...ALL7, 'b7', '#4', 'b3', 'b6'], introduce: ['b3', 'b6'] },
    { name: 'All twelve', items: ALL12, introduce: ['b2'], note: 'Every note, each heard as a color against the key.' },
    { name: 'Minor keys', mode: 'minor', items: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], introduce: [], note: 'The four chords now set a minor key, which sounds darker (i–iv–V7–i). Me, Le and Te (♭3, ♭6, ♭7) are now the normal notes of the scale. Listen for how Do still feels like home.' },
    { name: 'Raised 6 and 7 in minor', mode: 'minor', items: ['1', '2', 'b3', '4', '5', 'b6', 'b7', '6', '7'], introduce: ['6', '7'] },
  ];

  const degrees = {
    id: 'degrees',
    name: 'Scale Degrees',
    short: 'Degrees',
    hue: 25,
    blurb: 'Hear every note by its place in the key. This is the foundation for everything else.',
    why: 'Composers think in keys. Knowing that a note is “Ti” (and wants to rise) is more useful than knowing it is a B.',
    task: 'You hear four chords that set the key, then one note. Choose its name.',
    taskFor: (s) => (s.context === 'drone' ? 'You hear a drone built on Do, then one note. Choose its name.' : s.cadenceEvery ? null : 'Four chords set the key when it changes. Then you hear one note. Choose its name.'),
    levels: DEG_LEVELS,
    picksItem: true,
    usesKey: true,
    modeOf: (L) => DEG_LEVELS[L].mode || 'major',
    itemLabel: (id) => `${DEG[id].sol} (${DEG[id].num})`,
    intro(L, opts) {
      const { tonic } = opts;
      const lv = DEG_LEVELS[L];
      const mode = lv.mode || 'major';
      const cl = TL.cadenceLength();
      const cards = lv.introduce.map((id) => {
        const semi = DEG[id].semi;
        const textKey = mode === 'minor' && (id === '6' || id === '7') ? id + 'min' : id;
        // nearby notes from this level, including High Do, so there are always a few to compare
        const semis = sortBySemi(lv.items).map((x) => DEG[x].semi);
        if (lv.items.includes('1')) semis.push(12);
        let near = semis.filter((s) => Math.abs(s - semi) <= 4);
        if (near.length < 2) near = semis;
        const i = ALL7.indexOf(id);
        const sing = id === '1'
          ? 'Press “After the chords”. When they stop, hum Do: the top or the bottom note of the last chord, whichever you can reach. A single Do then plays, between those two, so you can check.'
          : mode === 'major' && i > 0
            ? `Sing Do, then sing up the scale, ${ALL7.slice(0, i + 1).map((x) => DEG[x].sol).join(' ')}, and hold ${DEG[id].sol}.`
            : `Sing Do, then find ${DEG[id].sol} by stepping toward it in your head.`;
        const inContext = id === '1'
          ? [...TL.cadenceEvents(tonic, mode), noteEv(cl + 0.9, tonic, 1.6, { deg: '1' })]
          : [...TL.cadenceEvents(tonic, mode), ...resolutionEvents(tonic, semi, mode, cl + GAP).map((e, k) => (k === 0 ? { ...e, dur: 1.0 } : { ...e, t: e.t + 0.6 }))];
        return {
          id, deg: id, title: DEG[id].sol, sub: DEG[id].num,
          text: DEG_TEXT[textKey],
          sing,
          demos: [
            { label: id === '1' ? 'After the chords' : 'After the chords, then home', events: inContext },
            { label: 'With other notes', events: seqEvents(near.map((s) => tonic + s), 0, 0.55, 0.9) },
            { label: 'Just the note', events: [noteEv(0, tonic + semi, 1.4)] },
          ],
        };
      });
      const note = L === 0 ? degL1Note(opts) : lv.note;
      return {
        title: lv.introduce.length ? 'Meet ' + lv.introduce.map((x) => DEG[x].sol).join(' and ') : lv.name,
        note, cards,
        demos: cards.length ? [] : [{ label: 'Hear the four chords', events: TL.cadenceEvents(tonic, mode) }],
      };
    },
    generate(L, { tonic, item, withContext = true, pool, maxLevel, labels }) {
      const lv = DEG_LEVELS[L];
      const mode = lv.mode || 'major';
      const items = pool || lv.items;
      const d = DEG[item];
      let cands;
      if (lv.wide) cands = [-12, 0, 12].map((o) => d.semi + o).filter((s) => s >= -8 && s <= 19);
      else cands = item === '1' ? [0, 12] : [d.semi];
      const semi = pick(cands);
      const ctx = contextEvents(tonic, mode, withContext);
      const t1 = contextLen(withContext);
      const target = [noteEv(t1, tonic + semi, 1.2, { role: 'target' })];
      const path = TL.resolutionPath(semi, mode);
      // notes the user has met, so the walk-home line can flag the ones still to come
      const known = new Set(['1', ...DEG_LEVELS.slice(0, Math.max(L, maxLevel ?? L) + 1).flatMap((l) => l.items)]);
      const unknown = [...new Set(path.map((s) => TL.degBySemi(s).id))].filter((id) => !known.has(id)).map((id) => nameOf(id, labels));
      return {
        kind: 'choice', layout: 'ladder', mode, tonic, withContext,
        prompt: withContext ? 'Which note comes after the chords?' : 'Which note is this?',
        options: sortBySemi(items).map(degOption),
        answer: item, stats: [item],
        audio: {
          main: [...ctx, ...target],
          parts: { context: TL.cadenceEvents(tonic, mode), target: shift(target, -t1) },
          reveal: resolutionEvents(tonic, semi, mode),
        },
        replays: [{ part: 'main', label: 'Replay all', key: 'Space' }, { part: 'target', label: 'Just the note' }, { part: 'context', label: 'Just the chords' }],
        compare: (id) => resolutionEvents(tonic, nearestSemi(id, semi), mode),
        explain: path.length === 1 ? 'Do is home. It has nowhere to go.' : path.map((s) => nameOf(TL.degBySemi(s).id, labels)).join(' → ') + (unknown.length ? `. You meet ${unknown.join(' and ')} in later levels.` : ''),
        explainLabel: path.length === 1 ? 'Home' : 'Walks home',
      };
    },
  };

  // ======================================================================
  // 2. INTERVALS
  // ======================================================================
  const ivs = (list, dir) => list.map((x) => x + dir);
  const ALLIV = INTERVALS.map((i) => i.id);
  const IV_LEVELS = [
    { name: 'Major 3rd, 5th and octave', items: ivs(['M3', 'P5', 'P8'], 'a'), introduce: ivs(['M3', 'P5', 'P8'], 'a'), introV: 2, note: 'An interval is the distance between two notes. You will hear two notes, low then high, and name how far apart they are. Each question starts on a different note, so listen to the size of the jump, not how high or low the notes are. The number in each name counts scale notes from the low note: Do, Re, Mi is three notes, so Do up to Mi is a 3rd. Ignore the words major and perfect for now.' },
    { name: 'Perfect 4th', items: ivs(['M3', 'P4', 'P5', 'P8'], 'a'), introduce: ['P4a'] },
    { name: 'Major 2nd and minor 3rd', items: ivs(['M2', 'm3', 'M3', 'P4', 'P5', 'P8'], 'a'), introduce: ['M2a', 'm3a'], note: 'A 2nd spans two scale notes, one step, like Do to Re. A minor 3rd is one half step smaller than a major 3rd and sounds darker. A half step is the distance to the very next key on a piano. It is the same difference that turns a major chord into a minor one.' },
    { name: 'Sixths and minor 2nd', items: ivs(['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'm6', 'M6', 'P8'], 'a'), introduce: ['m2a', 'm6a', 'M6a'] },
    { name: 'Sevenths and the tritone', items: ivs(ALLIV, 'a'), introduce: ['m7a', 'M7a', 'TTa'], note: 'All twelve ascending intervals.' },
    { name: 'Descending basics', items: ivs(['M2', 'm3', 'M3', 'P4', 'P5', 'P8'], 'd'), introduce: ivs(['M2', 'm3', 'M3', 'P4', 'P5', 'P8'], 'd'), note: 'Now the notes come high then low. Falling intervals have their own character. To name one, sing the two notes from low to high, call the low note Do and count up the scale, as before.' },
    { name: 'Descending: all', items: ivs(ALLIV, 'd'), introduce: ivs(['m2', 'TT', 'm6', 'M6', 'm7', 'M7'], 'd') },
    { name: 'Harmonic consonances', items: ivs(['m3', 'M3', 'P4', 'P5', 'm6', 'M6', 'P8'], 'h'), introduce: ivs(['m3', 'M3', 'P4', 'P5', 'm6', 'M6', 'P8'], 'h'), note: 'Both notes at once. Listen to the blend: how smooth or rough, how hollow or full. Sing the low note, then the high one, and count as before.' },
    { name: 'Harmonic: all', items: ivs(ALLIV, 'h'), introduce: ivs(['m2', 'M2', 'TT', 'm7', 'M7'], 'h') },
    { name: 'Everything mixed', items: [...ivs(ALLIV, 'a'), ...ivs(ALLIV, 'd'), ...ivs(ALLIV, 'h')], introduce: [], note: 'Any interval, any direction. The real-world test.' },
  ];
  const DIR_WORD = { a: 'ascending', d: 'descending', h: 'harmonic' };
  const DIR_PLAIN = { a: 'going up', d: 'going down', h: 'together' };
  function ivEvents(low, semi, dir, t = 0) {
    if (dir === 'a') return [noteEv(t, low, 0.85), noteEv(t + 0.85, low + semi, 1.2)];
    if (dir === 'd') return [noteEv(t, low + semi, 0.85), noteEv(t + 0.85, low, 1.2)];
    return [noteEv(t, [low, low + semi], 1.8)];
  }
  // scale-degree picture of an interval, written in the direction it is heard
  function ivDegrees(iv, dir) {
    return iv.deg.split(', ').map((p) => {
      const [lo, hi] = p.split(' → ');
      return dir === 'd' ? `${hi} down to ${lo}` : dir === 'h' ? `${lo} with ${hi} above` : `${lo} up to ${hi}`;
    }).join(', ');
  }
  const intervals = {
    id: 'intervals',
    name: 'Intervals',
    short: 'Intervals',
    hue: 195,
    blurb: 'The distance between two notes, going up, going down and together.',
    why: 'Intervals are how you measure melody and voice leading on the page, and how you check a leap you hear in your head.',
    task: 'You hear two notes. Name the distance between them.',
    levels: IV_LEVELS,
    picksItem: true,
    itemLabel: (it) => `${IV[it.slice(0, -1)].name} ${DIR_WORD[it.slice(-1)]}`,
    intro(L, { hints = {} }) {
      const lv = IV_LEVELS[L];
      const cards = lv.introduce.map((it) => {
        const id = it.slice(0, -1), dir = it.slice(-1);
        const iv = IV[id];
        const song = dir === 'd' ? iv.down : dir === 'a' ? iv.up : '';
        const roots = [randInt(50, 58), randInt(52, 60), randInt(48, 56)];
        const how = iv.plain ? iv.plain : `Where it appears in the scale: ${ivDegrees(iv, dir)}.`;
        const extra = dir === 'd' ? ' Here you hear it falling: the high note comes first.' : dir === 'h' ? ' Here both notes sound at once.' : '';
        return {
          id: it, title: iv.name, sub: `${iv.short} · ${DIR_PLAIN[dir]}`,
          text: how + extra + (song ? ` You hear it in: ${song}.` : ''),
          hintKey: it, hint: hints[it] || '', hasSong: !!song,
          sing: dir === 'h' ? 'Sing the lower note, then the upper one.' : 'Sing both notes after you hear them.',
          demos: [
            { label: 'Hear it', events: ivEvents(roots[0], iv.semi, dir) },
            { label: 'From another note', events: ivEvents(roots[1], iv.semi, dir) },
            { label: dir === 'h' ? 'Note by note' : 'Both at once', events: dir === 'h' ? ivEvents(roots[2], iv.semi, 'a') : ivEvents(roots[2], iv.semi, 'h') },
          ],
        };
      });
      return { title: cards.length ? 'Meet the ' + (cards.length > 1 ? 'new intervals' : cards[0].title) : lv.name, note: lv.note, cards, demos: [] };
    },
    generate(L, { item, pool, hints = {} }) {
      const lv = IV_LEVELS[L];
      const items = pool || lv.items;
      const id = item.slice(0, -1), dir = item.slice(-1);
      const iv = IV[id];
      const low = dir === 'h' ? randInt(48, 64 - Math.min(iv.semi, 12)) : randInt(50, 70 - iv.semi);
      const ids = [...new Set(items.map((x) => x.slice(0, -1)))].sort((a, b) => IV[a].semi - IV[b].semi);
      const dirs = [...new Set(items.map((x) => x.slice(-1)))];
      const main = ivEvents(low, iv.semi, dir);
      const song = hints[item] || (dir === 'd' ? iv.down : dir === 'a' ? iv.up : '');
      const revealFor = (s) => (dir === 'h' ? [...ivEvents(low, s, 'a'), noteEv(2.2, [low, low + s], 1.2)] : [...ivEvents(low, s, dir), noteEv(2.25, [low, low + s], 1.2)]);
      const PROMPT = { a: 'Two notes, low then high. Which interval is it?', d: 'Two notes, high then low. Which interval is it?', h: 'Two notes at once. Which interval is it?' };
      return {
        kind: 'choice', layout: 'grid',
        prompt: dirs.length > 1 ? 'Which interval is it?' : PROMPT[dir],
        options: ids.map((x) => ({ id: x, label: IV[x].name, sub: IV[x].short })),
        answer: id, stats: [item],
        audio: { main, parts: {}, reveal: revealFor(iv.semi) },
        replays: [{ part: 'main', label: 'Replay', key: 'Space' }],
        compare: (x) => revealFor(IV[x].semi),
        explain: ivDegrees(iv, dir) + (song ? ` · ${song}` : ''),
        explainLabel: 'Hear it as',
      };
    },
  };

  // ======================================================================
  // 3. CHORD QUALITIES
  // ======================================================================
  const CH_LEVELS = [
    { name: 'Major and minor', items: ['maj', 'min'], introduce: ['maj', 'min'], introV: 2, note: 'A chord’s quality is its kind: major, minor and so on. Each kind has its own color, whatever note it is built on. Major sounds bright and settled. Minor sounds darker. Only one note differs: in minor, the middle of the three notes is one half step lower. A half step is the distance to the very next key on a piano, black or white. Each question starts on a different note, so listen for the color, not how high or low it is.' },
    { name: 'Diminished', items: ['maj', 'min', 'dim'], introduce: ['dim'] },
    { name: 'Augmented', items: ['maj', 'min', 'dim', 'aug'], introduce: ['aug'] },
    { name: 'Inversions', items: ['maj', 'min', 'dim', 'aug'], inversions: true, introduce: [], note: 'The same chords, now with a different note at the bottom. The kind stays the same; listen through the arrangement to the color.' },
    { name: 'Seventh chords', items: ['maj7', 'dom7', 'min7'], introduce: ['maj7', 'dom7', 'min7'], note: 'A seventh chord is a three-note chord with a fourth note stacked on top. The added note changes the color.' },
    { name: 'Half- and fully diminished', items: ['maj7', 'dom7', 'min7', 'm7b5', 'dim7'], introduce: ['m7b5', 'dim7'] },
    { name: 'Minor-major 7', items: ['maj7', 'dom7', 'min7', 'm7b5', 'dim7', 'mmaj7'], introduce: ['mmaj7'] },
    { name: 'Color chords', items: ['maj', 'min', 'sus2', 'sus4', 'add9', 'maj6', 'min6'], introduce: ['sus2', 'sus4', 'add9', 'maj6', 'min6'], note: 'The sounds of film, pop and jazz writing.' },
  ];
  function chordEvents(notes, t = 0) {
    return [noteEv(t, notes, 1.7)];
  }
  // note by note (without the doubled bass, so the count matches the text), then all at once
  function brokenEvents(root, quality, inv = 0, t = 0) {
    const arp = TL.chordVoicing(root, quality, inv, false);
    return [...arp.map((m, i) => noteEv(t + i * 0.36, m, 0.36 * (arp.length - i) + 0.8)), noteEv(t + arp.length * 0.36 + 0.9, TL.chordVoicing(root, quality, inv), 1.4)];
  }
  const chords = {
    id: 'chords',
    name: 'Chord Qualities',
    short: 'Chords',
    hue: 280,
    blurb: 'Recognize the kind of chord by its color: major, minor, diminished, sevenths and beyond.',
    why: 'Quality is the first thing you choose when you voice a harmony. Hearing it instantly lets you pick chords by sound.',
    task: 'You hear one chord. Choose its kind, such as major or minor.',
    levels: CH_LEVELS,
    picksItem: true,
    itemLabel: (id) => CHORD_TYPES[id].name,
    intro(L) {
      const lv = CH_LEVELS[L];
      const cards = lv.introduce.map((id) => {
        const r = randInt(55, 62);
        const c = CHORD_TYPES[id];
        const ref = c.tones.length > 3 && !['add9', 'maj6', 'min6'].includes(id) ? null : id === 'dim' || id === 'min6' ? 'min' : 'maj';
        return {
          id, title: c.name, sub: '',
          text: [c.feel, c.build, `Written C${c.sym} when built on C.`].filter(Boolean).join(' '),
          sing: 'Press Note by note and sing along with each note, from the bottom up.',
          demos: [
            { label: 'All at once', events: chordEvents(TL.chordVoicing(r, id)) },
            { label: 'Note by note', events: brokenEvents(r, id) },
            ...(ref && ref !== id ? [{ label: `${CHORD_TYPES[ref].name}, then ${c.name.toLowerCase()}`, events: [...chordEvents(TL.chordVoicing(r, ref)), ...chordEvents(TL.chordVoicing(r, id), 2.0)] }] : []),
          ],
        };
      });
      const r = randInt(55, 62);
      return {
        title: cards.length ? 'Meet ' + (cards.length > 2 ? 'the new chords' : cards.map((c) => c.title.toLowerCase()).join(' and ')) : lv.name,
        note: lv.note, cards,
        demos: cards.length ? [] : [{ label: 'Major, three ways', events: [0, 1, 2].flatMap((inv, i) => chordEvents(TL.chordVoicing(r, 'maj', inv), i * 2)) }],
      };
    },
    generate(L, { item, pool }) {
      const lv = CH_LEVELS[L];
      const items = pool || lv.items;
      const root = randInt(53, 62);
      const n = CHORD_TYPES[item].tones.length;
      const inv = lv.inversions ? randInt(0, n - 1) : 0;
      const notes = TL.chordVoicing(root, item, inv);
      const INV = ['root position', 'first inversion', 'second inversion', 'third inversion'];
      return {
        kind: 'choice', layout: 'grid',
        prompt: 'What kind of chord is this?',
        options: items.map((x) => ({ id: x, label: CHORD_TYPES[x].name })),
        answer: item, stats: [item],
        audio: {
          main: chordEvents(notes),
          parts: { arp: brokenEvents(root, item, inv) },
          reveal: brokenEvents(root, item, inv),
        },
        replays: [{ part: 'main', label: 'Replay', key: 'Space' }, { part: 'arp', label: 'Note by note' }],
        compare: (x) => brokenEvents(root, x, Math.min(inv, CHORD_TYPES[x].tones.length - 1)),
        explain: CHORD_TYPES[item].feel + (lv.inversions ? ` (${INV[inv]})` : ''),
        explainLabel: 'Sound',
      };
    },
  };

  // ======================================================================
  // 4. HARMONY (progressions)
  // ======================================================================
  const HA_LEVELS = [
    { name: 'I and V', pool: ['I', 'V'], introduce: ['I', 'V'], length: 4, allowRepeat: true, introV: 2, note: 'Chords are named with Roman numerals (I = 1, V = 5) for the note of the key they are built on. I is the chord built on Do, the home chord. V is the chord built on Sol. In this level the bass, the lowest note, is always that note: Do under I, Sol under V. Follow the bass and you know the chord. No key-setting chords play here: the first chord is always I.' },
    { name: 'IV', pool: ['I', 'IV', 'V'], introduce: ['IV'], length: 4, allowRepeat: true },
    { name: 'vi', pool: ['I', 'IV', 'V', 'vi'], introduce: ['vi'], length: 4, note: 'Lower-case numerals mean minor chords: vi is the minor chord built on La. Follow the bass first, then listen for bright (major) or dark (minor).' },
    { name: 'ii', pool: ['I', 'ii', 'IV', 'V', 'vi'], introduce: ['ii'], length: 4 },
    { name: 'iii and vii°', pool: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], introduce: ['iii', 'vii°'], length: 4, note: 'The ° sign means diminished: vii° is the tense chord built on Ti.' },
    { name: 'V7 and first inversions', pool: ['I', 'ii', 'IV', 'V', 'vi', 'V7', 'I6', 'ii6', 'V6'], introduce: ['V7', 'I6', 'ii6', 'V6'], length: 5, note: 'A 6 after a numeral means a different note is in the bass: Mi under I6, Ti under V6, Fa under ii6. The chord is the same; only the bass changes. Hear the bass first, then the color above it.' },
    { name: 'Borrowed chords', pool: ['I', 'ii', 'IV', 'V', 'vi', 'iv', '♭VI', '♭VII'], introduce: ['iv', '♭VI', '♭VII'], length: 5, note: 'Chords borrowed from the minor key with the same Do. A staple of film scoring.' },
    { name: 'Secondary dominants', pool: ['I', 'ii', 'IV', 'V', 'vi', 'V7', 'V/V', 'V/vi', 'V/ii'], introduce: ['V/V', 'V/vi', 'V/ii'], length: 5, note: 'A secondary dominant is a major chord that points at another chord the way V points at I. V/V points at V.' },
    { name: 'Minor keys', mode: 'minor', pool: ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'VII'], introduce: ['i', 'iv', 'V', 'VI', 'III', 'VII', 'ii°'], length: 5 },
  ];
  HA_LEVELS.forEach((lv) => (lv.items = lv.pool));
  function progEvents(voicings, t = 0, beat = 1.05) {
    return voicings.map((v, i) => noteEv(t + i * beat, v, i === voicings.length - 1 ? 1.7 : beat * 0.94, { vel: 0.62, slot: i }));
  }
  function bassEvents(voicings, t = 0, beat = 1.05) {
    return voicings.map((v, i) => noteEv(t + i * beat, v[0], i === voicings.length - 1 ? 1.5 : beat * 0.94, { slot: i }));
  }
  function harmonyTip(pool) {
    const byBass = {};
    pool.forEach((x) => (byBass[TL.rnBassPc(x)] = byBass[TL.rnBassPc(x)] || []).push(x));
    const pairs = Object.values(byBass).filter((g) => g.length > 1).map((g) => g.join(' and '));
    const inverted = pool.filter((x) => RN[x].inv);
    if (!pairs.length && !inverted.length) return 'Follow the bass, the lowest note. Sing each bass note and name it against Do. Then pick the chord built on that note.';
    const BASS = { I6: 'Mi under I6', V6: 'Ti under V6', ii6: 'Fa under ii6' };
    return 'Follow the bass, the lowest note, and name it against Do. It narrows the choice'
      + (pairs.length ? `, but here some chords share a bass: ${pairs.join('; ')}.` : '.')
      + (inverted.length ? ` A chord marked 6 has a different note in the bass: ${inverted.map((x) => BASS[x] || x).join(', ')}.` : '')
      + ` Then listen to the color: major or minor${pool.includes('V7') ? ', with or without the extra tense note' : ''}.`;
  }
  const harmony = {
    id: 'harmony',
    name: 'Harmony',
    short: 'Harmony',
    hue: 92,
    blurb: 'Name chords by their place in a key: I, IV, V, vi and onward to borrowed chords.',
    why: 'This is where ear training meets composition: hearing a progression and knowing what it is, so you can write what you hear.',
    task: 'You hear a few chords. The first one is given. Name the others in order.',
    levels: HA_LEVELS,
    usesKey: true,
    modeOf: (L) => HA_LEVELS[L].mode || 'major',
    itemLabel: (id) => id,
    intro(L, { tonic, labels }) {
      const lv = HA_LEVELS[L];
      const mode = lv.mode || 'major';
      const T = mode === 'minor' ? 'i' : 'I';
      const cards = lv.introduce.map((id) => {
        let seq;
        if (id === T) seq = [T];
        else {
          const nexts = Object.entries(TL.NEXT[id] || {}).filter(([k]) => lv.pool.includes(k) && k !== id).sort((a, b) => b[1] - a[1]);
          const after = nexts.length ? nexts[0][0] : T;
          seq = after === T ? [T, id, T] : [T, id, after, T];
        }
        const v = TL.voiceProgression(seq, tonic);
        return {
          id, title: id, serif: true, sub: `bass: ${nameOf(TL.degBySemi(TL.rnBassPc(id)).id, labels)}`,
          text: mode === 'minor' ? RN[id].desc.replace(/\bI\b/g, 'i') : RN[id].desc,
          sing: 'Sing the bass note of each chord along with it.',
          demos: [
            { label: seq.length > 1 ? seq.join(' – ') : 'Hear it', events: progEvents(v) },
            ...(seq.length > 1 ? [{ label: 'Chord alone', events: progEvents([TL.voiceChord(TL.rnPcs(id), TL.rnBassPc(id), tonic, null)]) }] : []),
            { label: 'Bass line', events: bassEvents(v) },
          ],
        };
      });
      return { title: cards.length ? 'Meet ' + lv.introduce.join(', ') : lv.name, note: lv.note, cards, demos: [] };
    },
    generate(L, { tonic, labels }) {
      const lv = HA_LEVELS[L];
      const mode = lv.mode || 'major';
      const seq = TL.genProgression({ pool: lv.pool, length: lv.length, mode, allowRepeat: lv.allowRepeat, focus: Math.random() < 0.7 ? lv.introduce.filter((x) => x !== 'I' && x !== 'i') : [] });
      const v = TL.voiceProgression(seq, tonic);
      const answer = seq.slice(1);
      return {
        kind: 'sequence', layout: 'grid', mode, tonic,
        prompt: `You hear ${seq.length} chords. The first is ${seq[0]}. Name the other ${seq.length - 1} in order.${lv.allowRepeat ? ' The same chord can play twice in a row.' : ''}`,
        options: lv.pool.map((x) => ({ id: x, label: x, serif: true })),
        given: [seq[0]], answer, stats: answer,
        listenTip: harmonyTip(lv.pool),
        audio: {
          main: progEvents(v),
          parts: { bass: bassEvents(v) },
          reveal: progEvents(v),
        },
        replays: [{ part: 'main', label: 'Replay', key: 'Space' }, { part: 'bass', label: 'Bass line' }],
        // the answer keeps the question's voicings up to the first chord that differs
        compare: (ans) => {
          const full = [seq[0], ...ans];
          let k = 1;
          while (k < full.length && full[k] === seq[k]) k++;
          return progEvents(TL.voiceProgression(full, tonic, v.slice(0, k)));
        },
        explain: seq.map((x) => nameOf(TL.degBySemi(TL.rnBassPc(x)).id, labels)).join(' – '),
        explainLabel: 'Bass line',
        seqLabels: seq,
      };
    },
  };

  // ======================================================================
  // 5. MELODIC DICTATION
  // ======================================================================
  const ME_LEVELS = [
    { name: 'Do, Re, Mi', pool: [0, 2, 4], length: 3, starts: [0, 4], ends: [0, 4], maxLeap: 2, leapProb: 0, introV: 2 },
    { name: 'Up to Sol', pool: [0, 2, 4, 5, 7], length: 4, starts: [0, 4], ends: [0], maxLeap: 2, leapProb: 0 },
    { name: 'Leaps in the home chord', pool: [0, 2, 4, 5, 7], length: 4, starts: [0, 4, 7], ends: [0], maxLeap: 7, leapProb: 0.4 },
    { name: 'Below Do', pool: [-5, -3, -1, 0, 2, 4, 5, 7], length: 5, starts: [0, -5], ends: [0], maxLeap: 5, leapProb: 0.3 },
    { name: 'The full octave', pool: [-1, 0, 2, 4, 5, 7, 9, 11, 12], length: 5, starts: [0, 4, 7], ends: [0, 12], maxLeap: 7, leapProb: 0.3 },
    { name: 'Six notes', pool: [-5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12], length: 6, starts: [0, 4, 7, -5], ends: [0, 12], maxLeap: 9, leapProb: 0.35 },
    { name: 'Eight notes', pool: [-5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12], length: 8, starts: [0, 4, 7, -5], ends: [0, 12], maxLeap: 12, leapProb: 0.35 },
    { name: 'Chromatic color', pool: [-5, -3, -1, 0, 2, 4, 5, 6, 7, 9, 10, 11, 12], chromatic: { 6: 7, 10: 9 }, length: 6, starts: [0, 4, 7], ends: [0, 12], maxLeap: 7, leapProb: 0.3, introduce: ['#4', 'b7'] },
    { name: 'Minor melodies', mode: 'minor', pool: [-5, -4, -2, -1, 0, 2, 3, 5, 7, 8, 10, 12], chromatic: { '-1': 0 }, length: 6, starts: [0, 3, 7], ends: [0, 12], maxLeap: 7, leapProb: 0.3 },
  ];
  ME_LEVELS.forEach((lv) => {
    lv.items = sortBySemi([...new Set(lv.pool.map((s) => TL.degBySemi(s).id))]);
    if (!lv.introduce) lv.introduce = [];
  });
  const melody = {
    id: 'melody',
    name: 'Melodic Dictation',
    short: 'Melody',
    hue: 145,
    blurb: 'Hear a short melody and write it down by note name.',
    why: 'Dictation is writing what you hear: the direct path from an idea in your head to the page.',
    task: 'You hear four chords, then a short melody. The first note is given. Name the others in order.',
    taskFor: (s) => (s.context === 'drone' ? 'You hear a drone built on Do, then a short melody. The first note is given. Name the others in order.' : s.cadenceEvery ? null : 'Four chords set the key when it changes. Then you hear a short melody. The first note is given. Name the others in order.'),
    levels: ME_LEVELS,
    usesKey: true,
    modeOf: (L) => ME_LEVELS[L].mode || 'major',
    itemLabel: (id) => `${DEG[id].sol} (${DEG[id].num})`,
    intro(L, { tonic, context = 'cadence', cadenceEvery = true }) {
      const lv = ME_LEVELS[L];
      const mode = lv.mode || 'major';
      const sample = TL.genMelody(lv);
      const lead = context === 'drone' ? 'First you hear a drone built on Do, the home note.' : cadenceEvery ? 'First you hear four chords that set the key.' : 'When the key changes, four chords set it first.';
      return {
        title: lv.name,
        note: (L === 0
          ? lead + ' Then a 3-note melody plays. It moves by step through Do, Re and Mi, and the first note is shown. Sing it back once, then tap the other notes on the ladder in the order you heard them.'
          : '') + (lv.introduce.length ? ' New colors appear: ' + lv.introduce.map((i) => DEG[i].sol).join(' and ') + '. Each one moves on by a half step.' : ''),
        cards: [],
        demos: [
          { label: 'Hear a sample', events: [...TL.cadenceEvents(tonic, mode), ...seqEvents(sample.map((s) => tonic + s), TL.cadenceLength() + GAP, 0.6, 1.1, (i) => ({ deg: TL.degBySemi(sample[i]).id }))] },
          { label: 'Notes in this level', events: seqEvents(lv.pool.map((s) => tonic + s), 0, 0.42, 0.9, (i) => ({ deg: TL.degBySemi(lv.pool[i]).id })) },
        ],
      };
    },
    generate(L, { tonic, withContext = true, labels }) {
      const lv = ME_LEVELS[L];
      const mode = lv.mode || 'major';
      const mel = TL.genMelody(lv);
      const ids = mel.map((s) => TL.degBySemi(s).id);
      const t1 = contextLen(withContext);
      const notes = seqEvents(mel.map((s) => tonic + s), t1, 0.6, 1.1, (i) => ({ deg: ids[i], slot: i, role: 'target' }));
      return {
        kind: 'sequence', layout: 'ladder', mode, tonic, withContext,
        prompt: `A ${mel.length}-note melody. The first note is ${nameOf(ids[0], labels)}. Name the other ${mel.length - 1} in order.`,
        options: lv.items.map(degOption),
        given: [ids[0]], answer: ids.slice(1), stats: ids.slice(1),
        melody: mel,
        audio: {
          main: [...contextEvents(tonic, mode, withContext), ...notes],
          parts: { melody: shift(notes, -t1), context: TL.cadenceEvents(tonic, mode) },
          reveal: shift(notes, -t1),
        },
        replays: [{ part: 'main', label: 'Replay all', key: 'Space' }, { part: 'melody', label: 'Just the melody' }, { part: 'context', label: 'Just the chords' }],
        compare: (ans) => {
          // place each answered note in the octave nearest the previous one, to hear the contour you wrote
          let prev = mel[0];
          const semis = [mel[0], ...ans.map((id) => { const s = nearestSemi(id, prev); prev = s; return s; })];
          return seqEvents(semis.map((s) => tonic + s), 0, 0.6, 1.1, (i) => ({ deg: TL.degBySemi(semis[i]).id, slot: i }));
        },
        tapSound: (id, around) => [noteEv(0, tonic + nearestSemi(id, around), 0.6)],
      };
    },
  };

  // ======================================================================
  // 6. RHYTHM
  // ======================================================================
  const RH_LEVELS = [
    { name: 'Quarters and halves', cells: ['q', 'h'], introduce: ['q', 'h'], bpm: 84, introV: 2, note: 'The steady click is the beat. Count 1 2 3 4 along with it. Every example starts with 4 get-ready clicks that set the speed. Then the rhythm plays as a knock with a soft tone that lasts as long as the note, while the clicks keep going. On your turn, tap once where each note starts. The first note always lands on the click right after the get-ready clicks.' },
    { name: 'Rests and long notes', cells: ['q', 'h', 'qr', 'dh'], introduce: ['qr', 'dh'], bpm: 84, introV: 2, note: 'A rest is a silence that still takes up time. The quarter rest here lasts one beat. Do not tap on it, but keep counting through it.' },
    { name: 'Eighth notes', cells: ['q', 'h', 'qr', 'ee'], introduce: ['ee'], bpm: 80 },
    { name: 'Dotted quarter', cells: ['q', 'ee', 'h', 'qr', 'dqe'], introduce: ['dqe'], bpm: 80 },
    { name: 'Sixteenths', cells: ['q', 'ee', 'ssss', 'ess', 'sse'], introduce: ['ssss', 'ess', 'sse'], bpm: 70 },
    { name: 'Syncopation', cells: ['q', 'ee', 'eqe', 'ere', 'des', 'h'], introduce: ['eqe', 'ere', 'des'], bpm: 74 },
    { name: 'Two bars', cells: ['q', 'ee', 'h', 'qr', 'dqe', 'ssss', 'ess', 'sse', 'eqe', 'ere'], bars: 2, introduce: [], bpm: 74, note: 'Two bars at a time. Chunk it: remember bar one as a single gesture, then bar two.' },
    { name: 'Triplets', cells: ['q', 'ee', 'trip', 'h', 'qr'], introduce: ['trip'], bpm: 70 },
    { name: 'Six-eight', meter: '6/8', cells: ['eee', 'qe', 'eq', 'dq', 'ssee', 'dqr'], introduce: ['eee', 'qe', 'eq', 'dq', 'ssee'], bpm: 56, note: 'Two big beats per bar, each divided in three. Count 1 to 6 with the clicks and feel the lilt.' },
  ];
  RH_LEVELS.forEach((lv) => (lv.items = lv.cells));
  const RH_TEXT = {
    q: { sub: '1 beat', text: 'One beat long. Tap on every click: 1 2 3 4.' },
    h: { sub: '2 beats', text: 'Two beats long. Here you tap on 1 and 3 and let each note ring through 2 and 4.' },
    qr: { sub: '1 beat of silence', text: 'One beat of silence. Do not tap. Keep counting through it.' },
    dh: { sub: '3 beats', text: 'Three beats long. The dot adds half the length again: 2 + 1 = 3. Here you tap on 1, let it ring through 2 and 3, then tap on 4.' },
    ee: { sub: '2 notes in 1 beat', text: 'Two even notes in one beat. Count 1 & 2 & 3 & 4 & (say “and” for each &), and tap on every number and every &. Each & falls exactly halfway between two clicks.' },
  };
  const RH_DEMO = { qr: ['q', 'qr', 'q', 'qr'], dh: ['dh', 'q'] };
  const rhythm = {
    id: 'rhythm',
    name: 'Rhythm',
    short: 'Rhythm',
    hue: 58,
    blurb: 'Hear a rhythm, then tap it back in time.',
    why: 'Rhythm carries a melody’s identity as much as pitch does. Tapping it back trains you to hear and place durations precisely.',
    task: 'You hear a rhythm over a steady click. Then you tap it back in time.',
    introFooter: 'Play each example a few times and tap or clap along before you start.',
    levels: RH_LEVELS,
    itemLabel: (id) => TL.RCELLS[id].label,
    intro(L) {
      const lv = RH_LEVELS[L];
      const meter = lv.meter || '4/4';
      const barTicks = meter === '6/8' ? 36 : 48;
      const cards = lv.introduce.map((c) => {
        let cells = RH_DEMO[c];
        if (!cells) {
          cells = [];
          while (cells.reduce((a, x) => a + TL.cellLen(x), 0) + TL.cellLen(c) <= barTicks) cells.push(c);
        }
        const r = { cells, ticks: cells.flatMap((x) => TL.RCELLS[x].ticks), meter, bars: 1, barTicks, beat: meter === '6/8' ? 18 : 12 };
        const t = RH_TEXT[c] || {};
        return { id: c, title: TL.RCELLS[c].label, sub: t.sub || '', text: t.text || '', rhythm: r, bpm: lv.bpm, demos: [] };
      });
      return { title: cards.length ? 'New rhythms' : lv.name, note: lv.note, cards, demos: [] };
    },
    generate(L) {
      const lv = RH_LEVELS[L];
      const r = TL.genRhythm({ cells: lv.cells, focus: Math.random() < 0.7 ? lv.introduce : [], bars: lv.bars || 1, meter: lv.meter || '4/4' });
      return {
        kind: 'tap', rhythm: r, bpm: lv.bpm,
        prompt: 'Listen, then tap the rhythm back.',
        stats: [...new Set(r.cells)],
      };
    },
  };

  // ======================================================================
  // 7. SING (audiation)
  // ======================================================================
  const SI_LEVELS = [
    { name: 'Find Do', type: 'degree', items: ['1'], introduce: ['1'], introV: 2 },
    { name: 'Do, Mi and Sol', type: 'degree', items: ['1', '3', '5'], introduce: ['3', '5'], introV: 2, needs: [{ track: 'degrees', level: 1 }], note: 'Now Mi and Sol join Do. All three are in the home chord, the last of the four chords. Find Do from the chords first, then step to the note you are asked for. Hum the steps quietly if you need them, then sing the note out loud and hold it.' },
    { name: 'All seven notes', type: 'degree', items: ALL7, introduce: ['2', '4', '6', '7'], introV: 2, needs: [{ track: 'degrees', level: 5 }], note: 'Now any of the seven notes: Do, Re, Mi, Fa, Sol, La, Ti. Find Do first every time, then step up or down to the note. “Play Do” is there if you lose it.' },
    { name: 'Sing a pattern', type: 'read', pool: [0, 2, 4, 5, 7], length: 3, maxLeap: 4, leapProb: 0.3, items: ['pattern3'], introduce: [], needs: [{ track: 'degrees', level: 5 }], note: 'Now you read and sing. You see three note names, like Do Re Mi. Every pattern starts on Do and stays between Do and Sol. Find Do from the chords, then sing each name out loud as you go.' },
    { name: 'Echo a melody', type: 'echo', pool: [-1, 0, 2, 4, 5, 7], length: 4, maxLeap: 4, leapProb: 0.3, items: ['echo4'], introduce: [], needs: [{ track: 'degrees', level: 5 }], note: 'You hear the four chords, then a short melody. When it ends, sing it back from memory. You do not need the note names. They are shown after you check.' },
    { name: 'Sing the bass', type: 'bass', chords: ['I', 'IV', 'V', 'vi', 'ii'], items: ['I', 'IV', 'V', 'vi', 'ii'], introduce: [], needs: [{ track: 'degrees', level: 5 }], note: 'The bass is the lowest note of a chord, the one the rest of the chord stands on. After the four chords, one more chord plays. Listen underneath it and sing its lowest note. Hum it if that is easier. Any height counts.' },
    { name: 'Longer patterns', type: 'read', pool: [-5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12], length: 5, maxLeap: 7, leapProb: 0.35, items: ['pattern5'], introduce: [], needs: [{ track: 'degrees', level: 5 }], note: 'Patterns now go below Do and up to High Do. A note marked low is below Do; Do marked high is High Do. The names sit higher or lower to show the shape.' },
    { name: 'Echo longer melodies', type: 'echo', pool: [-5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12], length: 6, maxLeap: 7, leapProb: 0.3, items: ['echo6'], introduce: [], needs: [{ track: 'degrees', level: 5 }], note: 'You hear the four chords, then a short melody. When it ends, sing it back from memory. You do not need the note names. They are shown after you check. Melodies can now go below Do and up to High Do.' },
  ];
  const VOICE = { low: 45, mid: 50, high: 57 };
  const VOICE_LABELS = [['low', 'Low (most men’s voices)'], ['mid', 'Middle (higher men’s voices)'], ['high', 'High (most women’s voices)']];
  function voiceTonic(tonic, voice) {
    const lo = VOICE[voice] ?? VOICE.mid;
    let t = tonic;
    while (t >= lo + 12) t -= 12;
    while (t < lo) t += 12;
    return t;
  }
  // Shift a set of notes (semitones from Do) by an octave when that keeps them closer to the voice's range.
  function rangeBase(vt, semis, voice) {
    const lo = (VOICE[voice] ?? VOICE.mid) - 2, hi = (VOICE[voice] ?? VOICE.mid) + 19;
    const mn = Math.min(...semis), mx = Math.max(...semis);
    const out = (b) => Math.max(0, lo - (mn + b)) + Math.max(0, mx + b - hi);
    let best = vt;
    for (const b of [vt - 12, vt + 12]) if (out(b) < out(best)) best = b;
    return best;
  }
  const singBase = (vt, s, voice) => rangeBase(vt, [s], voice);
  // the way from Do to a note, by step: up for Re to Sol, down for La and Ti
  function stepSemis(id) {
    const s = nearestSemi(id, 3);
    return s >= 0 ? [0, 2, 4, 5, 7].filter((x) => x <= s) : [0, -1, -3].filter((x) => x >= s);
  }
  const stepNames = (id, labels) => stepSemis(id).map((s) => nameOf(TL.degBySemi(s).id, labels)).join(', ');
  function stepEvents(id, base, start) {
    const ss = stepSemis(id);
    return seqEvents(ss.map((s) => base + s), start, 0.55, 2.0, (i) => ({ deg: TL.degBySemi(ss[i]).id, timbre: 'organ' }));
  }
  const SING_TEXT = {
    '3': 'Up from Do: Do, Re, Mi. It is in the home chord.',
    '5': 'Up from Do: Do, Re, Mi, Fa, Sol. It is in the home chord too.',
    '2': 'The next note up from Do. It sounds unfinished and wants to fall back to Do.',
    '4': 'Up from Do: Do, Re, Mi, Fa. It sits just above Mi and leans down onto it.',
    '6': 'Down from Do: Do, Ti, La.',
    '7': 'Just below Do: the note the top of the chords dips to before landing on Do. It pulls hard back up into Do.',
  };
  const SING_SUB = 'Sing out loud at any height that suits your voice.';
  const FIND_DO = {
    practicePrompt: 'Listen: four chords, then Do. Sing Do with it. When it stops, sing Do again on your own.',
    practiceLine: 'Practice round: the app plays Do for you after the chords. This round does not count toward the next level.',
    prompt: 'When the chords stop, sing Do.',
    hintLine: 'Do is the top note of the last chord, and its bottom note too. Sing it out loud at any height that suits your voice, and hold it.',
    fadedLine: 'Sing Do out loud at any height that suits your voice, and hold it. Listen for the note the chords come to rest on.',
    missTip: 'Missed is normal at first. Listen again: the chords, then Do. Hum Do along with it.',
    missLabel: 'Hear the chords, then Do',
  };
  const sing = {
    id: 'sing',
    name: 'Sing',
    short: 'Sing',
    hue: 255,
    blurb: 'Sing notes of the key, short patterns and melodies, then check them against the answer. This builds audiation: hearing music in your head.',
    why: 'If you can sing it, you can hear it in your head. That is how composers write away from an instrument.',
    task: 'You hear four chords, then sing what the screen asks for. Then the answer plays, and the app (with the microphone) or you check the singing.',
    introFooter: 'Play each example and hum along before you start.',
    levels: SI_LEVELS,
    picksItem: true,
    usesKey: true,
    selfGraded: true,
    voiceLabels: VOICE_LABELS,
    modeOf: () => 'major',
    itemLabel: (id) => (DEG[id] ? DEG[id].sol : RN[id] ? 'lowest note of ' + id : id.startsWith('echo') ? 'echo' : 'pattern'),
    intro(L, { tonic, voice, keyMode = 'rotate', labels = 'both', mic = 'none' }) {
      const lv = SI_LEVELS[L];
      const vt = voiceTonic(tonic, voice);
      const t1 = TL.cadenceLength() + GAP;
      const organ = (extra = {}) => ({ timbre: 'organ', ...extra });
      if (L === 0) {
        const doEv = (t, m, dur) => noteEv(t, m, dur, organ({ deg: '1' }));
        const top = TL.CADENCE.major.map((c) => c[c.length - 1]);
        return {
          title: 'Find Do, the home note',
          note: 'Every key has a home note, called Do. Music sounds finished when it lands there. Each question starts with four chords that set the key. They end on the home chord, the one that sounds finished. When they stop, sing Do out loud. '
            + (keyMode === 'fixed' ? 'The chords play every time, so you always hear where Do is.' : 'The key changes from question to question and Do moves with it, so the chords play every time.'),
          rangePicker: true,
          cards: [
            {
              id: '1', deg: '1', title: 'Do', sub: '1',
              text: 'Listen to the top note of the four chords. It holds, dips down a little, then steps back up to Do in the last chord. The bottom note of the last chord is Do too. Do can be sung high or low and it is still Do, the way a low voice and a high voice can sing the same melody. Sing it where it is comfortable.' + { both: ' On screen it is written Do 1: notes are also numbered, counting up from Do.', numbers: ' On screen it is written 1: notes are numbered, counting up from Do.', solfege: '' }[labels],
              sing: 'Play the first example again. Hum Do along with the last chord: its top note or its bottom note, whichever is easier to reach. Keep humming after the chords stop. The Do that plays next is the same note.',
              demos: [
                { label: 'The chords, then Do', events: [...TL.cadenceEvents(tonic, 'major'), doEv(t1, vt, 2.4)] },
                { label: 'Just the top notes', events: [...top.map((o, i) => noteEv(i * 0.62, tonic + o, i === 3 ? 1.05 : 0.59, { deg: TL.degBySemi(o).id })), doEv(t1, vt, 2.0)] },
                { label: 'Do, high to low', events: [noteEv(0, TL.CADENCE.major[3].map((o) => tonic + o), 1.4, { vel: 0.55 }), ...seqEvents([tonic + 12, tonic, tonic - 12], 1.7, 1.0, 1.6, () => organ({ deg: '1' }))] },
              ],
            },
            mic === 'on' ? {
              id: 'check', title: 'The app listens', sub: 'microphone',
              text: 'When the chords stop, sing Do on its name and hold it for a second or two, then stop. The answer plays next: sing along with it and listen for whether the two melt into one sound. Then the app shows what it heard and suggests a grade: Matched, Close or Missed. The same note sung higher or lower, the way a man and a woman sing the same melody, still counts. If the app misheard you, say so: that round is not scored.',
              sing: 'Practice rounds: right after this screen, and after two misses in a row, the app plays Do after the chords so you can copy it. Practice rounds do not count toward the next level.',
              demos: [],
            } : {
              id: 'check', title: 'Check yourself', sub: mic === 'ask' ? 'or the microphone' : 'by ear',
              text: (mic === 'ask' ? 'You check yourself, unless you let the app listen through your microphone; it asks when the singing starts. ' : 'You check yourself. ')
                + 'Sing first. Then press “I sang it: play the answer” and keep singing your note while it plays. Matched: the two melt into one sound and your voice does not have to move. Close: you had to move a little, or you slid into it. Missed: you had to move to a different note, or you hear two notes, even two that sound nice together. The same note sung higher or lower, the way a man and a woman sing the same melody, still counts. Not sure? Choose Close.',
              sing: 'Practice rounds: right after this screen, and after two misses in a row, the app plays Do after the chords so you can copy it. Practice rounds do not count toward the next level.',
              demos: [],
            },
          ],
          demos: [],
        };
      }
      if (lv.type === 'degree') {
        const cards = lv.introduce.map((id) => {
          const s = nearestSemi(id, 3);
          const base = singBase(vt, s, voice);
          return {
            id, deg: id, title: DEG[id].sol, sub: DEG[id].num,
            text: SING_TEXT[id],
            sing: `Find Do, then step: ${stepNames(id)}. Hold ${DEG[id].sol}.`,
            demos: [
              { label: 'From Do, after the chords', events: [...TL.cadenceEvents(tonic, 'major'), ...stepEvents(id, base, t1)] },
              { label: 'Just the note', events: [noteEv(0, base + s, 2.0, organ({ deg: id }))] },
            ],
          };
        });
        return { title: lv.name, note: lv.note, rangePicker: true, cards, demos: [] };
      }
      let demos;
      if (lv.type === 'read') {
        const semis = L === 3 ? [0, 2, 4, 5, 7, 5, 4, 2, 0] : lv.pool;
        const base = rangeBase(vt, semis, voice);
        demos = [{ label: L === 3 ? 'Do, Re, Mi, Fa, Sol and back' : 'The notes in this level', events: seqEvents(semis.map((s) => base + s), 0, 0.42, 0.9, (i) => organ({ deg: TL.degBySemi(semis[i]).id })) }];
      } else if (lv.type === 'echo') {
        const sample = TL.genMelody({ pool: lv.pool, length: lv.length, starts: [0, 4], ends: [0], maxLeap: lv.maxLeap, leapProb: lv.leapProb });
        demos = [{ label: 'Hear an example', events: [...TL.cadenceEvents(tonic, 'major'), ...seqEvents(sample.map((s) => tonic + s), t1, 0.6, 1.0)] }];
      } else {
        const v = TL.voiceChord(TL.rnPcs('IV'), TL.rnBassPc('IV'), tonic, null);
        demos = [{ label: 'A chord, its lowest note, then that note for your voice', events: [noteEv(0, v, 1.6, { vel: 0.6 }), noteEv(1.8, v[0], 1.6), noteEv(3.6, singBase(vt, 5, voice) + 5, 2.0, organ({ deg: '4' }))] }];
      }
      return { title: lv.name, note: lv.note, rangePicker: true, cards: [], demos };
    },
    generate(L, { tonic, item, voice = 'mid', practice = false, fade = false, labels }) {
      const lv = SI_LEVELS[L];
      const vt = voiceTonic(tonic, voice);
      const ctx = TL.cadenceEvents(tonic, 'major');
      const t1 = TL.cadenceLength() + GAP;
      const organ = (extra = {}) => ({ timbre: 'organ', ...extra });
      let q;
      if (lv.type === 'degree') {
        const d = DEG[item];
        const s = nearestSemi(item, 3);
        const base = singBase(vt, s, voice);
        q = { deg: item, reveal: [noteEv(0, base + s, 3.0, organ({ deg: item }))] };
        if (item === '1') {
          const isPractice = practice && L === 0;
          const doNote = noteEv(t1, vt, 2.4, organ({ deg: '1' }));
          Object.assign(q, {
            prompt: isPractice ? FIND_DO.practicePrompt : FIND_DO.prompt,
            subline: isPractice ? FIND_DO.practiceLine : fade && L === 0 ? FIND_DO.fadedLine : FIND_DO.hintLine,
            main: isPractice ? [...ctx, doNote] : ctx,
            model: [...ctx, doNote],
            missTip: FIND_DO.missTip,
            missLabel: FIND_DO.missLabel,
            replays: [{ part: 'main', label: isPractice ? 'Replay the chords and Do' : 'Replay the chords', key: 'Space' }],
            practice: isPractice,
          });
        } else {
          const nm = nameOf(item, labels);
          Object.assign(q, {
            prompt: `When the chords stop, find Do, then sing ${nm}.`,
            subline: `Find Do, step to ${nm} under your breath, then take a breath and sing ${nm} out loud on its name. Hold it. Any height counts.`,
            main: ctx,
            model: [...ctx, ...stepEvents(item, base, t1)],
            missTip: `Find Do first, then step to ${nm}: ${stepNames(item, labels)}.`,
            missLabel: `Hear Do, then ${nm}`,
            parts: { do: [noteEv(0, base, 2.0, organ({ deg: '1' }))] },
            replays: [{ part: 'main', label: 'Replay the chords', key: 'Space' }, { part: 'do', label: 'Play Do' }],
          });
        }
      } else if (lv.type === 'read') {
        const mel = TL.genMelody({ pool: lv.pool, length: lv.length, starts: [0], ends: [0, 4, 7, 12], maxLeap: lv.maxLeap, leapProb: lv.leapProb });
        const base = rangeBase(vt, mel, voice);
        q = {
          pattern: mel.map((s) => TL.degBySemi(s).id), patternSemis: mel,
          prompt: 'When the chords stop, sing these notes, starting on Do.',
          subline: 'Sing the names out loud, at any height that suits your voice.',
          main: ctx,
          reveal: seqEvents(mel.map((s) => base + s), 0, 0.55, 1.0, (i) => organ({ deg: TL.degBySemi(mel[i]).id })),
        };
      } else if (lv.type === 'echo') {
        const mel = TL.genMelody({ pool: lv.pool, length: lv.length, starts: [0, 4], ends: [0], maxLeap: lv.maxLeap, leapProb: lv.leapProb });
        const base = rangeBase(vt, mel, voice);
        q = {
          prompt: 'Listen to the melody after the chords. Then sing it back.',
          subline: 'Sing it back out loud, at any height that suits your voice. Replaying the melody makes this a practice round.',
          main: [...ctx, ...seqEvents(mel.map((s) => tonic + s), t1, 0.6, 1.0)],
          reveal: seqEvents(mel.map((s) => base + s), 0, 0.6, 1.0, (i) => organ({ deg: TL.degBySemi(mel[i]).id })),
          echoAnswer: mel.map((s) => TL.degBySemi(s).id), echoSemis: mel,
          replays: [{ part: 'main', label: 'Replay (makes this a practice round)', key: 'Space' }],
        };
      } else {
        const v0 = TL.voiceChord(TL.rnPcs('I'), TL.rnBassPc('I'), tonic, null);
        const v = TL.voiceChord(TL.rnPcs(item), TL.rnBassPc(item), tonic, v0);
        const bid = TL.degBySemi(TL.rnBassPc(item)).id;
        const s = nearestSemi(bid, 3);
        const base = singBase(vt, s, voice);
        q = {
          prompt: 'After the four chords, one more chord plays. Sing its lowest note.',
          subline: 'Listen underneath the last chord, and hum or sing its lowest note. Any height counts.',
          main: [...ctx, noteEv(t1, v, 2.2, { vel: 0.6 })],
          reveal: [noteEv(0, base + s, 3.0, organ({ deg: bid })), noteEv(3.1, v, 1.6, { vel: 0.55 })],
          bassAnswer: bid,
          parts: { chord: [noteEv(0, v, 2.2, { vel: 0.6 })] },
          replays: [{ part: 'main', label: 'Replay all', key: 'Space' }, { part: 'chord', label: 'Last chord only' }],
        };
      }
      return {
        kind: 'sing', tonic, mode: 'major', ...q,
        subline: q.subline || SING_SUB,
        practice: !!q.practice,
        stats: [item],
        audio: { main: q.main, parts: { context: ctx, ...(q.parts || {}), ...(q.model ? { model: q.model } : {}) }, reveal: q.reveal },
        replays: q.replays || [{ part: 'main', label: 'Replay', key: 'Space' }],
      };
    },
  };

  // ======================================================================
  const TRACKS = [degrees, intervals, chords, harmony, melody, rhythm, sing];
  const TRACK = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
  // Prerequisites keep a beginner from facing dictation and harmony before the ear has a frame.
  const PREREQ = {
    melody: [{ track: 'degrees', level: 2 }],
    harmony: [{ track: 'degrees', level: 3 }, { track: 'chords', level: 1 }],
  };
  // Every level whose introduction text or demos were rewritten in version 2.
  [DEG_LEVELS, IV_LEVELS, CH_LEVELS, HA_LEVELS, RH_LEVELS, SI_LEVELS].forEach((levels) => levels.forEach((lv) => (lv.introV = lv.introV || 2)));
  ME_LEVELS[0].introV = 2;
  TL.Curriculum = { TRACKS, TRACK, PREREQ, voiceTonic, ALL7, ALL12, VOICE_LABELS };
})(typeof window !== 'undefined' ? window : globalThis);
