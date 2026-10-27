'use strict';
// Export and import: real progress round-trips, junk is refused, markup payloads are neutralised,
// backups from a newer copy are refused, a paste can be undone, and an impossible stored level
// loads clamped.
//   node tone-ladder/tests/backup-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
for (const f of ['theory.js', 'curriculum.js', 'store.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, S = TL.Store, T = TL.Curriculum.TRACKS;
let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL', msg); } };
// build some real progress
for (let i = 0; i < 300; i++) {
  const tr = T[i % 3], t = S.track(tr.id), lv = tr.levels[t.level];
  const it = S.chooseItem(tr.id, lv.items, { newItems: lv.introduce, levelStats: t.levelStats });
  S.record({ track: tr.id, level: t.level, items: [it], results: [Math.random() < 0.9 ? 1 : 0], rt: 1200, confusions: Math.random() < 0.1 ? [[it, lv.items[0]]] : [] });
  S.maybeLevelUp(tr.id);
}
S.state.settings.hints.P5a = 'Star Wars';
// the format-3 fields: intonation samples, the self-check tally, the guess-first setting
S.recordPitch('sing', '3', 30, -30); S.recordPitch('sing', '3', 20, -10); S.recordPitch('sing', 'pattern3', 12, 12);
S.noteGuess(true); S.noteGuess(false);
S.state.settings.guessFirst = false;
S.state.settings.singBack = false;
S.state.settings.input = 'piano'; S.state.settings.clap = false;
// 1. round trip keeps everything
const text = S.exportText();
const back = S.parseBackup(text);
const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.updatedAt; delete c.createdAt; return JSON.stringify(c); };
check(strip(back) === strip(S.state), 'round trip changed the progress');
check(back.items['sing:3'] && JSON.stringify(back.items['sing:3'].cl) === JSON.stringify(S.state.items['sing:3'].cl) && back.items['sing:3'].cl.length === 1, 'intonation samples did not round-trip (two same-day samples merge into one)');
check(back.guess && back.guess.n === 2 && back.guess.a === 1, 'self-check tally did not round-trip');
check(back.settings.guessFirst === false, 'guessFirst setting did not round-trip');
check(back.settings.singBack === false, 'singBack setting did not round-trip');
check(back.settings.input === 'piano' && back.settings.clap === false, 'input and clap settings did not round-trip');
// a save from before format 3 loads with the defaults for the new fields
const older = JSON.parse(text); older.state.v = 2; delete older.state.guess; delete older.state.settings.guessFirst; delete older.state.settings.singBack; delete older.state.settings.input; delete older.state.settings.clap; for (const it of Object.values(older.state.items)) delete it.cl;
const up = S.parseBackup(JSON.stringify(older));
check(up.guess && up.guess.n === 0 && up.settings.guessFirst === true && up.settings.singBack === true && up.settings.input === 'ladder' && up.settings.clap === true && !Object.values(up.items).some((it) => it.cl), 'an older save did not get the format-3 to format-5 defaults');
// 2. junk and partial input
for (const junk of ['', 'hello', '[]', '{"tracks":{}}', 'null', '{"state":5}']) { let threw = false; try { S.parseBackup(junk); } catch (e) { threw = /not a Tone Ladder backup/.test(e.message); } check(threw, 'accepted junk ' + junk); }
// 3. markup payloads are dropped or replaced by safe defaults
const evil = JSON.parse(text).state;
evil.settings.tapOffsetMs = '"><meta http-equiv=refresh content="0;url=https://example.com/">';
evil.settings.volume = '<img src=x onerror=alert(1)>';
evil.settings.labels = '<b>';
evil.settings.hints['<x>'] = 'y';
evil.settings.hints.P4a = 'z'.repeat(500);
evil.days['2026-01-01'] = { q: '<b>x</b>', c: 1, s: 0, t: { degrees: ['<i>', 1], nope: [1, 1] } };
evil.days['<script>'] = { q: 1 };
evil.items['degrees:<img>'] = { n: 1 };
evil.items['degrees:5'] = { n: '<b>', c: 1, e: 7, box: 99 };
evil.conf.degrees['5><img>'] = 3;
evil.conf.nope = { 'a>b': 1 };
evil.tracks.degrees.window.push('<b>', NaN, 5);
evil.onboarded = '<b>';
const clean = S.parseBackup(JSON.stringify(evil));
const flat = JSON.stringify(clean);
check(!/[<>]/.test(flat.replace(/"[^"]*>[^"]*":/g, (m) => (/^"[\w#♭♯°/]+>[\w#♭♯°/]+":$/.test(m) ? '' : m))), 'markup survived: ' + (flat.match(/.{20}[<>].{20}/) || [''])[0]);
check(clean.settings.tapOffsetMs === 0 && clean.settings.volume === 0.8 && clean.settings.labels === 'both', 'bad settings not reset to defaults');
check(clean.settings.hints.P4a.length === 80 && !('<x>' in clean.settings.hints), 'hints not cleaned');
check(clean.days['2026-01-01'].q === 0 && !('nope' in clean.days['2026-01-01'].t) && !('<script>' in clean.days), 'days not cleaned');
check(!('degrees:<img>' in clean.items) && clean.items['degrees:5'].n === 0 && clean.items['degrees:5'].e === 1 && clean.items['degrees:5'].box === 6, 'items not cleaned');
check(!('nope' in clean.conf) && !('5><img>' in clean.conf.degrees), 'confusions not cleaned');
check(clean.tracks.degrees.window.every((x) => typeof x === 'number' && x >= 0 && x <= 1), 'window not cleaned');
check(clean.onboarded === false, 'onboarded not boolean');
// 4. a backup from a copy with more levels or tracks is refused, not cut down
const beyond = T[0].levels.length; // one level past the last this copy has
const newer = JSON.parse(text).state; newer.tracks.degrees.level = beyond; newer.tracks.degrees.maxLevel = beyond;
let refused = false; try { S.parseBackup(JSON.stringify(newer)); } catch (e) { refused = /newer Tone Ladder/.test(e.message); }
check(refused, 'newer-curriculum backup accepted');
const unknownTrack = JSON.parse(text).state; unknownTrack.tracks.composition = { level: 0 };
refused = false; try { S.parseBackup(JSON.stringify(unknownTrack)); } catch (e) { refused = /newer Tone Ladder/.test(e.message); }
check(refused, 'unknown-track backup accepted');
// 5. apply + undo
const before = strip(S.state);
S.applyBackup(S.parseBackup(JSON.stringify({ tracks: {}, settings: {} })));
check(S.answeredIn(S.state) === 0 && S.hasUndo(), 'apply did not replace or keep undo');
check(S.undoImport() && strip(S.state) === before && !S.hasUndo(), 'undo did not restore');
// 6. progress this copy saved with an impossible level (hand-edited, or a level since removed) loads
//    clamped to the last level with its window dropped, and the summaries still work
const stored = JSON.parse(text).state;
for (const tr of T) stored.tracks[tr.id] = { ...(stored.tracks[tr.id] || {}), level: 999, maxLevel: 999, window: [1, 1, 1], windowDays: [1, 1, 1] };
localStorage.setItem('tone-ladder-v1', JSON.stringify(stored));
S.init();
for (const tr of T) {
  const t = S.track(tr.id), last = tr.levels.length - 1;
  check(t.level === last && t.maxLevel === last && t.window.length === 0, `${tr.id}: stored level 999 not clamped to the last level with its window dropped`);
  let threw = null; try { S.mastery(tr.id); S.toGo(tr.id); } catch (e) { threw = e; }
  check(!threw, `${tr.id}: mastery/toGo threw after clamping: ${threw && threw.message}`);
}
console.log(bad ? `${bad} problems` : 'backup checks OK');
process.exitCode = bad ? 1 : 0;
