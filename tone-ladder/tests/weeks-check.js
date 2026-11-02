'use strict';
// Week by week: what each answer adds to the day (answer times, intonation), and that the answer
// code says whether an answer is scored and whether it came during the sound; what the weekly
// summary makes of it (sums over answers, the minimums, which way the voice leaned, the level-ups,
// a finished track finished once); the weeks across the clock changes; old saves and junk in the
// new fields; and the half-year trim.
//   node tone-ladder/tests/weeks-check.js [path/to/static/tone-ladder]
process.env.TZ = 'Australia/Melbourne'; // a zone with clock changes, in April and October
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
// a fixed clock the checks move a day at a time
const RealDate = Date; let now = RealDate.UTC(2026, 9, 20, 2); // 1 pm on 20 October in Melbourne
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(now); }
  static now() { return now; }
};
const DAY = 86400000;
const days = (n) => { now += n * DAY; };
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
for (const f of ['theory.js', 'curriculum.js', 'store.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const TL = globalThis.TL, S = TL.Store, TRACK = TL.Curriculum.TRACK;
let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL', msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const today = () => S.state.days[TL.dayKey()];
const it = (track, k = 0) => TRACK[track].levels[0].items[k % TRACK[track].levels[0].items.length];
const answer = (track, results, rt = 0, practice = false, early = false) => S.record({ track, level: S.track(track).level, items: results.map((_, k) => it(track, k)), results, rt, practice, early });
const keyNum = (k) => RealDate.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / DAY;

// 1. answer times: only right, timed, scored answers outside Melody, capped at 15 s
S.reset();
answer('intervals', [1], 2000);
check(same(today().rt, { intervals: [1, 20] }), `a right answer in 2 s is kept as 20 tenths (got ${JSON.stringify(today().rt)})`);
answer('intervals', [1], 20000);
check(same(today().rt.intervals, [2, 170]), `20 s is kept as 15 s (got ${JSON.stringify(today().rt.intervals)})`);
answer('intervals', [1], 45000); answer('intervals', [1], 0); answer('intervals', [0], 1500); answer('harmony', [1, 1, 0], 900); answer('intervals', [1], 1500, true); answer('melody', [1, 1, 1], 1200);
check(same(today().rt, { intervals: [2, 170] }), `over 30 s, untimed, wrong, partly wrong, practice and Melody answers add no time (got ${JSON.stringify(today().rt)})`);
answer('harmony', [1, 1, 1], 900);
check(same(today().rt.harmony, [1, 9]), 'a right progression keeps its time per chord');
check(today().t.intervals[0] === 5 && today().pq === 1, 'the day still counts every scored answer, and the practice round apart');
answer('intervals', [1], 0, false, true); answer('intervals', [0], 0, false, true); answer('intervals', [1], 0, true, true);
check(same(today().rt.intervals, [3, 170]), `a right answer given while the sound still plays counts, at no time; a wrong or practice one does not (got ${JSON.stringify(today().rt.intervals)})`);
// the app passes both: whether a sung answer is scored, and whether an answer came during the sound
const answerSrc = fs.readFileSync(path.join(dir, 'js', 'app', 'answer.js'), 'utf8');
check(/S\.recordPitch\([^;]*,\s*!q\.practice\);/.test(answerSrc), 'answer.js keeps practice rounds out of the day\'s intonation (recordPitch gets !q.practice)');
check((answerSrc.match(/commit\([^;]*, answeredEarly\(\)\);/g) || []).length === 2, 'answer.js tells record() when a choice or a sequence was answered during the sound');
check(/S\.record\(\{[^}]*\bearly\b[^}]*\}\);/.test(fs.readFileSync(path.join(dir, 'js', 'app', 'session.js'), 'utf8')), 'session.js passes that on to record()');

// 2. intonation: scored sung answers make the day (even before any other answer), others only the item
S.reset();
S.recordPitch('sing', it('sing'), 12.4, -8.6, false);
check(!today() && S.item('sing', it('sing')).cl.length === 1, 'an unscored sung answer leaves the day alone but still updates the note');
S.recordPitch('sing', it('sing'), 12.4, -8.6);
check(same(today() && today().cl, { sing: [1, 12, -9] }), `a scored sung answer starts the day with its cents, rounded (got ${JSON.stringify(today())})`);
S.recordPitch('sing', it('sing'), 20, 20);
check(same(today().cl.sing, [2, 32, 11]), 'a second sung answer adds to the day');

