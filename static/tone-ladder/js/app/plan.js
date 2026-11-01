/* Tone Ladder — the daily plan. */
import { S, TL, TRACK, TRACKS, sungTrack } from './base.js';
import { R } from './state.js';

  // ======================================================================
  // DAILY PLAN
  // ======================================================================
  const SEC_PER = { degrees: 13, intervals: 10, chords: 10, harmony: 28, melody: 30, rhythm: 26, sing: 18, sight: 24, mix: 16 };
  const FOCUS_COUNT = { intervals: 10, chords: 10, harmony: 5, melody: 6, rhythm: 6, sight: 5 };
  const FREE_COUNT = { degrees: 20, intervals: 20, chords: 20, harmony: 8, melody: 10, rhythm: 10, sing: 8, sight: 8 };
  function buildDailyPlan() {
    const k = S.settings.dailyGoal / 30;
    const n = (x, min) => Math.max(min, Math.round(x * k));
    const unlocked = TRACKS.map((t) => t.id).filter((id) => S.isUnlocked(id));
    // On day one Do is taught in the Core set first, so the singing set moves to the end.
    const tuneIn = { track: 'sing', count: Math.min(3, n(2, 1)), role: 'Tune in' };
    const core = { track: 'degrees', count: n(10, 6), role: 'Core' };
    const plan = S.track('degrees').last ? [tuneIn, core] : [core];
    const rest = unlocked.filter((id) => id !== 'degrees' && id !== 'sing');
    // least recently practiced first; ties (day one) start with the track that needs no note names
    const ORDER = ['chords', 'intervals', 'rhythm', 'melody', 'harmony', 'sight'];
    rest.sort((a, b) => (S.track(a).last || 0) - (S.track(b).last || 0) || ORDER.indexOf(a) - ORDER.indexOf(b));
    rest.slice(0, S.settings.dailyGoal >= 45 ? 2 : 1).forEach((id) => plan.push({ track: id, count: n(FOCUS_COUNT[id], 3), role: 'Focus' }));
    plan.push({ track: 'mix', count: n(8, 4), role: 'Mixed review' });
    // the closing set alternates between singing what is heard and singing what is written
    const sightClose = S.isUnlocked('sight') && !plan.some((b) => b.track === 'sight') && (S.track('sight').last || 0) <= (S.track('sing').last || 0);
    plan.push(sightClose ? { track: 'sight', count: Math.min(4, n(3, 2)), role: 'Sing to finish' } : { track: 'sing', count: Math.min(3, n(2, 1)), role: 'Sing to finish' });
    return plan;
  }
  // Today's plan is kept on this device after it starts, so an interrupted session resumes where it stopped.
  const PLAN_KEY = 'tone-ladder-v1-plan';
  function savedPlan() {
    try {
      const p = JSON.parse(localStorage.getItem(PLAN_KEY));
      const ok = p && p.day === TL.dayKey() && Array.isArray(p.blocks) && p.blocks.length
        && p.blocks.every((b) => b && (b.track === 'mix' || (TRACK[b.track] && S.isUnlocked(b.track))) && Number.isFinite(b.count) && Number.isFinite(b.done));
      return ok ? p : null;
    } catch (e) { return null; }
  }
  function storePlan(blocks, day) {
    if (S.blocked) return;
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify({
        day,
        blocks: blocks.map((b) => ({ track: b.track, count: b.count, role: b.role, done: b.skipped ? b.count : Math.min(b.done || 0, b.count), skipped: !!b.skipped })),
      }));
    } catch (e) { /* storage blocked: the plan simply starts over */ }
  }
  const planLeft = (p) => !!p && p.blocks.some((b) => b.done < b.count);
  const dropPlan = () => { try { localStorage.removeItem(PLAN_KEY); } catch (e) { /* blocked */ } };
  const savePlanNow = () => { if (R && R.daily) storePlan(R.plan, R.planDay); };
  function reviewable() {
    return TRACKS.map((t) => t.id).filter((id) => !sungTrack(id) && S.isUnlocked(id) && S.track(id).intro[S.track(id).level] && S.track(id).last);
  }
  const planMinutes = (plan) => Math.max(3, Math.round(plan.reduce((a, b) => a + b.count * (SEC_PER[b.track] || 15), 0) / 60));

export { FREE_COUNT, buildDailyPlan, dropPlan, planLeft, planMinutes, reviewable, savePlanNow, savedPlan };
