'use strict';
// The app itself, run in Node (tone-ladder/app-harness/trace.mjs: a fake DOM, a recording stand-in for
// sound, a virtual clock): every view, every track page, a long daily session, Progress (and its
// week-by-week charts for every track, over twelve weeks of history with a step back after a new
// level and a finished track), Preferences and Explore, with no error anywhere, no chart drawing a
// missing number and no chart line across a new level, a step back after finishing a track called
// one, and an answer while the question still sounds timed at nothing (one after a replayed part
// of it not timed); Full Dictation answered right, wrong and with an extra note, with nothing written
// while the melody first plays and a held Space as one hearing; its staves as drawn against the
// question (systems, time signature, bar lines, and each note's place, accidental, beam, red mark and
// ruled length); writing along a hearing makes no sound (but does once it is over, with a drone on),
// the pill reads Listening while Play mine plays, the focus stays in the stage, each note slot is
// labelled, replay buttons keep different names and a phone's two systems share a scale; app.css
// keeps rows of graded slots apart and the palette within a 320px phone; a long answer's time is
// counted up to its track's limit; Method says when every track opens and states Full Dictation's
// own rule; Preferences (and prefs.js) and the microphone question name each dictation track; and
// on every path the trace drives, the claude.ai bundle of the
// modules does exactly what the modules do, step for step.
//   node tone-ladder/tests/app-check.js [path/to/static/tone-ladder]
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder'));
const trace = path.join(__dirname, '..', 'app-harness', 'trace.mjs');
let bad = 0;
const fail = (m) => { bad++; console.log(m); };
const run = (mode) => {
  const r = spawnSync(process.execPath, [trace, mode, dir], { encoding: 'utf8', env: { ...process.env, TZ: 'Australia/Melbourne' }, maxBuffer: 1 << 28 });
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  const errors = lines.filter((l) => /^\["(listener|timer|rejection|load|run)-error"/.test(l));
  errors.forEach((l) => fail(`${mode}: ${l.slice(0, 240)}`));
  if (r.status !== 0 && !errors.length) fail(`${mode}: the trace stopped: ${(r.stderr || '').split('\n').find((l) => /^\w*Error\b/.test(l)) || (r.stderr || '').split('\n')[0]}`);
  return { lines, stopped: r.status !== 0 };
};
const M = run('modules'), B = run('bundle');
// the rest compares what happened, which says little once a trace has stopped
if (!M.stopped && !B.stopped) {
  const steps = M.lines.filter((l) => l.startsWith('["step"'));
  if (steps.length < 40) fail(`only ${steps.length} steps ran: the session stopped early`);
  for (const want of ['"view music"', '"view prefs"', '"track sight"', '"summary"', '"progress weeks"', '"explore"', '"dictation feedback right"', '"dictation feedback wrong"', '"dictation feedback extra"']) if (!steps.some((l) => l.includes(want))) fail(`the trace never reached ${want}`);
  // the week-by-week charts draw numbers, never a missing one
  const charts = M.lines.filter((l) => l.startsWith('["html"')).map((l) => JSON.parse(l)[2]).filter((h) => typeof h === 'string' && h.includes('<svg class="chart"'));
  if (!charts.some((h) => h.includes('class="dot"'))) fail('no week-by-week chart drew a point');
  // and the history reaches each kind of chart and sentence: all nine tracks, a step back after a
  // new level, a finished track
  for (const t of ['Scale Degrees', 'Intervals', 'Chord Qualities', 'Harmony', 'Melodic Dictation', 'Rhythm', 'Full Dictation', 'Sing', 'Sight-Singing']) if (!charts.some((h) => h.includes(`aria-label="Accuracy in ${t},`))) fail(`no accuracy chart for ${t}`);
  for (const want of ['Answer speed in Harmony', 'Intonation in Sight-Singing', 'and a new level is harder.', 'You finished the track on', '>Done</text>', '<td>Finished</td>', 'Times are kept from', 'A week shows here once it has 20 answers']) if (!charts.some((h) => h.includes(want))) fail(`the week-by-week charts never showed: ${want}`);
  // a line never runs across a new level: no level mark inside a segment, or on its right-hand dot
  for (const svg of charts.flatMap((h) => h.split('<svg class="chart"').slice(1))) {
    const marks = [...svg.matchAll(/<line class="lvl" x1="([\d.]+)"/g)].map((x) => +x[1]);
    for (const x of svg.matchAll(/<path class="(?:line|gap)" d="M([\d.]+),[\d.]+ L([\d.]+),/g)) {
      if (marks.some((mx) => mx > +x[1] + 1e-6 && mx <= +x[2] + 1e-6)) { fail(`a chart line runs across a new level: ${svg.match(/aria-label="([^"]*)"/)[1]}`); break; }
    }
  }
  // finishing a track is not a new level: a step back after it is called one
  if (charts.some((h) => /You finished the track on [^.<]*, and /.test(h))) fail('a step back after finishing a track was put down to a new level');
  if (!charts.some((h) => /Down from \d+% the 7 days before\. You finished the track on/.test(h))) fail('no step back after finishing a track was called one');
  const broken = charts.find((h) => /NaN|undefined|Infinity/.test(h));
  if (broken) fail(`a chart drew a missing number: ${broken.match(/.{0,80}(NaN|undefined|Infinity).{0,40}/)[0]}`);
  // an error's location differs between the two builds; what it says does not
  const same = (l) => (/^\["(listener|timer|rejection)-error"/.test(l) ? l.split(' | ')[0] : l);
  const mods = M.lines.map(same), bund = B.lines.map(same);
  const i = mods.findIndex((l, k) => l !== bund[k]);
  if (i >= 0 && i < Math.min(mods.length, bund.length)) fail(`the bundle differs from the modules at line ${i + 1}: ${String(mods[i]).slice(0, 160)} | ${String(bund[i]).slice(0, 160)}`);
  else if (mods.length !== bund.length) fail(`the modules printed ${mods.length} lines and the bundle ${bund.length}`);
}
// Full Dictation: a key pressed while the melody first plays writes nothing, and each answer's
// feedback says what it should: all correct; a wrong figure and a wrong name in words; the extra note,
// and the practice round a fifth hearing made
if (!M.stopped) {
  const first = M.lines.filter((l) => l.startsWith('["dict"')).map((l) => JSON.parse(l)).find((x) => x[1] === 'a key while the melody first plays');
  if (!first || !first[2] || first[2].entry.figs.length || first[2].mainEnd) fail(`a key while the melody first played was not ignored: ${JSON.stringify(first)}`);
  const shown = (label) => { const i = M.lines.findIndex((l) => l.startsWith(`["step","${label}"`)); const h = M.lines.slice(0, Math.max(0, i)).reverse().find((l) => l.startsWith('["html","#stage"')); return h ? JSON.parse(h)[2] : ''; };
  const want = { 'dictation feedback right': ['>All correct<'], 'dictation feedback wrong': ['notes right<', '. You wrote ', 'class="dchip is-wrong"', 'class="score dict-staff sight-staff"'], 'dictation feedback extra': ['1 extra note.', 'A practice round'] };
  for (const [label, parts] of Object.entries(want)) for (const p of parts) if (!shown(label).includes(p)) fail(`${label}: the screen never showed ${p}`);
}
// Full Dictation's staves as drawn, against what they were drawn from (the trace's dictq and
// dictintro lines). Every drawing: a staff (never the empty fallback), two systems for four bars
// below 520px, the time signature on the first only, a bar line per bar. At each point the trace
// logs the entry: what is written, in order (named notes on their letters, the given first note on
// the melody's own, unnamed ones as slashes on the middle line, rests, a box per empty beat), an
// accidental on a named note only where its alteration differs from the key signature's or from an
// earlier one on that step in the bar, and a beam over each run of flagged notes in a beat. After
// Check, what was written with the names that are not the melody's on that beat red, and the
// melody on its own notes with its names under it, those not written red and its lengths not
// written ruled (in the trace's answers each written note pairs with the melody's note on its
// beat). Level 1's introduction draws its staff likewise.
if (!M.stopped) {
  const said = new Set(), note = (m) => { if (!said.has(m)) { said.add(m); fail(m); } }; // a fault once, not per drawing
  const NATURAL = [0, 2, 4, 5, 7, 9, 11];
  // the alteration (-2 .. 2) that puts letter L (0 = C) on a pitch
  const altOf = (L, midi) => ((((midi - NATURAL[L]) % 12) + 18) % 12) - 6;
  // a note's place on the treble staff in steps above the middle line (B4), and a step's letter
  const stepOf = (midi, L) => ((midi - altOf(L, midi) - NATURAL[L]) / 12 - 1) * 7 + L - 34;
  const letterOf = (step) => (((step + 6) % 7) + 7) % 7;
  const letter = (q, id) => ('CDEFGAB'.indexOf(q.key[0]) + Number(id.slice(-1)) - 1) % 7;
  // a name's semitones above Do, and the key signature: each letter's alteration in the mode's
  // scale spelled up from the tonic's letter
  const semiOf = (id) => NATURAL[id.slice(-1) - 1] + (id[0] === 'b' ? -1 : id[0] === '#' ? 1 : 0);
  const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const sigOf = (tonic, L0, mode) => { const sig = []; for (const [d, semi] of (SCALE[mode] || []).entries()) sig[(L0 + d) % 7] = altOf((L0 + d) % 7, tonic + semi); return sig; };
  // one system as drawn: its time signature, bar lines, beams and the names under it, and each note,
  // rest or empty beat with its head's step, an accidental or not, red or not, ruled under or not
  const system = (svg) => {
    const top = +(/<line x1="[-\d.]+" y1="([-\d.]+)"/.exec(svg) || [])[1], all = (re) => [...svg.matchAll(re)].map((m) => m[1]);
    const items = svg.split(/(?=<g class="(?:note|rest|blank)\b)/).slice(1).map((p) => {
      const cls = /^<g class="([^"]*)"/.exec(p)[1].split(' '), head = /<g class="head" transform="translate\([-\d.]+ ([-\d.]+)\)"/.exec(p);
      return { kind: cls[0], slash: cls.includes('slash'), hl: cls.includes('hl'), step: head ? (20 - (+head[1] - top)) / 5 : null, acc: p.includes('class="acc"'), under: p.includes('class="under"') };
    });
    return { items, time: all(/<text class="time"[^>]*>([^<]*)</g).join('/'), bars: all(/<line (class="bar")/g).length, beams: all(/<rect (class="beam")/g).length, lyrics: all(/<text class="lyric"[^>]*>([^<]*)</g) };
  };
  // the staves in a drawing of the stage or of the staff alone, each as its systems: one while
  // answering, two after Check (what was written, the melody), none for the empty fallback
  const scores = (h) => {
    const el = h.slice(h.lastIndexOf('<div', h.indexOf('id="dictStaff"')));
    const divs = el.startsWith('<div class="score') ? [el.slice(0, el.indexOf('</div>'))] : el.startsWith('<div class="dict-staves"') ? el.split('</div>').slice(0, 2) : [];
    return divs.map((d) => d.split('<svg').slice(1).map(system));
  };
  // what a staff of figures holds: each figure's notes (with their names) and rests, a box per empty beat
  const holds = (q, figs, names) => {
    const out = [];
    for (let t = 0; t < q.bars * q.barTicks;) {
      const f = figs.find((x) => x.start === t);
      if (!f) { out.push({ tick: t, len: q.beat, kind: 'blank' }); t += q.beat; continue; }
      if (!q.cells[f.id]) break; // a figure the question does not know: what is drawn will not match
      for (const d of q.cells[f.id]) { out.push({ tick: t, len: Math.abs(d), kind: d < 0 ? 'rest' : 'note', name: d < 0 ? null : names[t] ?? null }); t += Math.abs(d); }
    }
    return out;
  };
  // the melody, at the question's pitches
  const melody = (q) => holds(q, q.figs, Object.fromEntries(q.notes.map((x) => [x.tick, x.id]))).map((x) => {
    const n = x.kind === 'note' && q.notes.find((m) => m.tick === x.tick);
    return n ? { ...x, step: stepOf(q.tonic + q.oct + n.semi, letter(q, n.id)) } : x;
  });
  // what is written: the given first note on the melody's own; after Check a name that is the
  // melody's on that beat on the melody's note, any other red
  const written = (q, e, mel, checked) => holds(q, e.figs, e.names).map((x) => {
    if (x.kind !== 'note' || !x.name) return x;
    const m = mel.find((y) => y.kind === 'note' && y.tick === x.tick && y.name === x.name);
    return { ...x, step: m && (checked || (x.tick === 0 && q.given != null)) ? m.step : null, hl: checked && !m };
  });
  // the melody after Check: red where its name was not written on its beat (not the given first
  // note), ruled where no written note starts on its beat with its length
  const marked = (q, mel, wr) => mel.map((x, i) => x.kind !== 'note' ? x : {
    ...x,
    hl: (q.given == null || mel.findIndex((y) => y.kind === 'note') !== i) && !wr.some((w) => w.kind === 'note' && w.tick === x.tick && w.name === x.name),
    under: !wr.some((w) => w.kind === 'note' && w.tick === x.tick && w.len === x.len),
  });
  const seen = new Set();
  // a staff as drawn (its systems) against what it should hold; with want null, only its layout
  const check = (where, q, sys, want, lyrics = []) => {
    const n = q.width < 520 && q.bars > 2 ? 2 : 1, per = q.bars / n;
    if (sys.length !== n) return note(`${where}: ${sys.length} systems, expected ${n}`);
    if (n > 1) seen.add('two systems');
    sys.forEach((s, k) => {
      if (s.time !== (k ? '' : q.meter)) note(`${where}: system ${k + 1} has the time signature "${s.time}", expected "${k ? '' : q.meter}"`);
      if (s.bars !== per) note(`${where}: system ${k + 1} has ${s.bars} bar lines, expected ${per}`);
      if (!want) return;
      const mine = want.filter((x) => Math.floor(x.tick / (per * q.barTicks)) === k);
      if (s.items.length !== mine.length) note(`${where}: system ${k + 1} draws ${s.items.length} notes, rests and empty beats, expected ${mine.length}`);
      // a beam over each run of flagged notes in one beat, and sixteenths a second
      const fl = (i) => mine[i] && mine[i].kind === 'note' && mine[i].len < 12, beat = (i) => Math.floor(mine[i].tick / q.beat);
      const runs = mine.filter((x, i) => fl(i) && fl(i + 1) && beat(i + 1) === beat(i) && !(fl(i - 1) && beat(i - 1) === beat(i))).length;
      if (runs) seen.add('a beam');
      if (mine.some((x) => x.kind === 'note' && x.len === 3) ? s.beams < runs : s.beams !== runs) note(`${where}: system ${k + 1} draws ${s.beams} beams for ${runs} runs of flagged notes in a beat`);
    });
    if (!want) return;
    const got = sys.flatMap((s) => s.items);
    // an accidental where a named note's alteration is not the one its step already has in the bar:
    // an earlier note's on that step, or the key signature's
    let bar = -1, active = {};
    for (let i = 0; i < Math.min(got.length, want.length); i++) {
      const g = got[i], x = want[i], slash = x.kind === 'note' && !x.name;
      if (Math.floor(x.tick / q.barTicks) !== bar) { bar = Math.floor(x.tick / q.barTicks); active = {}; }
      let acc = false;
      if (x.kind === 'note' && x.name && g.step != null) {
        const alt = altOf(letterOf(g.step), q.tonic + semiOf(x.name));
        acc = alt !== (g.step in active ? active[g.step] : q.sig[letterOf(g.step)]);
        active[g.step] = alt;
      }
      const bad = g.kind !== x.kind || g.slash !== slash ? `drawn as ${g.kind}${g.slash ? ' slash' : ''}${slash ? ', expected a slash' : ''}`
        : slash && g.step !== 0 ? 'a slash off the middle line'
        : x.step != null && g.step !== x.step ? `${g.step} steps above the middle line, expected ${x.step}`
        : x.name && x.step == null && letterOf(g.step) !== letter(q, x.name) ? `on ${'CDEFGAB'[letterOf(g.step)]}, expected ${'CDEFGAB'[letter(q, x.name)]}`
        : g.acc !== acc ? (g.acc ? 'an accidental, expected none' : 'no accidental, expected one')
        : g.hl !== !!x.hl ? (g.hl ? 'red, expected black' : 'black, expected red')
        : g.under !== !!x.under ? (g.under ? 'ruled under, expected not' : 'not ruled under') : '';
      if (bad) { note(`${where}: the ${x.kind} at tick ${x.tick}: ${bad}`); break; }
      seen.add(slash ? 'a slash' : 'a ' + x.kind);
      if (x.hl) seen.add('a red mark');
      if (acc) seen.add('an accidental');
      if (x.under) seen.add('a ruled length');
    }
    const ly = sys.flatMap((s) => s.lyrics).join(' ');
    if (ly !== lyrics.join(' ')) note(`${where}: the names under the staff read "${ly}", expected "${lyrics.join(' ')}"`);
  };
  // level 1's introduction: its card's staff, in one system
  const checkIntro = (st, h) => {
    const i = h.indexOf('<div class="score sight-staff">'), sys = h.slice(i, h.indexOf('</div>', i)).split('<svg').slice(1).map(system);
    const barTicks = st.bars * 12, len = st.notes.reduce((a, n) => a + Math.round(n.dur * 12), 0);
    const want = st.notes.map((n, k) => ({ tick: n.tick, len: Math.round(n.dur * 12), kind: n.rest ? 'rest' : 'note', name: n.rest ? null : st.ids[k], step: n.rest ? null : stepOf(n.midi, n.letter) }));
    const k = st.notes.findIndex((n) => !n.rest), L0 = (st.notes[k].letter - Number(st.ids[k].slice(-1)) + 8) % 7; // Do's letter
    check("level 1's introduction", { width: Infinity, meter: st.time, bars: len / barTicks, barTicks, beat: st.time.endsWith('/8') ? 18 : 12, tonic: st.key.tonic, sig: sigOf(st.key.tonic, L0, st.key.mode) }, sys, want, st.names.filter(Boolean));
  };
  let q = null, mel = null, staves = null, intro = null, nq = 0, intros = 0, points = 0;
  for (const l of M.lines) {
    if (!/^\["(dictq|dictintro|dict|html|outer)"/.test(l)) continue;
    const x = JSON.parse(l);
    if (x[0] === 'dictintro') intro = x[1];
    else if (x[0] === 'dictq') {
      if (intro) { note("level 1's introduction drew no staff"); intro = null; }
      q = x[1]; nq++; mel = melody(q); staves = null;
      q.sig = sigOf(q.tonic, 'CDEFGAB'.indexOf(q.key[0]), q.key.split(' ')[1]);
      if (!q.sig.length) note(`question ${nq}: no scale here for the key signature of ${q.key}`);
      const ns = mel.filter((y) => y.kind === 'note');
      if (ns.length !== q.notes.length || ns.some((y, k) => y.tick !== q.notes[k].tick || y.len !== q.notes[k].len)) note(`question ${nq}: its figures do not hold its notes`);
    } else if (x[0] === 'html' && x[1] === '#view') staves = null;
    else if ((x[0] === 'html' && x[1] === '#stage') || (x[0] === 'outer' && x[1] === '#dictStaff')) {
      if (intro && x[2].includes('class="score sight-staff"')) { checkIntro(intro, x[2]); intro = null; intros++; }
      staves = q && x[2].includes('id="dictStaff"') ? scores(x[2]) : null;
      if (staves && !staves.length) note(`question ${nq}: the staff was not drawn`);
      if (staves) for (const s of staves) check(`question ${nq}`, q, s, null);
    } else if (x[0] === 'dict' && q && x[2]) {
      // after Check two staves, what was written and the melody; the trace's answers are checked then
      const [, label, d] = x, where = `question ${nq}, ${label}`, after = !!staves && staves.length === 2;
      if (!staves || !staves.length || (['right', 'wrong', 'extra'].includes(label) && !after)) { note(`${where}: ${staves ? staves.length : 'no'} staves on screen`); continue; }
      const wr = written(q, d.entry, mel, after);
      check(after ? `${where}, what you wrote` : where, q, staves[0], wr);
      if (after) check(`${where}, the melody`, q, staves[1], marked(q, mel, wr), q.notes.map((n) => q.names[n.id]));
      points++;
    }
  }
  if (intro || !intros) note("level 1's introduction drew no staff");
  if (points < 8) fail(`the Full Dictation staves were checked at ${points} points of the trace, expected 8 or more`);
  for (const w of ['a note', 'a slash', 'a rest', 'a blank', 'a beam', 'two systems', 'a red mark', 'a ruled length', 'an accidental']) if (!seen.has(w)) fail(`no Full Dictation staff the trace drew had ${w}, so the checks above say nothing about it`);
}
// an answer while the question still sounds counts toward the day's times at no time; one after a
// part of the question was replayed over it does not count
if (!M.stopped) {
  const soon = M.lines.filter((l) => l.startsWith('["soon"')).map((l) => JSON.parse(l));
  const s1 = soon.find((x) => x[1] === 1), s4 = soon.find((x) => x[1] === 4);
  if (!s1 || !s4) fail('the trace never answered while the question still sounded');
  else {
    if (!(s1[4][0] === s1[3][0] + 1 && s1[4][1] === s1[3][1])) fail(`an answer during the sound was not counted at no time: ${JSON.stringify(s1)}`);
    if (JSON.stringify(s4[4]) !== JSON.stringify(s4[3])) fail(`an answer after a replayed part was counted as during the sound: ${JSON.stringify(s4)}`);
  }
}
// a held Space plays the melody once: its key repeats are no more hearings. A long wait before an
// answer adds a minute to the day's practice, and a Full Dictation answer past a minute all of its
// time. Method says when every track opens and states a track's own mastery window; Preferences
// names which dictation a setting is for, on the page and in prefs.js
if (!M.stopped) {
  const held = M.lines.filter((l) => l.startsWith('["dict"')).map((l) => JSON.parse(l)).find((x) => x[1] === 'a held Space');
  if (!held || !held[2] || held[2].heard !== 2 || held[2].practice) fail(`a held Space was more than one hearing: ${JSON.stringify(held && held[2] && { heard: held[2].heard, practice: held[2].practice })}`);
  const time = M.lines.filter((l) => l.startsWith('["time"')).map((l) => JSON.parse(l));
  const dt = time.find((x) => x[1] === 'dictation'), other = time.find((x) => x[1] !== 'dictation');
  if (!dt || !other) fail('the trace never timed a long answer');
  else {
    if (!(dt[2] > 60 && dt[3] === dt[2])) fail(`a Full Dictation answer of ${dt[2]} s added ${dt[3]} s to the day's practice`);
    if (!(other[2] > 60 && other[3] === 60)) fail(`a ${other[1]} answer after ${other[2]} s added ${other[3]} s to the day's practice, not a minute`);
  }
  const page = (label) => { const i = M.lines.findIndex((l) => l.startsWith(`["step","${label}"`)); const h = M.lines.slice(0, Math.max(0, i)).reverse().find((l) => l.startsWith('["html","#view"')); return h ? JSON.parse(h)[2] : ''; };
  const method = page('view method'), order = (method.split('The tracks, and the order they open')[1] || '').split('</ol>')[0];
  const mastery = JSON.parse(M.lines.find((l) => l.startsWith('["mastery"')) || '[0,[]]')[1];
  if (!mastery.length) fail('the trace never read the mastery rules');
  for (const [name, need, w] of mastery) {
    if (!order.includes(`<strong>${name}</strong>`)) fail(`Method never says when ${name} opens`);
    if (w !== 20 && !new RegExp(`${need} points of your last ${w} \\w+ in ${name}`).test(method)) fail(`Method never states ${name}’s own rule, ${need} of the last ${w}`);
  }
  const prefs = page('view prefs').replace(/<[^>]*>/g, ' ');
  if (/\bdictation\b/.test(prefs) || !prefs.includes('Melodic Dictation') || !prefs.includes('Full Dictation')) fail('Preferences says dictation without naming the track, Melodic Dictation or Full Dictation');
  // and its source, for the copy the trace never shows (the microphone's note: the trace has none);
  // the setting dictationSound has no word break to match
  const said = require('fs').readFileSync(path.join(dir, 'js', 'app', 'prefs.js'), 'utf8').match(/.{0,40}\bdictation\b.{0,40}/);
  if (said) fail(`prefs.js says dictation without naming the track: ${said[0]}`);
}
// Full Dictation, the review's fixes (the trace's "dict-fix" lines, and what its screens draw).
// Writing along while a hearing plays makes no sound and leaves it playing; Play mine over the
// chords reads Listening until it ends, then not; the bars filled, and a step switched, from the
// keyboard keep the focus in the stage; with numbers only, a name in a sentence is a degree; the
// note slots say which note, where and what to a screen reader, and the one a name goes to is
// current; after the hearings, the two buttons that play the melody keep different names; a
// phone's two systems are drawn at one scale
if (!M.stopped) {
  const fix = (name) => M.lines.filter((l) => l.startsWith('["dict-fix"')).map((l) => JSON.parse(l)).filter((x) => x[1] === name);
  const [along] = fix('along');
  if (!along || !along[2].playing || along[2].sounds || along[2].named < 2) fail(`writing along while a hearing played: ${JSON.stringify(along && along[2])} (want it still playing, no sound, two names)`);
  const pill = Object.fromEntries(fix('pill').map((x) => [x[2], x]));
  const playing = pill['play mine'], ended = pill['play mine ended'];
  if (!playing || !playing[3]) fail('the trace never played Play mine over the chords');
  else if (playing[4].at(-1) !== false) fail(`Play mine over the chords left the pill on ${JSON.stringify(playing[4])}, not Listening`);
  if (!ended || ended[4].at(-1) !== true) fail(`the pill did not go back when Play mine ended: ${JSON.stringify(ended && ended[4])}`);
  const focus = (fix('focus')[0] || [])[2] || [];
  for (const want of ['#dictSlots .slot.active', '[data-act="dStep"][data-step="rhythm"]', '[data-act="dStep"][data-step="notes"]']) if (!focus.includes(want)) fail(`focus reached with the keyboard was not moved on to ${want}: ${JSON.stringify(focus)}`);
  const said = (fix('said')[0] || [])[2] || [];
  if (!said.some((s) => /^Note \d+ was degree \S+\. You wrote degree \S+\.$/.test(s))) fail(`with numbers only, a wrong name was not told as degrees: ${JSON.stringify(said)}`);
  if (!said.some((s) => /^Note \d+, degree \S+, is missing from yours\.$/.test(s))) fail(`with numbers only, a missing note was not told as a degree: ${JSON.stringify(said)}`);
  const drawn = M.lines.filter((l) => /^\["(html|outer)"/.test(l)).map((l) => JSON.parse(l)[2]).filter((h) => typeof h === 'string');
  const els = drawn.filter((x) => x.includes('id="dictSlots"')).map((h) => [...h.split('id="dictSlots"')[1].split('</div>')[0].matchAll(/<(button|span) class="slot[^"]*"[^>]*>/g)].map((m) => m[0]));
  const slotFaults = {
    'have no label with their place and name': (s) => !/aria-label="Note \d+, bar \d+, (after )?beat \d+: [^"]+"/.test(s),
    'are drawn as text without role="img"': (s) => s.startsWith('<span') && !s.includes('role="img"'),
    'that a name goes to are not aria-current': (s) => s.startsWith('<button') && /class="slot[^"]*\bactive\b/.test(s) && !s.includes('aria-current="true"'),
  };
  for (const [what, bad] of Object.entries(slotFaults)) { const s = els.flat().filter(bad); if (s.length) fail(`${s.length} note slots ${what}, as ${s[0]}`); }
  if (els.some((row) => row.filter((s) => s.includes('aria-current')).length > 1)) fail('more than one note slot is current');
  const graded = els.flat().filter((s) => /\bis-wrong\b/.test(s) && /you wrote .+, the melody has /.test(s)).length;
  if (!els.flat().length || !graded) fail(`the trace drew ${els.flat().length} note slots, ${graded} of them a wrong name told against the melody's`);
  // the replay buttons of one screen never share a name
  for (const h of drawn.filter((x) => x.includes('class="q-replays"'))) {
    const names = [...h.matchAll(/data-act="replay"[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<kbd>.*?<\/kbd>/g, '').trim());
    if (new Set(names).size !== names.length) { fail(`two replay buttons share a name: ${names.join(' | ')}`); break; }
  }
  if (!drawn.some((h) => h.includes('>Just the melody (practice)<'))) fail('the trace never showed the melody buttons after the last hearing');
  // the systems of one staff share a viewBox width, and so a scale
  const systems = drawn.flatMap((h) => h.split('class="score dict-staff').slice(1)).map((d) => [...d.split('</div>')[0].matchAll(/<svg [^>]*viewBox="0 0 ([\d.]+) [\d.]+" width="([\d.]+)"/g)].map((m) => `${m[1]}@${m[2]}`)).filter((w) => w.length > 1);
  const uneven = systems.filter((w) => new Set(w).size > 1);
  if (!systems.length) fail('the trace never drew a staff in two systems');
  else if (uneven.length) fail(`${uneven.length} of ${systems.length} staves in two systems draw them at different scales, as ${uneven[0].join(', ')} (viewBox width @ width)`);
}
// app.css: under a graded slot its right name hangs below it, so rows of graded slots stand at
// least that far apart; Full Dictation's palette fits a 320px phone's 288px column
{
  const css = require('fs').readFileSync(path.join(dir, 'app.css'), 'utf8');
  const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : ''; };
  const px = (body, prop) => { const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*(-?[\\d.]+)px`)); return m ? +m[1] : null; };
  const hang = -(px(rule('.slot .fix'), 'bottom') || 0);
  for (const sel of ['.dict-ctl > .dict-slots', '.slots-wrap.graded .slots']) {
    const body = rule(sel), gap = px(body, 'row-gap') ?? px(body, 'gap') ?? px(rule('.slots'), 'gap');
    if (!body) fail(`app.css has no rule for ${sel}`);
    else if (!(gap >= hang)) fail(`app.css: rows of graded slots (${sel}) are ${gap}px apart; the right name under a slot hangs ${hang}px below it`);
  }
  const cols = /grid-template-columns\s*:\s*repeat\(\s*(\d+)\s*,\s*([^;]+?)\)\s*(;|$)/.exec(rule('.dict-palette'));
  if (!cols) fail('app.css: the columns of .dict-palette could not be read');
  else {
    const n = +cols[1], track = cols[2].trim(), mm = /^minmax\(\s*([\d.]+)(px)?\s*,/.exec(track), fixed = /^([\d.]+)px$/.exec(track);
    const least = Math.max(mm ? +mm[1] : fixed ? +fixed[1] : 0, px(rule('.dfig'), 'width') || 0);
    const width = n * least + (n - 1) * (px(rule('.dict-palette'), 'gap') || 0);
    if (width > 288) fail(`app.css: Full Dictation's palette is at least ${width}px wide, wider than a 320px phone's 288px column`);
  }
}
// Full Dictation, the second round (the trace's dictdrone, dictfocus and micgate lines): with a
// drone on, a figure written once the hearing is over still sounds; the cursor never rests on the
// given first note, drawn as text, and the focus goes on to a slot when the bars fill with every
// note named, and stays on Altered notes; Melodic Dictation's microphone question names its track
if (!M.stopped) {
  const got = (name) => M.lines.filter((l) => l.startsWith(`["${name}"`)).map((l) => JSON.parse(l));
  const [drone] = got('dictdrone');
  if (!drone || drone[1] !== 1) fail(`with a drone on, a figure written after the hearing made ${drone ? drone[1] : 'no'} sounds, not one`);
  const drawn = M.lines.filter((l) => /^\["(html|outer)"/.test(l)).map((l) => JSON.parse(l)[2]).filter((h) => typeof h === 'string' && h.includes('id="dictSlots"'));
  const given = drawn.map((h) => (/<span class="slot[^"]*\bactive\b[^>]*>/.exec(h) || [])[0]).find(Boolean);
  if (given) fail(`the cursor was on a note slot that cannot take the focus: ${given}`);
  const focus = Object.fromEntries(got('dictfocus').map((x) => [x[1], x[2]]));
  for (const [when, want] of [['every note named', '#dictSlots .slot.active'], ['altered notes', '[data-act="staffAlt"]']]) if (!(focus[when] || []).includes(want)) fail(`Full Dictation, ${when}: the focus was not moved on to ${want}: ${JSON.stringify(focus[when])}`);
  const gate = M.lines.filter((l) => l.startsWith('["html","#stage"') && l.includes('Let the app hear you?')).map((l) => JSON.parse(l)[2].replace(/<[^>]*>/g, ' '));
  if (!gate.length) fail('the trace never asked for the microphone before a Melodic Dictation set');
  else if (gate.some((t) => /\bdictation\b/.test(t) || !t.includes('Melodic Dictation'))) fail(`the microphone question says dictation without naming the track: ${gate[0].replace(/\s+/g, ' ').slice(0, 200)}`);
}
const steps = M.lines.filter((l) => l.startsWith('["step"'));
console.log(bad ? `${bad} problems` : `app OK (modules and bundle, ${steps.length} steps, ${M.lines.length} effects, no errors)`);
process.exitCode = bad ? 1 : 0;