// 3. the weekly summary: sums over answers, minimums, the voice's lean
// a week of two unequal days: sums over its answers, not an average of its days
S.reset();
for (let k = 0; k < 10; k++) answer('intervals', [1], 1000);
for (let k = 0; k < 8; k++) S.recordPitch('sing', it('sing'), 10, 0);
days(1);
for (let k = 0; k < 30; k++) answer('intervals', [k % 3 ? 1 : 0], 3000);
for (let k = 0; k < 24; k++) S.recordPitch('sing', it('sing'), 30, 0);
let cur = S.weekly('intervals').weeks[11];
check(Math.abs(cur.acc - 30 / 40) < 1e-9 && Math.abs(cur.sec - 700 / 30 / 10) < 1e-9, `two unequal days: 30 of 40 right, 30 times summed (got ${cur.acc}, ${cur.sec})`);
check(S.weekly('sing').weeks[11].cents === 25, `two unequal days of singing: 25 cents over 32 answers (got ${S.weekly('sing').weeks[11].cents})`);
S.reset();
for (let k = 0; k < 2; k++) answer('intervals', [0]);
for (let k = 0; k < 40; k++) answer('intervals', [1], 1800);
let w = S.weekly('intervals');
cur = w.weeks[11];
check(w.weeks.length === 12 && cur.q === 42 && Math.abs(cur.acc - 40 / 42) < 1e-9, `42 answers, 40 right: 40/42 (got ${cur.q}, ${cur.acc})`);
check(Math.abs(cur.sec - 1.8) < 1e-9 && cur.rn === 40, `40 timed right answers at 1.8 s (got ${cur.sec}, ${cur.rn})`);
check(cur.to === TL.dayKey() && keyNum(cur.to) - keyNum(cur.from) === 6, 'the last week is the seven days up to today');
S.reset();
for (let k = 0; k < 19; k++) answer('chords', [1], 1000);
cur = S.weekly('chords').weeks[11];
check(cur.acc === null && cur.q === 19, '19 answers are too few for a point, but are counted');
answer('chords', [1], 1000);
cur = S.weekly('chords').weeks[11];
check(cur.acc === 1 && cur.sec === 1, '20 answers make a point');
S.reset();
for (let k = 0; k < 9; k++) answer('degrees', [1], 2500);
cur = S.weekly('degrees').weeks[11];
check(cur.sec === null && cur.rn === 9, '9 timed answers are too few for a point');
answer('degrees', [1], 2500);
check(S.weekly('degrees').weeks[11].sec === 2.5, '10 timed answers make a point');
S.reset();
for (let k = 0; k < 7; k++) S.recordPitch('sing', it('sing'), 25, -25);
cur = S.weekly('sing').weeks[11];
check(cur.cents === null && cur.lean === null && cur.pn === 7, '7 sung answers are too few for a point');
S.recordPitch('sing', it('sing'), 25, -25);
cur = S.weekly('sing').weeks[11];
check(cur.cents === 25 && cur.lean === 'low', `8 sung answers 25 cents flat: a point, leaning low (got ${cur.cents}, ${cur.lean})`);
for (let k = 0; k < 8; k++) S.recordPitch('sing', it('sing'), 25, 40);
check(S.weekly('sing').weeks[11].lean === null, 'flat and sharp evening out lean neither way');
for (let k = 0; k < 24; k++) S.recordPitch('sing', it('sing'), 40, 40);
check(S.weekly('sing').weeks[11].lean === 'high', 'mostly sharp leans high');
// the edge is 20 cents, as on the notes' own bars
S.reset(); for (let k = 0; k < 8; k++) S.recordPitch('sing', it('sing'), 19, -19);
check(S.weekly('sing').weeks[11].lean === null, '19 cents flat on average leans neither way');
S.reset(); for (let k = 0; k < 8; k++) S.recordPitch('sing', it('sing'), 20, -20);
check(S.weekly('sing').weeks[11].lean === 'low', '20 cents flat on average leans low');
// Full Dictation: a week is a point from 8 questions, and its answers keep no time (writing takes most of it)
S.reset();
for (let k = 0; k < 7; k++) S.record({ track: 'dictation', level: 0, items: ['2', 'q'], results: [1, 1], scores: [1, 1, 0.5], rt: 2000 });
cur = S.weekly('dictation').weeks[11];
check(cur.acc === null && cur.q === 7 && TRACK.dictation.weekMin === 8, '7 Full Dictation questions are too few for a point');
S.record({ track: 'dictation', level: 0, items: ['2', 'q'], results: [1, 1], scores: [1, 1, 0.5], rt: 0, early: true });
cur = S.weekly('dictation').weeks[11];
check(Math.abs(cur.acc - 0.83) < 1e-9 && cur.q === 8, `8 make a point, each question scored by its notes (got ${cur.acc})`);
check(!today().rt && cur.rn === 0 && S.weekly('dictation').timedFrom === null, 'Full Dictation keeps no answer times, timed or early');
// answer times are dated from the first day a track kept one
S.reset();
check(S.weekly('intervals').timedFrom === null, 'no answer times: none kept yet');
answer('intervals', [1], 1500); const k1 = TL.dayKey();
days(1); answer('degrees', [1], 1500); const k2 = TL.dayKey();
days(1); answer('intervals', [1], 1500);
check(S.weekly('intervals').timedFrom === k1 && S.weekly('degrees').timedFrom === k2 && S.weekly('chords').timedFrom === null, 'answer times are kept from each track\'s own first one');

