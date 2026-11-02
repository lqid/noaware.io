/* Tone Ladder — Full Dictation: writing a heard melody's rhythm from beat figures, naming its notes, checking it. */
import { $, A, S, TL, toast } from './base.js';
import { R } from './state.js';
import { revealFeedback } from './answer.js';
import { keyHints } from './answer-view.js';
import { dictBarStatus, dictNameStatus, renderDict } from './dictation-view.js';
import { renderStage } from './session-view.js';
import { commit, playPart, setListening } from './session.js';

  // ======================================================================
  // FULL DICTATION: ANSWERING
  // ======================================================================
  // R.dict (set in nextQuestion): { entry, step: 'rhythm' | 'notes', at: the beat a figure goes to
  // (a tick), ni: the written note a name goes to (an index into TL.Dict.onsets), switched: the
  // step has moved to Notes by itself once }. Every edit is a new entry from TL.Dict, which refuses
  // what cannot be written. Nothing answers until the melody has been heard once.
  function dictOpen() {
    const q = R && R.q;
    return q && q.kind === 'dictation' && R.phase === 'answering' && R.mainEnd != null ? q : null;
  }
  // The learner's own sounds (dictation playback, Play mine): the pill reads Listening while they
  // play and goes back when they end; a part they cut off leaves it alone, and a sound that cuts
  // them off sets it itself. An edit's sound gives way to the question's own: a hearing is counted
  // as it starts, so writing along must not stop it. Only Play mine does. The handle's own end
  // says whether it still sounds: A.playing() stays true while a drone holds Do.
  function dictSound(q, evs, edit = false) {
    const p = R.playH;
    if (!evs.length || (edit && p && !p.cancelled && p.nominalEnd + A.latency() > A.now())) return; // its last note reaches the ear a latency later
    R.playH = null;
    setListening(true);
    A.play(evs, { timbre: q.timbre }).done.then((ok) => { if (ok) setListening(false); });
  }
  // renderStage draws the stage afresh; focus that was in it (reached with the keyboard: a click
  // blurs first) goes on to sel, so the next Tab starts where the learner is
  function restage(sel) {
    const ae = document.activeElement, inStage = !!(ae && ae.closest && ae.closest('#stage'));
    renderStage();
    if (inStage) { const el = $(sel); if (el) el.focus(); }
  }

  function dictStep(step) {
    const q = dictOpen();
    if (!q || (step !== 'rhythm' && step !== 'notes')) return;
    const d = R.dict;
    if (step === 'notes') {
      const on = TL.Dict.onsets(q, d.entry);
      if (!on.length) return; // the notes open once one is written
      // at the first note without a name; with none, never on the given one, which is drawn as text
      const i = TL.Dict.nextUnnamed(q, d.entry, -1);
      d.ni = i >= 0 ? i : Math.max(TL.Dict.locked(q, on[0].tick) ? 1 : 0, d.ni);
    }
    d.step = step;
    restage(`[data-act="dStep"][data-step="${step}"]`);
  }
  // a chip tapped: the cursor goes to its beat
  function dictAt(tick) {
    const q = dictOpen();
    if (!q || !(tick >= 0 && tick < q.bars * q.barTicks) || tick % q.beat) return;
    R.dict.at = tick;
    renderDict();
  }
  // A figure picked: written at the cursor over whatever was there, and the cursor goes on to the
  // next empty beat, round to the first. One that cannot go there says why.
  function dictFig(id) {
    const q = dictOpen();
    if (!q) return;
    const d = R.dict, no = TL.Dict.refuse(q, id, d.at);
    if (no) {
      if (no.why === 'bar') toast(`That needs ${no.need} beats. Bar ${no.bar} has ${no.left} left.`);
      else if (no.why === 'first') toast('The melody starts on the first beat.');
      return;
    }
    d.entry = TL.Dict.place(q, d.entry, id, d.at);
    const next = TL.Dict.nextBlank(q, d.entry, d.at);
    if (next != null) d.at = next;
    // The first time every bar is full, the names come next, at the first note without one. With
    // every note named already (by MIDI keys during Rhythm), at the first that takes a name, not
    // the given one, which is drawn as text and cannot hold the focus; with none, the focus goes
    // to the Notes button.
    if (!d.switched && TL.Dict.full(q, d.entry)) {
      const on = TL.Dict.onsets(q, d.entry), first = on.length && TL.Dict.locked(q, on[0].tick) ? 1 : 0;
      d.switched = true; d.step = 'notes'; d.ni = Math.max(first, TL.Dict.nextUnnamed(q, d.entry, -1));
      restage(d.ni < on.length ? '#dictSlots .slot.active' : '[data-act="dStep"][data-step="notes"]');
    } else renderDict();
    if (S.settings.dictationSound) dictSound(q, q.figSound(id), true);
  }
  function dictSlot(i) {
    const q = dictOpen();
    if (!q || !(i >= 0 && i < TL.Dict.onsets(q, R.dict.entry).length)) return;
    R.dict.ni = i;
    renderDict();
  }
  // A name for written note i (past the end: the last); the cursor goes on to the next unnamed
  // note, round to the first, as in Melodic Dictation. With dictation playback, it sounds where it
  // is drawn: near the note named before it.
  function dictNameAt(q, i, id) {
    const d = R.dict, on = TL.Dict.onsets(q, d.entry);
    if (i >= on.length) i = on.length - 1;
    if (i < 0 || TL.Dict.locked(q, on[i].tick)) i = TL.Dict.nextUnnamed(q, d.entry, -1);
    if (i < 0) return;
    const e = TL.Dict.name(q, d.entry, on[i].tick, id);
    if (!e) return;
    d.entry = e;
    const k = TL.Dict.nextUnnamed(q, e, i);
    d.ni = k >= 0 ? k : on.length;
    renderDict();
    if (S.settings.dictationSound) {
      const at = TL.Dict.pitches(q, e).slice(0, i).filter((s) => s != null);
      dictSound(q, q.tapSound(id, at.length ? at[at.length - 1] : q.notes[0].semi), true);
    }
  }
  // Delete. In Rhythm: the figure at the cursor, or on an empty beat the one before it, and the
  // cursor goes there. In Notes: the name at the cursor, or the one before it; the given name stays.
  function dictBack() {
    const q = dictOpen();
    if (!q) return;
    const d = R.dict;
    if (d.step === 'rhythm') {
      const f = TL.Dict.figAt(d.entry, d.at) || TL.Dict.figBefore(d.entry, d.at);
      if (!f) return;
      d.entry = TL.Dict.remove(q, d.entry, f.start);
      d.at = f.start;
    } else {
      const on = TL.Dict.onsets(q, d.entry);
      let i = Math.min(d.ni, on.length);
      if (!(on[i] && on[i].name && !TL.Dict.locked(q, on[i].tick))) i--;
      if (i < 0 || TL.Dict.locked(q, on[i].tick)) return;
      if (on[i].name) d.entry = TL.Dict.unname(q, d.entry, on[i].tick);
      d.ni = i;
    }
    renderDict();
  }
  // ← and →: the chip or the slot before or after the cursor
  function dictMove(q, dir) {
    const d = R.dict;
    if (d.step === 'rhythm') {
      const starts = [...new Set(TL.Dict.items(q, d.entry).map((x) => x.start))];
      d.at = starts[Math.max(0, Math.min(starts.length - 1, Math.max(0, starts.indexOf(d.at)) + dir))];
    } else {
      const on = TL.Dict.onsets(q, d.entry), first = on.length && TL.Dict.locked(q, on[0].tick) ? 1 : 0;
      d.ni = Math.max(first, Math.min(on.length - 1, d.ni + dir));
    }
    renderDict();
  }
  // Play mine, and Hear what you wrote after Check: the entry over the same clicks, named notes on
  // the organ and unnamed ones as knocks; after Check, a right name at the melody's own octave
  function dictPlay() {
    const q = R && R.q;
    if (!q || q.kind !== 'dictation' || !(R.phase === 'feedback' || dictOpen())) return;
    dictSound(q, q.compare(R.dict.entry, R.phase === 'feedback' ? R.dict.grade : undefined));
  }
  // Check: every note graded for its name and its length; the scores (one per note, a 0 per extra
  // note) are what the level counts, the results (per name and per figure) what the items count
  function dictCheck() {
    const q = dictOpen();
    if (!q) return;
    const e = R.dict.entry;
    if (!TL.Dict.full(q, e)) { toast('Fill every bar first.'); return; }
    if (!TL.Dict.complete(q, e)) { toast('Name every note first.'); return; }
    const g = TL.gradeDictation(q, e);
    R.phase = 'feedback';
    R.dict.grade = g;
    commit(q, g.results, 0, g.confusions, false, { scores: g.scores });
    renderStage();
    revealFeedback();
    playPart('reveal');
  }

  // Keys while a dictation question is answered: called by main.js before its own, true when the key
  // was this one's (taken, or ignored until the melody has been heard). Space stays main.js's.
  function dictKey(e) {
    const q = R && R.q;
    if (!q || q.kind !== 'dictation' || R.phase !== 'answering' || e.code === 'Space') return false;
    const k = e.key, digit = (String(e.code).match(/^(?:Digit|Numpad)(\d)$/) || [])[1];
    if (!digit && !['ArrowLeft', 'ArrowRight', 'Backspace', 'Enter'].includes(k) && !/^[rn]$/i.test(k)) return false;
    e.preventDefault();
    if (R.mainEnd == null || (k === 'Enter' && e.repeat)) return true; // listen first; a held Enter checks once
    const d = R.dict;
    if (/^r$/i.test(k)) dictStep('rhythm');
    else if (/^n$/i.test(k)) dictStep('notes');
    else if (k === 'Backspace') dictBack();
    else if (k === 'ArrowLeft' || k === 'ArrowRight') dictMove(q, k === 'ArrowLeft' ? -1 : 1);
    else if (k === 'Enter') {
      // not ready: on to the names once the bars are full, or what is still missing
      if (TL.Dict.complete(q, d.entry)) dictCheck();
      else if (TL.Dict.full(q, d.entry) && d.step === 'rhythm') dictStep('notes');
      else toast(TL.Dict.full(q, d.entry) ? dictNameStatus(q, d.entry) : dictBarStatus(q, d.entry, d.at));
    } else if (d.step === 'rhythm') { if (q.palette[+digit - 1]) dictFig(q.palette[+digit - 1]); }
    else { const id = keyHints(q.options, q.mode)[(e.shiftKey ? 'S' : '') + digit]; if (id) dictNameAt(q, d.ni, id); }
    return true;
  }
  // a MIDI key: names the note at the Notes cursor, or in Rhythm the first note without a name
  function dictName(id) {
    const q = dictOpen();
    if (!q) return;
    const d = R.dict;
    dictNameAt(q, d.step === 'notes' ? d.ni : TL.Dict.nextUnnamed(q, d.entry, -1), id);
  }

  // this screen's part of the action table (data-act), merged in main.js
  const dictationActions = {
    dStep: (d) => dictStep(d.step),
    dAt: (d) => dictAt(+d.tick),
    dFig: (d) => dictFig(d.id),
    dSlot: (d) => dictSlot(+d.n),
    dName: (d) => { const q = dictOpen(); if (q) dictNameAt(q, R.dict.ni, d.id); },
    dBack: dictBack,
    dPlay: dictPlay,
    dCheck: dictCheck,
  };

export { dictKey, dictName, dictationActions, restage };
