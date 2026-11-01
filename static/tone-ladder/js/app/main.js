/* Tone Ladder — the entry: hooks into the audio module, the action table, document events, boot. */
import { $, A, S, TL, applyAudio, deviceInfo, micCopy, requestWake, safeAudio, setDeviceInfo, toast } from './base.js';
import { R, app } from './state.js';
import { keyHints } from './answer-view.js';
import { answerActions, answerChoice, seqBack, seqPick, seqSubmit, singGrade, singGuess, singReveal } from './answer.js';
import { EX, exTonic, exploreActions } from './explore.js';
import { MIC, micActions, micFinish, micGo, micPause, micResume, setMicPref } from './mic.js';
import { midiActions, midiNote, midiReconnect, midiSupported } from './midi.js';
import { CAL, MOVE, micPrefAsk, openLink, prefsActions } from './prefs.js';
import { hideTips, progressActions, showTip } from './progress.js';
import { clapStop, onTap, renderRhythmState, rhythmActions, rhythmGo, safeTs } from './rhythm.js';
import { go, render } from './router.js';
import { renderStage } from './session-view.js';
import { finishSession, introData, nextQuestion, playPart, sessionActions } from './session.js';
import { todayActions } from './today.js';
import { trackActions } from './track.js';
import { MU, PL, musicOpen, renderMusicState, yourMusicActions } from './your-music.js';

  // a set arrived, or did not: the selects say so, unless the learner is typing or pasting there
  A.onSamples = () => { const ae = document.activeElement; if ((app.view === 'prefs' || app.view === 'explore') && !MOVE.pasting && !(ae && ae.matches && ae.matches('input, textarea'))) render(); };

  A.onState = (st) => { if (st !== 'running') micPause('clock'); };
  A.onMic = (ev) => {
    if (ev === 'mute') micPause('muted');
    else if (ev === 'unmute' && R && R.mic && R.mic.pause === 'muted') micResume();
    else if (ev === 'ended') micPause('ended');
  };

  // ======================================================================
  // EVENTS
  // ======================================================================
  function soundCheck() {
    if (!safeAudio()) return;
    const t = 60;
    A.play([...TL.cadenceEvents(t, 'major'), ...[0, 2, 4, 5, 7].map((s, i) => ({ t: TL.cadenceLength() + 0.4 + i * 0.32, notes: [t + s], dur: i === 4 ? 1.2 : 0.3, vel: 0.7 }))], { timbre: S.settings.timbre === 'vary' ? 'piano' : S.settings.timbre });
    toast('Playing four chords in C major, then Do Re Mi Fa Sol.');
  }

  const ACT = {
    go: (d) => go(d.view, { track: d.track }),

    soundCheck,

    reload: () => location.reload(),

    ...todayActions,
    ...trackActions,
    ...sessionActions,
    ...answerActions,
    ...midiActions,
    ...micActions,
    ...rhythmActions,
    ...exploreActions,
    ...yourMusicActions,
    ...progressActions,
    ...prefsActions,
  };

  // a manual copy from the fallback box counts as a backup
  document.addEventListener('copy', (e) => { if (e.target && e.target.closest && e.target.closest('#exportText')) setDeviceInfo({ backupAt: Date.now() }); });
  // iOS can suspend or interrupt audio (a call, the lock screen); the next touch brings it back
  document.addEventListener('pointerdown', () => A.wake(), true);
  document.addEventListener('keydown', () => A.wake(), true);
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); if (e.detail > 0 && el.blur) el.blur(); fn(el.dataset, el, e); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#tapPad')) {
      e.preventDefault();
      // the same pad starts the get-ready clicks, as Space does
      if (!onTap(e.timeStamp) && R && R.q && R.q.kind === 'tap' && R.rPhase === 'ready') rhythmGo();
    }
    else if (e.target.closest('#calPad') && CAL.active) { e.preventDefault(); CAL.taps.push(A.heardTime(safeTs(e.timeStamp))); flashPad('#calPad'); }
    // a tap away from a chart's weeks closes its numbers (a phone sends no mouse moves for it)
    else if (app.view === 'progress' && !e.target.closest('rect.hit')) hideTips();
  });
  function flashPad(sel) { const p = $(sel); if (p) { p.classList.add('hit'); setTimeout(() => p.classList.remove('hit'), 90); } }
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change === 'musicFile') { const f = el.files && el.files[0]; el.value = ''; if (f) musicOpen(f); return; }
    if (el.dataset.pref) {
      const k = el.dataset.pref;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (['speed', 'volume', 'dailyGoal', 'fixedKey', 'tapOffsetMs'].includes(k)) v = +v;
      if (k === 'tapOffsetMs' && !Number.isFinite(v)) v = 0;
      S.set(k, v);
      applyAudio();
      if (k === 'voice' && R && R.phase === 'intro') {
        R.intro.data = introData(R.intro.trackId, R.intro.L, R.intro.tonic);
        renderStage();
        const c0 = R.intro.data.cards[0];
        const d0 = c0 && c0.demos.length ? c0.demos[0] : R.intro.data.demos[0];
        if (d0) A.play(d0.events, { timbre: S.settings.timbre === 'vary' ? 'piano' : S.settings.timbre });
        return;
      }
      if (['keyMode', 'context', 'unlockAll'].includes(k)) render();
      return;
    }
    if (el.dataset.change === 'exKey') { EX.pc = +el.value; EX.prev = null; EX.trail = []; EX.voicings = []; if (A.droneTonic != null) A.droneStart(exTonic()); render(); }
    if (el.dataset.change === 'exTimbre') { EX.timbre = el.value; }
    if (el.dataset.change === 'micPref') {
      if (el.value === 'on') micPrefAsk();
      else { setMicPref('off'); MIC.denied = false; MIC.prefErr = null; MIC.prefTok++; if (!R) A.micClose(); render(); }
    }
    if (el.dataset.change === 'exResolve') { EX.resolve = el.checked; }
    if (el.dataset.hint) { S.settings.hints[el.dataset.hint] = el.value.trim(); S.touch(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.live && ACT[e.target.dataset.live]) { ACT[e.target.dataset.live]({ ...e.target.dataset, v: e.target.value }); return; }
    if (e.target.dataset.pref === 'volume') { S.settings.volume = +e.target.value; applyAudio(); }
  });
  // chart tooltips on Progress: a week's numbers while the pointer is over it
  document.addEventListener('mousemove', (e) => {
    if (app.view !== 'progress') return;
    const hit = e.target.closest && e.target.closest('rect.hit');
    if (hit) showTip(hit, e.clientY); else hideTips();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (CAL.active && (e.code === 'Space')) { e.preventDefault(); if (!e.repeat) { CAL.taps.push(A.heardTime(safeTs(e.timeStamp))); flashPad('#calPad'); } return; }
    if (app.view === 'music' && PL && PL.state().file) {
      if (e.target.closest && e.target.closest('button[data-act]') && (e.key === 'Enter' || e.code === 'Space')) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) ACT.muPlay(); }
      else if (k === 'arrowleft') { e.preventDefault(); ACT.muBack(); }
      else if (k === 'arrowright') { e.preventDefault(); ACT.muFwd(); }
      else if (k === 'a') ACT.muA(); else if (k === 'b') ACT.muB(); else if (k === 'l') ACT.muLoopOff(); else if (k === 'm' && !e.repeat) ACT.muMark();
      return;
    }
    if (app.view !== 'session' || !R) return;
    // a button reached with the keyboard presses itself (Enter or Space), not the screen's shortcut
    const btn = e.target.closest && e.target.closest('button[data-act]');
    if (btn && (e.key === 'Enter' || e.code === 'Space')) { if (e.repeat) e.preventDefault(); return; }
    const q = R.q;
    const k = e.key;
    if (R.phase === 'intro') { if (k === 'Enter') { e.preventDefault(); ACT.startLevel(); } return; }
    if (R.phase === 'between') { if (k === 'Enter') { e.preventDefault(); ACT.continueBlock(); } return; }
    if (R.phase === 'mic') {
      if (k === 'Enter' && !e.repeat) {
        e.preventDefault();
        const g = R.micGate;
        if (g === 'ask' || g === 'start') micGo(); else if (g === 'tap') ACT.micTap(); else if (g === 'error') nextQuestion();
      }
      return;
    }
    if (!q) return;
    if (q.kind === 'tap') {
      if (e.code === 'Space' || k === 'j' || k === 'f') {
        e.preventDefault();
        if (!e.repeat && !onTap(e.timeStamp) && e.code === 'Space' && R.rPhase === 'ready') rhythmGo();
        return;
      }
      if (k === 'Enter') { e.preventDefault(); if (R.rPhase === 'ready') rhythmGo(); else if (R.rPhase === 'result') nextQuestion(); }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (q.kind === 'sing' && R.phase === 'revealed') playPart('reveal');
      else if (q.kind === 'sing' && R.phase === 'feedback' && q.audio.parts.model) playPart('model');
      else playPart('main');
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      // a held Enter must not run Done, accept and next in one go
      if (q.kind === 'sing' && e.repeat) return;
      if (R.phase === 'feedback') nextQuestion();
      else if (q.kind === 'sequence' && R.phase === 'answering' && R.mic && R.mic.state === 'paused') micResume();
      else if (q.kind === 'sequence' && R.phase === 'answering' && R.mic && ['listening', 'quiet', 'missed'].includes(R.mic.state) && !R.input.every(Boolean)) micFinish(true);
      else if (q.kind === 'sequence' && R.phase === 'answering') seqSubmit();
      else if (q.kind === 'sing' && R.phase === 'answering') { if (R.mic && R.mic.state === 'paused') micResume(); else if (R.mic && R.mic.state !== 'off') micFinish(true); else singReveal(); }
      else if (q.kind === 'sing' && R.phase === 'revealed' && R.mic && R.mic.state === 'heard' && R.mic.shown && !(R.mic.guessFirst && R.mic.guess == null)) singGrade(R.mic.result.v);
      return;
    }
    if (k === 'Backspace' && q.kind === 'sequence') { e.preventDefault(); seqBack(); return; }
    const m = e.code.match(/^(?:Digit|Numpad)(\d)$/);
    if (!m) return;
    const digit = m[1];
    if (q.kind === 'sing') {
      if (R.phase === 'revealed') {
        const v = { 1: 1, 2: 0.5, 3: 0 }[digit];
        if (v != null) { if (R.mic && R.mic.state === 'heard' && R.mic.shown && R.mic.guessFirst && R.mic.guess == null) singGuess(v); else singGrade(v); }
      }
      return;
    }
    let id = null;
    if (q.layout === 'ladder') {
      const hints = keyHints(q.options, q.mode);
      id = hints[(e.shiftKey ? 'S' : '') + digit] || null;
    } else {
      const i = digit === '0' ? 9 : +digit - 1;
      id = q.options[i] ? q.options[i].id : null;
    }
    if (!id) return;
    e.preventDefault();
    if (q.kind === 'choice') answerChoice(id); else seqPick(id);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') S.save(true);
    else if (!R || R.phase === 'summary') S.pull().catch(() => {});
    if (document.visibilityState === 'visible' && R && app.view === 'session') requestWake();
    if (document.visibilityState === 'hidden') {
      if (A.micOn) { micPause('hidden'); if (MIC.timer) { clearInterval(MIC.timer); MIC.timer = null; } }
      A.micClose(); // also drops a request the browser has not answered yet
      if (R && R.clap) { clapStop(); R.clap = null; if (R.q && R.q.kind === 'tap') renderRhythmState(); } // the copy stops promising claps
      if (R && R.phase === 'mic' && R.micGate === 'opening') { MIC.gate++; R.micGate = 'start'; renderStage(); }
    }
  });

  // ---------- boot ----------
  S.onChange(() => {
    if (app.view !== 'session') { render(); return; }
    if (S.blocked && R && R.phase !== 'summary') finishSession(true);
  });
  const h = (location.hash || '').replace('#', '');
  if (['explore', 'music', 'progress', 'method', 'prefs'].includes(h)) app.view = h;
  applyAudio();
  render();
  S.init().then(() => { applyAudio(); if (app.view !== 'session') render(); });
  // works offline once seen (the site copy only; the claude.ai copy is served another way)
  if ('serviceWorker' in navigator && !micCopy() && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { /* no offline copy on this device */ });
  if (deviceInfo().midi === 'on' && midiSupported()) midiReconnect();
  if (/^#p=/.test(location.hash)) openLink(location.hash);
  if (PL) PL.onChange = () => renderMusicState();
  window.__toneLadder = { app, get runner() { return R; }, ACT, midiNote, musicOpen, get music() { return MU; } };
