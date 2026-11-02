/* Tone Ladder — answering choice, sequence and sing questions. */
import { $, A, S, TL, TRACK, isFindDo, setDeviceInfo, toast } from './base.js';
import { R } from './state.js';
import { renderSeq } from './answer-view.js';
import { restage } from './dictation.js';
import { MIC, micRounds, takeHere } from './mic.js';
import { renderStage } from './session-view.js';
import { block, commit, itemFromChoice, nextQuestion, playPart, queueRetry, setListening } from './session.js';

  // ---------- answering: choice ----------
  function answerChoice(id) {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'choice') return;
    if (!q.options.some((o) => o.id === id)) return;
    R.phase = 'feedback';
    R.chosen = id;
    const correct = id === q.answer;
    const rt = R.mainEnd ? performance.now() - R.mainEnd : 0;
    const chosenItem = itemFromChoice(q, id);
    commit(q, [correct ? 1 : 0], rt, correct ? [] : [[q.stats[0], chosenItem]], answeredEarly());
    if (!correct) {
      const pool = block().pool || TRACK[q.track].levels[q.level].items;
      queueRetry(q, pool.includes(chosenItem) ? chosenItem : null);
    }
    R.rt = rt;
    renderStage();
    revealFeedback();
    const h = playPart('reveal');
    if (correct && S.settings.autoAdvance && !R.levelUpNow && h) {
      const qid = q.id;
      h.done.then((ok) => setTimeout(() => { if (ok && R && R.q && R.q.id === qid && R.phase === 'feedback') nextQuestion(); }, 500));
    }
  }

  // the answer came while the question was still sounding the first time, uncut: not after a part
  // of it or a tapped chord stopped it, and not during a replay
  const answeredEarly = () => R.mainEnd == null && R.mainH != null && !R.mainH.cancelled && R.replays === 1;

  // ---------- answering: sequence ----------
  function revealFeedback() {
    if (window.innerWidth > 820) return;
    const fb = $('#fb');
    if (fb) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function seqPick(id) {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'sequence') return;
    if (!q.options.some((o) => o.id === id)) return;
    const n = q.answer.length;
    if (R.cursor >= n) R.cursor = n - 1;
    R.input[R.cursor] = id;
    if (q.track === 'melody' && S.settings.dictationSound) A.play(q.tapSound(id, q.melody[0]), { timbre: q.timbre });
    if (q.track === 'harmony' && S.settings.dictationSound) A.play([{ t: 0, notes: TL.voiceChord(TL.rnPcs(id), TL.rnBassPc(id), q.tonic, null), dur: 1, vel: 0.6 }], { timbre: q.timbre });
    let c = R.cursor + 1;
    while (c < n && R.input[c]) c++;
    if (c >= n) { const empty = R.input.findIndex((x) => !x); c = empty === -1 ? n : empty; }
    R.cursor = c;
    renderSeq();
  }
  function seqBack() {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'sequence') return;
    const n = q.answer.length;
    if (R.cursor < n && R.input[R.cursor]) R.input[R.cursor] = null;
    else {
      let c = Math.min(R.cursor, n) - 1;
      if (c < 0) return;
      R.input[c] = null; R.cursor = c;
    }
    renderSeq();
  }
  function seqSelect(i) {
    if (!R || R.phase !== 'answering') return;
    R.cursor = i;
    renderSeq();
  }
  function seqSubmit() {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'sequence') return;
    if (R.input.some((x) => !x)) { toast('Fill every slot first.'); return; }
    R.phase = 'feedback';
    const results = q.answer.map((a, i) => (R.input[i] === a ? 1 : 0));
    const conf = q.answer.map((a, i) => (R.input[i] !== a ? [a, R.input[i]] : null)).filter(Boolean);
    const rt = R.mainEnd ? performance.now() - R.mainEnd : 0;
    commit(q, results, rt / q.answer.length, conf, answeredEarly());
    R.results = results;
    renderStage();
    revealFeedback();
    playPart('reveal');
  }

  // ---------- answering: sing ----------
  function singReveal() {
    if (!R || !R.q || R.q.kind !== 'sing' || R.phase !== 'answering' || R.mainEnd == null) return;
    A.takeStop(); // the take ends with the answer; the reveal and the sing-along are not part of it
    R.phase = 'revealed';
    renderStage();
    playPart('reveal');
  }
  const GRADE_NAME = { 1: 'Matched', 0.5: 'Close', 0: 'Missed' };
  function singGrade(v) {
    const q = R && R.q;
    if (!q || q.kind !== 'sing' || R.phase !== 'revealed' || ![0, 0.5, 1].includes(v)) return;
    const heard = R.mic && R.mic.state === 'heard' ? R.mic : null;
    if (heard && !heard.shown) return; // the answer is still playing: sing along first
    if (q.echoAnswer && R.replays > 1) q.practice = true; // the melody was replayed
    if (q.copy) {
      // copying the app is practice for the voice: nothing is recorded
      R.phase = 'feedback';
      toast(`${GRADE_NAME[v]} (copy, not scored)`, 1200);
      const cid = q.id;
      setTimeout(() => { if (R && R.q && R.q.id === cid) nextQuestion(); }, 600);
      return;
    }
    let misheard = false;
    if (heard) {
      // a grade above the app's means it misheard: the round is not scored either way
      if (v > heard.result.v) { q.practice = true; misheard = true; R.micOverrides = (R.micOverrides || 0) + 1; }
      if (heard.warmup) q.practice = true;
      // how far off it was sung, as today's intonation sample for this note or pattern
      if (!misheard && heard.result.v != null) {
        const r = heard.result, ns = r.notes || [];
        // only notes that were the right note (a wrong note says nothing about tuning), measured
        // against the target as played: in a melody that is `tune`, before any common offset is forgiven
        const vals = heard.kind === 'hold'
          ? [ns[Number.isInteger(r.graded) ? r.graded : ns.length - 1]].filter((x) => x && Number.isFinite(x.off) && Math.abs(x.off) <= 100).map((x) => x.off)
          : r.reason === 'transposed' || r.v === 0 ? [] : ns.filter((x) => x.ok && Number.isFinite(x.tune) && Math.abs(x.tune) <= 100).map((x) => x.tune);
        if (vals.length) S.recordPitch(q.track, q.item, vals.reduce((a, x) => a + Math.abs(x), 0) / vals.length, vals.reduce((a, x) => a + x, 0) / vals.length, !q.practice);
      }
      MIC.rounds = micRounds() + 1;
      setDeviceInfo({ micRounds: MIC.rounds });
    }
    if (isFindDo(q) && !q.practice) R.findDoMisses = v === 0 ? (R.findDoMisses || 0) + 1 : 0;
    commit(q, [v], 0, []);
    if (isFindDo(q) && !q.practice && R.findDoMisses >= 2 && !R.levelUpNow) { S.state.findDoPracticeNext = true; S.touch(); }
    R.phase = 'feedback';
    if (v === 0 && q.model) { R.singMissed = true; renderStage(); setListening(false); return; }
    if (R.levelUpNow) { renderStage(); setListening(false); return; }
    const advise = misheard && R.micOverrides === 3;
    if (advise) toast('If the app keeps mishearing you, switch to checking yourself in Settings, or try another microphone.', 4200);
    // a misheard answer is the one worth keeping: offer its take instead of moving straight on
    if (misheard && takeHere()) { R.takeOffer = { qid: q.id, v }; renderStage(); setListening(false); return; }
    if (!advise) toast(misheard ? 'Not scored: the app may have misheard you.' : `Saved: ${GRADE_NAME[v]}${q.practice ? ' (practice)' : ''}`, misheard ? 2200 : 1100);
    const id = q.id;
    setTimeout(() => { if (R && R.q && R.q.id === id) nextQuestion(); }, misheard ? 900 : 450);
  }

  // The learner's own grade, given before the app shows its own: tallied, then the verdict appears.
  function singGuess(v) {
    const m = R && R.mic;
    if (!m || !R.q || R.phase !== 'revealed' || m.state !== 'heard' || !m.shown || !m.guessFirst || m.guess != null || ![0, 0.5, 1].includes(v)) return;
    m.guess = v;
    S.noteGuess(v === m.result.v);
    renderStage();
  }

  // this screen's part of the action table (data-act), merged in main.js
  const answerActions = {
    answer: (d) => answerChoice(d.id),
    pick: (d) => seqPick(d.id),
    slot: (d) => seqSelect(+d.slot),
    seqBack,
    seqSubmit,
    singReveal,
    singGrade: (d) => singGrade(+d.v),
    singGuess: (d) => singGuess(+d.v),
    // a Full Dictation question is long work at the keyboard: the toggle keeps the focus there
    staffAlt: () => { if (R) { R.staffAlt = !R.staffAlt; if (R.q && R.q.kind === 'dictation') restage('[data-act="staffAlt"]'); else renderStage(); } },
    showNames: () => { const q = R && R.q; if (!q || !q.staff || R.phase !== 'answering' || q.namesShown) return; q.namesShown = true; q.practice = true; renderStage(); },
  };

export { GRADE_NAME, answerActions, answerChoice, revealFeedback, seqBack, seqPick, seqSubmit, singGrade, singGuess, singReveal };
