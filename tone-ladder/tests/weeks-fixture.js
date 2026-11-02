'use strict';
// Twelve weeks of made-up practice, for the week-by-week charts: every track, a few days off and a
// week away, answer times kept only for the last seven weeks (as for someone who updated then),
// intonation on Sing and Sight-Singing, level-ups in Intervals and Sing (the last one in the last
// seven days, with a worse week after it), Chord Qualities finished in the last seven days, and Full
// Dictation from the fifth week, about ten questions a week (its own minimum is 8).
// The numbers come from the day, not from chance, so every run builds the same save. The save has
// no format number, so a copy of any format loads it.
//   weeksFixture(now, dayKey) → a saved state, for S.parseBackup
module.exports = function weeksFixture(now, dayKey) {
  const DAY = 86400000;
  const days = {};
  for (let back = 83; back >= 0; back--) {
    if (back % 9 === 4 || (back >= 50 && back <= 56)) continue; // days off, and a week away
    const d = new Date(now - back * DAY);
    const w = Math.floor((83 - back) / 7); // the week, oldest first
    const timed = back <= 48;
    const day = { q: 0, c: 0, s: 900 + (back % 5) * 120, t: {} };
    if (back % 4 === 0) day.pq = 2;
    // n answers at accuracy acc; on timed days, the right ones at ds tenths of a second each
    const add = (tr, n, acc, ds) => {
      day.t[tr] = [n, Math.round(n * acc * 100) / 100]; day.q += n; day.c += day.t[tr][1];
      const right = Math.floor(n * acc);
      if (timed && ds && right) (day.rt || (day.rt = {}))[tr] = [right, right * ds];
    };
    // Intervals: better week by week, a dip after each new level (weeks 6 and 10), and quicker
    add('intervals', 6 + (back % 3), Math.min(0.97, 0.6 + 0.04 * ((w % 6) + 1) - (w === 6 || w === 10 ? 0.1 : 0)), 42 - 2 * w + (back % 4));
    // Scale Degrees: every other day at first (too few for a point), then every day
    if (back % 2 === 0 || w >= 8) add('degrees', 3 + (back % 4), 0.82, 25);
    // Chord Qualities: finished five days ago, then a worse week of review
    if (back % 3 !== 0) add('chords', 7, w === 11 ? 0.74 : 0.9, 30);
    // Harmony: a progression's time is per chord
    if (back % 2 === 1) add('harmony', 6, 0.7, 20);
    // Melody and Rhythm: accuracy only
    if (back % 3 === 2) add('melody', 7, 0.6 + 0.01 * w);
    if (back % 5 !== 3) add('rhythm', 4, 0.8);
    // Full Dictation: a question's accuracy is its notes' scores, so not a round number
    if (w >= 4 && back % 2 === 0) add('dictation', 3, 0.66 + 0.02 * (w - 4));
    // Sing: graded answers most days; a new level three days ago and a worse last week
    if (back % 3 !== 1) {
      add('sing', 5, w === 11 ? 0.78 : 0.7 + 0.02 * w);
      (day.cl || (day.cl = {})).sing = [4, 4 * (w === 11 ? 27 : 30 - w), -4 * (12 + (w % 3) * 4)]; // cents off, and flat
    }
    // Sight-Singing: a few weeks only, closer each week
    if (w >= 7 && back % 2 === 0) {
      add('sight', 6, 0.75);
      (day.cl || (day.cl = {})).sight = [5, 5 * (26 - w), 5 * 6];
    }
    days[dayKey(d)] = day;
  }
  const at = (back) => now - back * DAY;
  const track = (level, history, more) => ({ level, maxLevel: level, window: [], levelStats: {}, intro: {}, last: at(0), history, ...more });
  return {
    createdAt: at(90), updatedAt: at(0), onboarded: true, sessions: 60,
    settings: { dailyGoal: 15 },
    tracks: {
      intervals: track(5, [{ level: 3, at: at(40), mastered: true }, { level: 4, at: at(10), mastered: true }]), // on week 10's dot
      sing: track(4, [{ level: 1, at: at(200), mastered: true }, { level: 1, at: at(30), mastered: true }, { level: 2, at: at(27), mastered: true }, { level: 3, at: at(3), mastered: true }]),
      degrees: track(2, []),
      chords: track(7, [{ level: 6, at: at(60), mastered: true }, { level: 7, at: at(5), mastered: true }], { complete: true }),
      harmony: track(1, []), melody: track(2, []), rhythm: track(3, []), sight: track(1, []),
    },
    items: {}, conf: {}, days, seen: { v2: true },
  };
};