// 4. weeks move with the clock, and end after twelve
S.reset();
for (let k = 0; k < 20; k++) answer('rhythm', [1]);
days(7);
w = S.weekly('rhythm');
check(w.weeks[10].q === 20 && w.weeks[11].q === 0, 'seven days on, the answers are a week back');
days(76);
check(S.weekly('rhythm').weeks[0].q === 20, '83 days on, they are in the first week');
days(1);
check(S.weekly('rhythm').weeks.every((x) => x.q === 0), '84 days on, they are off the chart');
// across the clock changes, each week is seven days and the weeks follow on
// (at midday, and within an hour of midnight either side, where an hour's shift would move the date)
for (const at of [RealDate.UTC(2026, 3, 9, 2), RealDate.UTC(2026, 9, 8, 2), RealDate.UTC(2026, 3, 6, 15), RealDate.UTC(2026, 3, 6, 14, 30), RealDate.UTC(2026, 3, 9, 13, 30), RealDate.UTC(2026, 9, 8, 12, 30), RealDate.UTC(2026, 9, 7, 13, 30)]) {
  now = at;
  const ws = S.weekly('rhythm').weeks;
  const ok = ws.every((x, k) => keyNum(x.to) - keyNum(x.from) === 6 && (!k || keyNum(x.from) === keyNum(ws[k - 1].to) + 1)) && ws[11].to === TL.dayKey();
  check(ok, `weeks around ${new RealDate(at).toISOString().slice(0, 16)} UTC are seven days each, end to end, up to today`);
}
now = RealDate.UTC(2026, 9, 20, 2);

// 5. level-ups: real promotions, as days back and the level reached (1-based)
S.reset();
const master = (id) => {
  const t = S.track(id), lv = TRACK[id].levels[t.level];
  for (let k = 0; k < 20; k++) S.record({ track: id, level: t.level, items: [lv.items[k % lv.items.length]], results: [1] });
  days(1);
  let up = null;
  for (let k = 0; k < 40 && up === null && !S.track(id).complete; k++) { S.record({ track: id, level: t.level, items: [lv.items[k % lv.items.length]], results: [1] }); up = S.maybeLevelUp(id); }
  return up;
};
check(master('intervals') === 1, 'Intervals moves up to its second level');
days(3);
w = S.weekly('intervals');
check(same(w.ups, [{ back: 3, level: 2, done: false }]), `a level-up three days ago, to level 2 (got ${JSON.stringify(w.ups)})`);
S.skipAhead('intervals');
check(same(S.weekly('intervals').ups[1], { back: 0, level: 3, done: false }), 'skipping ahead today, to level 3');
const lastL = TRACK.chords.levels.length - 1;
Object.assign(S.track('chords'), { level: lastL, maxLevel: lastL });
master('chords');
check(S.track('chords').complete && S.weekly('chords').ups.length === 1 && S.weekly('chords').ups[0].done, 'mastering the last level shows as finishing the track');
// a finished track stays in review: filling its window again does not finish it again
master('chords'); master('chords');
check(S.track('chords').history.length === 1 && S.weekly('chords').ups.length === 1, `a finished track is finished once (history ${S.track('chords').history.length})`);
// and a save that finished it again and again (as copies before this one did) shows it once
S.track('chords').history.push({ level: lastL, at: Date.now() - DAY, mastered: true }, { level: lastL, at: Date.now(), mastered: true });
check(S.weekly('chords').ups.length === 1, 'repeated finishes in an old save show as one');
S.track('intervals').history.push({ level: 5, at: Date.now() - 90 * DAY, mastered: true }, { level: 6, at: Date.now() + 2 * DAY, mastered: true });
check(S.weekly('intervals').ups.length === 2, 'level-ups before the twelve weeks, or dated after today, are left out');

// 6. old saves and junk in the new fields
S.reset();
answer('degrees', [1], 1500);
const v7 = JSON.parse(S.exportText()).state;
v7.v = 7; for (const d of Object.values(v7.days)) { delete d.rt; delete d.cl; }
let st = S.parseBackup(JSON.stringify(v7));
check(st.v === S.FORMAT && S.FORMAT >= 8 && Object.values(st.days).every((d) => !('rt' in d) && !('cl' in d)), 'a format-7 save loads in the current format, with no answer times or intonation');
const junk = JSON.parse(S.exportText()).state;
junk.days['2026-10-01'] = {
  q: 3, c: 2, s: 60, t: {},
  rt: { intervals: [NaN, 5], degrees: ['3', 4], chords: [2], nope: [2, 3], harmony: [0, 10], sing: [-3, 4], rhythm: [2, 99999], melody: [2.7, 10] },
  cl: { sing: [2, 500, -900], sight: [1, 10, 50] },
};
junk.days['2026-10-02'] = { q: 1, c: 1, s: 0, t: {}, rt: {}, cl: { nope: [1, 2, 3] } };
junk.days['2026-10-03'] = { q: 1, c: 1, s: 0, t: {}, rt: 'fast', cl: [1, 2, 3] };
st = S.parseBackup(JSON.stringify(junk));
check(same(st.days['2026-10-01'].rt, { rhythm: [2, 300], melody: [2, 10] }), `answer times cleaned entry by entry (got ${JSON.stringify(st.days['2026-10-01'].rt)})`);
check(same(st.days['2026-10-01'].cl, { sing: [2, 200, -200], sight: [1, 10, 10] }), `intonation capped at 100 cents an answer, signed within it (got ${JSON.stringify(st.days['2026-10-01'].cl)})`);
check(['2026-10-02', '2026-10-03'].every((k) => !('rt' in st.days[k]) && !('cl' in st.days[k])), 'empty or malformed maps are dropped');
const again = S.parseBackup(JSON.stringify(st));
check(same(again, st), 'cleaning a cleaned save changes nothing');
const round = S.parseBackup(S.exportText());
check(same(round.days, S.state.days), 'answer times and intonation survive a backup');

// 7. the half-year trim: answer times and intonation go after 182 days, the rest of the day stays
S.reset();
answer('intervals', [1], 1500); answer('intervals', [1], 1500, true); S.recordPitch('sing', it('sing'), 10, 5);
const first = TL.dayKey();
days(182); answer('intervals', [1], 1500);
check(S.state.days[first].rt && S.state.days[first].cl, 'kept 182 days on');
days(1); answer('intervals', [1], 1500);
const d0 = S.state.days[first];
check(d0 && !('rt' in d0) && !('cl' in d0) && d0.q === 1 && d0.c === 1 && d0.pq === 1 && d0.t.intervals[0] === 1 && d0.s === 0, `183 days on, only the answer times and intonation are gone (got ${JSON.stringify(d0)})`);

console.log(bad ? `${bad} problems` : 'weeks OK');
process.exitCode = bad ? 1 : 0;
