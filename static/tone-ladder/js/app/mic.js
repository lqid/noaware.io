/* Tone Ladder — the microphone: the gate, the listener, grading, pause and resume, copying, takes. */
import { $, A, CUR, DEG, S, TL, TRACK, deviceInfo, isFindDo, micCopy, setDeviceInfo, toast } from './base.js';
import { R, app } from './state.js';
import { singReveal } from './answer.js';
import { clapStop } from './rhythm.js';
import { render } from './router.js';
import { renderSession, renderStage } from './session-view.js';
import { nextQuestion, playPart } from './session.js';
import { meterMic } from './sing-view.js';

  // ---------- answering: sing, checked by the microphone ----------
  // The choice is kept per device (microphone access belongs to one browser) and cached here, so a
  // browser that blocks storage still remembers it for the visit.
  const MIC = { choice: undefined, rounds: undefined, perm: null, denied: false, timer: null, lastT: -1, gate: 0, test: 0, prefTok: 0, warned: false };
  function micPref() { if (MIC.choice === undefined) MIC.choice = deviceInfo().mic || null; return MIC.choice; }
  function micRounds() { if (MIC.rounds === undefined) MIC.rounds = deviceInfo().micRounds || 0; return MIC.rounds; }
  function setMicPref(v) { MIC.choice = v; setDeviceInfo({ mic: v }); }

  function micPolicy() {
    const pp = document.permissionsPolicy || document.featurePolicy;
    try { return pp && pp.allowsFeature ? (pp.allowsFeature('microphone') ? 'yes' : 'no') : 'unknown'; } catch (e) { return 'unknown'; }
  }
  const micFramed = () => { try { return window.self !== window.top; } catch (e) { return true; } };
  const micAvailable = () => typeof TL.Pitch !== 'undefined' && A.micSupported() && micPolicy() !== 'no' && !(micCopy() && micPolicy() !== 'yes');
  const micWanted = () => micPref() === 'on' && micAvailable() && !MIC.denied;
  // the browser's own permission state where it reports one: 'granted' | 'denied' | 'prompt' | null
  async function micPermission() {
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      p.onchange = () => { MIC.perm = p.state; if (app.view === 'prefs') render(); };
      return (MIC.perm = p.state);
    } catch (e) { return null; }
  }
  // dictation with the microphone on: the melody is sung back before its notes are named
  const singBack = (q) => !!q && !!q.singBack && q.kind === 'sequence' && Array.isArray(q.melody);
  const micQuestion = (q) => !!q && (q.kind === 'sing' || singBack(q));
  // what the listener grades: one pitch class held, or a melody, in semitones from Do
  function singTarget(q) {
    if (singBack(q)) return { kind: 'sequence', semis: q.melody };
    if (q.pattern) return { kind: 'sequence', semis: q.patternSemis };
    if (q.echoSemis) return { kind: 'sequence', semis: q.echoSemis };
    if (q.singSemi != null) return { kind: 'hold', semis: [q.singSemi] }; // from the given note, not from Do
    return { kind: 'hold', semis: [DEG[q.deg || q.bassAnswer || q.toneAnswer].semi] };
  }

  // Before the first question of a Sing set, and after a level's introduction, the mic opens with
  // nothing playing: a permission prompt, or an iPhone switching to recording, would otherwise land
  // on the chords that set the key.
  function micGate(trackId) {
    if (R.micSkip || micPref() === 'off' || !micAvailable() || MIC.denied) return false;
    if (micPref() === 'on' && A.micOn && A.running) return false;
    A.stop();
    R.micFor = trackId;
    R.phase = 'mic';
    R.q = null;
    R.mic = null;
    A.takeForget();
    R.micSlow = false;
    if (micPref() !== 'on') R.micGate = 'ask';
    else if (MIC.perm === 'granted' && A.running && document.visibilityState !== 'hidden') { micGo(); return true; } // permission is kept: no tap needed
    else R.micGate = 'start';
    renderSession();
    return true;
  }
  function micGo() {
    if (!R || R.phase !== 'mic') return;
    setMicPref('on');
    A.ensure(); A.wake();
    R.micGate = 'opening';
    renderSession();
    const gen = ++MIC.gate;
    const live = () => !!R && R.phase === 'mic' && MIC.gate === gen;
    setTimeout(() => { if (live() && R.micGate === 'opening') { R.micSlow = true; renderStage(); } }, 6000);
    A.micOpen()
      .then(() => new Promise((res) => setTimeout(res, 300))) // let an audio route change settle
      .then(() => {
        if (!live()) return;
        MIC.prefErr = null;
        micPermission();
        if (document.visibilityState === 'hidden') { A.micClose(); R.micGate = 'start'; renderStage(); return; }
        if (!A.running) { R.micGate = 'tap'; renderStage(); return; }
        nextQuestion();
      }, (e) => micOpenFailed(e, live));
  }
  async function micOpenFailed(e, live) {
    const name = (e && e.name) || '';
    if ((e && e.tlClosed) || !live()) return;
    let err = 'other';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      const st = await micPermission();
      if (/system/i.test((e && e.message) || '')) err = 'system';
      else if (st === 'prompt') err = 'dismissed'; // the prompt was closed, not refused: ask again next set
      else { err = micFramed() || micCopy() ? 'framed' : 'blocked'; setMicPref('off'); MIC.denied = true; }
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') err = 'none';
    else if (name === 'NotReadableError') err = 'busy';
    if (!live()) return;
    R.micSkip = true;
    R.micGate = 'error';
    R.micErr = err;
    renderStage();
  }
  // the learner checks themselves for the rest of this set
  function micSkipSet() {
    if (!R) return;
    R.micSkip = true;
    micRelease();
    if (R.phase === 'mic') nextQuestion(); else renderStage();
  }

  // One listener per question, made before anything plays so it hears how loud the app is.
  function micListen(q) {
    R.mic = null;
    A.takeForget(); // the last answer's sound goes as the next question starts, listened to or not
    if (!micQuestion(q) || R.micSkip || !micWanted() || !A.micOn) return;
    const tg = singTarget(q);
    let L;
    try { L = TL.Pitch.listener({ sampleRate: A.micRate(), doMidi: q.singRoot != null ? q.singRoot : CUR.voiceTonic(q.tonic, S.settings.voice), kind: tg.kind, target: tg.semis }); } catch (e) { micBroken(e); return; }
    R.mic = { qid: q.id, L, kind: tg.kind, state: 'listening', result: null, shown: false, nulls: 0, quietFrom: null, pause: null, ticks: [], fftSize: 0, take: null };
    // the answer's sound and the moments the listener heard it, for "Save this take"
    A.takeStart();
    if (A.micMuted) { R.mic.state = 'paused'; R.mic.pause = 'muted'; }
    MIC.lastT = -1;
    if (!MIC.timer) MIC.timer = setInterval(micTick, 20);
  }
  function micBroken(e) {
    if (!MIC.warned) { MIC.warned = true; console.warn('Tone Ladder: the pitch listener failed, so you check yourself.', e); }
    if (R && R.mic) { R.mic.state = 'off'; A.takeStop(); if (R.phase === 'answering') renderStage(); }
  }
  function micTick() {
    if (!A.micOn) { clearInterval(MIC.timer); MIC.timer = null; return; }
    const m = R && R.mic;
    if (!m || m.state === 'off' || m.state === 'paused' || m.state === 'heard' || !R.q || R.q.id !== m.qid || R.phase !== 'answering') return;
    // a stopped audio clock hands back the same frame again and again
    if (!A.running) return;
    const t = A.now();
    if (t <= MIC.lastT) return;
    MIC.lastT = t;
    const f = A.micFrame();
    if (!f) { micPause('muted'); return; }
    const playing = A.playing();
    let p, st;
    try { p = m.L.push(f, t, { appPlaying: playing }); st = m.L.status(t); } catch (e) { micBroken(e); return; }
    m.fftSize = f.length;
    micTickNote(m, [t, playing ? 1 : 0]);
    if (playing || R.mainEnd == null) m.quietFrom = null;
    else if (m.quietFrom == null) m.quietFrom = t;
    meterMic(p, st);
    if (m.quietFrom == null) return;
    if (st.done) { micFinish(false); return; }
    if (!st.heard && m.state === 'listening' && t - m.quietFrom > 10) { m.state = 'quiet'; renderStage(); }
  }
  // Grade what was heard (Done, Enter, or the listener deciding the singing has finished).
  function micFinish(manual) {
    const m = R && R.mic;
    if (!m || R.phase !== 'answering' || R.mainEnd == null || m.state === 'off' || m.state === 'paused') return;
    let res;
    try { res = m.L.result(); } catch (e) { micBroken(e); return; }
    m.verdict = res;
    m.take = null;
    micTickNote(m, [A.now(), A.playing() ? 1 : 0, 'g']);
    if (res.v == null && res.reason === 'unclear') {
      // sound was there but not every note could be followed: the learner checks this one
      toast(singBack(R.q) ? 'The app could not follow every note this time. Name the notes on the ladder.' : 'The app could not follow every note this time. Check yourself.', 2600);
      micGiveUp();
      return;
    }
    if (res.v == null) {
      m.nulls++;
      // a second Done with nothing to grade: the learner checks themselves
      if (manual && m.nulls >= 2) { micGiveUp(); return; }
      m.state = 'missed';
      m.reason = res.reason;
      m.lastNull = res;
      micReset(m);
      renderStage();
      return;
    }
    if (singBack(R.q)) {
      // the echo is shown, not scored: naming the notes is the question
      m.result = res; m.state = 'heard'; m.shown = true;
      A.takeStop();
      renderStage();
      return;
    }
    if (R.q.singSemi != null && res.v === 1 && res.notes && res.notes.length) {
      // an interval is a distance, not a pitch class: the right note an octave away is Close
      const n = res.notes[Number.isInteger(res.graded) ? res.graded : res.notes.length - 1];
      if (Math.abs(n.cents / 100 - R.q.singSemi) > 6) { res.v = 0.5; res.reason = 'octave'; }
    }
    m.result = res;
    m.state = 'heard';
    m.shown = false;
    A.takeStop(); // the take ends with the singing; the answer and the sing-along are not part of it
    if (m.kind === 'hold' && res.v > 0 && res.notes && res.notes.length) {
      const n = res.notes[Number.isInteger(res.graded) ? res.graded : res.notes.length - 1];
      const offs = R.micOffs = [...(R.micOffs || []), n.off].slice(-8);
      const mid = offs.slice().sort((a, b) => a - b)[offs.length >> 1];
      if (offs.length >= 6 && Math.abs(mid) > 30 && !R.micBiasShown) { m.bias = mid < 0 ? 'low' : 'high'; R.micBiasShown = true; }
    }
    // the first few rounds with the microphone (after Find Do) are a warm-up and not scored
    m.warmup = !isFindDo(R.q) && !R.q.copy && micRounds() < 3;
    // now and then the learner grades themselves first: their ear against the app's
    R.micGraded = (R.micGraded || 0) + 1;
    m.guessFirst = !!S.settings.guessFirst && !m.warmup && !R.q.copy && !isFindDo(R.q) && R.micGraded % 3 === 0;
    m.guess = null;
    // singing an octave away from where the app plays, time after time: the range setting may be wrong
    const rv = R.q.audio.reveal && R.q.audio.reveal[0];
    const own = !R.q.chordRn && !R.q.bassAnswer && R.q.deg && DEG[R.q.deg].semi <= 7; // Do to Sol: the app plays them above Do, as the learner steps
    if (own && m.kind === 'hold' && res.v > 0 && res.notes && res.notes.length && rv && rv.notes && !R.micRangeTip) {
      const n = res.notes[Number.isInteger(res.graded) ? res.graded : res.notes.length - 1];
      const sung = CUR.voiceTonic(R.q.tonic, S.settings.voice) + n.cents / 100;
      const d = sung - rv.notes[0];
      R.micOct = Math.abs(d) >= 9 ? (R.micOct || 0) + Math.sign(d) : 0;
      if (Math.abs(R.micOct) >= 4) {
        const order = ['low', 'mid', 'high'], i = order.indexOf(S.settings.voice), j = Math.max(0, Math.min(2, i + Math.sign(R.micOct)));
        if (j !== i) { m.rangeTip = { dir: R.micOct > 0 ? 'above' : 'below', to: CUR.VOICE_LABELS[j][1] }; R.micRangeTip = true; }
      }
    }
    R.phase = 'revealed';
    renderStage();
    // the answer plays while the learner sings along; playPart shows the verdict when it ends
    if (!playPart('reveal')) { m.shown = true; renderStage(); }
  }
  // The listener gives up on this question: a sing question goes to its reveal, a dictation echo just leaves.
  function micGiveUp() {
    const m = R.mic;
    m.state = 'off';
    A.takeStop();
    if (R.q.kind === 'sing') singReveal(); else renderStage();
  }
  // The mic stopped hearing: page hidden, audio interrupted (a call, Siri), muted by the system or
  // unplugged. The question waits for a tap, which also lets iOS resume the sound.
  function micPause(why) {
    const m = R && R.mic;
    if (!m || R.phase !== 'answering' || m.state === 'off' || m.state === 'heard' || m.state === 'paused') return;
    m.state = 'paused';
    m.pause = why;
    renderStage();
  }
  function micResume() {
    const m = R && R.mic;
    if (!m || m.state !== 'paused') return;
    A.ensure(); A.wake();
    const go = () => {
      if (!R || R.mic !== m || m.state !== 'paused') return;
      MIC.prefErr = null;
      if (A.micMuted) { m.pause = 'muted'; renderStage(); return; } // still muted: the unmute event resumes it
      micReset(m);
      m.state = 'listening'; m.pause = null; m.quietFrom = null; MIC.lastT = -1;
      if (!MIC.timer) MIC.timer = setInterval(micTick, 20);
      renderStage();
    };
    if (A.micOn) go();
    else A.micOpen().then(go, () => { if (R && R.mic === m) { m.state = 'off'; renderStage(); } });
  }

  // After a miss on a single note: the app plays it and the learner copies it, unscored.
  function singCopy() {
    const q = R && R.q;
    if (!q || q.kind !== 'sing' || R.phase !== 'feedback' || !q.model || !R.mic) return;
    const c = {
      ...q, id: ++R.qid, practice: true, copy: true, keyChanged: false,
      prompt: q.staff ? 'Copy it: follow the notes as they light up and sing along, then sing the melody again on your own.' : 'Copy it: listen, then sing the last note again on your own and hold it.',
      subline: 'A practice round. It does not count.',
      audio: { ...q.audio, main: q.model },
      replays: [{ part: 'main', label: 'Replay', key: 'Space' }],
    };
    R.q = c;
    R.phase = 'answering';
    R.mainEnd = null;
    R.replays = 0;
    R.singMissed = false;
    R.levelUpNow = null;
    micListen(c);
    renderSession();
    playPart('main', 0.1);
  }
  // Close the mic: the Sing set or the session ended.
  function micRelease() {
    if (MIC.timer) { clearInterval(MIC.timer); MIC.timer = null; }
    clapStop();
    if (R) R.mic = null;
    A.micClose();
    A.takeForget();
  }
  function micReset(m) {
    try { m.L.reset(); } catch (e) { /* the next push reports it */ }
    micTickNote(m, [A.now(), A.playing() ? 1 : 0, 'r']);
  }
  // The take's timeline: every frame fed to the listener, each reset ('r') and where the app took its
  // grade ('g'), over the same trailing window as the sound kept.
  function micTickNote(m, tick) {
    m.ticks.push(tick);
    const lo = tick[0] - A.takeSec - 1;
    if (m.ticks[0][0] < lo) m.ticks.splice(0, m.ticks.findIndex((x) => x[0] >= lo));
  }

  // ---------- "Save this take" ----------
  // A misgraded answer is the best test the pitch module can get: its sound, saved as a WAV file
  // with what is needed to hear it again exactly as the app did (js/take.js), and what the learner
  // says the grade should have been. It goes to the learner's own computer, nowhere else; the
  // pitch harness (tone-ladder/pitch-harness/takes.js) replays it.
  const takeHere = () => !!(R && R.mic && R.mic.ticks && R.mic.ticks.length && A.takeHas && typeof TL.Take !== 'undefined');
  function takeSave(expect, said) {
    const m = R && R.mic, q = R && R.q;
    if (!m || !q || !takeHere()) { toast('There is no recording of this answer to save.', 2200); return; }
    const snd = A.takeSound();
    if (!snd || !snd.samples.length) { toast('There is no recording of this answer to save.', 2200); return; }
    const origin = snd.from / snd.rate;
    const rel = (t) => Math.round((t - origin) * 10000) / 10000;
    const lv = TRACK[q.track].levels[q.level];
    const res = m.result || m.verdict || null;
    const info = A.micInfo() || {};
    // frames wholly inside the sound kept (the start was cut when the answer ran past TAKE_SEC)
    const cutTotal = (snd.gaps || []).reduce((a, g) => a + g[1], 0);
    const first = (m.fftSize || 2048) / snd.rate, last = (snd.samples.length + cutTotal) / snd.rate;
    const ticks = m.ticks.map(([t, p, ev]) => (ev ? [rel(t), p, ev] : [rel(t), p])).filter(([t, , ev]) => (ev ? t >= 0 : t >= first) && t <= last + 0.05);
    const cut = m.ticks.some(([t, , ev]) => !ev && rel(t) < first);
    const meta = {
      app: 'Tone Ladder', savedAt: new Date().toISOString(), pitchVersion: TL.Pitch.version,
      fftSize: m.fftSize || 2048,
      question: {
        level: q.level, levelName: lv.name, type: lv.type, kind: m.kind, target: singTarget(q).semis,
        doMidi: q.singRoot != null ? q.singRoot : CUR.voiceTonic(q.tonic, S.settings.voice), tonic: q.tonic, key: q.singRoot != null ? 'none' : TL.keyName(q.tonic, q.mode || 'major'),
        deg: q.deg || q.bassAnswer || q.toneAnswer || null, pattern: q.pattern || q.echoAnswer || null,
        voice: S.settings.voice, practice: !!q.practice, copy: !!q.copy, track: q.track,
      },
      ticks, gaps: snd.gaps || [], cut,
      appGrade: res && {
        v: res.v, reason: res.reason, graded: res.graded, offset: res.offset, drift: res.drift, steps: res.steps,
        notes: (res.notes || []).map((x) => ({ t0: rel(x.t0), t1: rel(x.t1), semi: x.semi, off: Math.round(x.off), clarity: Math.round((x.clarity || 0) * 100) / 100 })),
      },
      learner: { expect, said },
      device: { mic: info.label || '', kind: info.kind || '', settings: info.settings || {}, rate: snd.rate, latency: Math.round(A.latency() * 1000) / 1000, userAgent: navigator.userAgent },
    };
    const bytes = TL.Take.encode(snd.samples, snd.rate, meta);
    const d = new Date(), z = (x) => String(x).padStart(2, '0');
    const slug = lv.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `tone-ladder-take-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${slug}.wav`;
    downloadBytes(bytes, name, 'audio/wav');
    // sent, not saved: the browser may ask first, and the learner may say no
    m.take = { sent: name, expect, said };
    renderStage();
  }
  function downloadBytes(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // this screen's part of the action table (data-act), merged in main.js
  const micActions = {
    micYes: () => micGo(),
    micNo: () => {
      // declining claps or the sing-back turns that feature off; the microphone choice for singing is its own
      if (R && R.micFor === 'rhythm') { S.set('clap', false); toast('Claps are off. Preferences → Clap rhythms turns them on.', 2600); }
      else if (R && R.micFor === 'melody') { S.set('singBack', false); toast('Sing it back first is off. You can turn it on in Preferences.', 2600); }
      else { setMicPref('off'); toast('You can turn the microphone on later in Settings.', 2200); }
      if (R && R.phase === 'mic') nextQuestion();
    },
    micDone: () => micFinish(true),
    micSkipSet,
    micTap: () => { A.ensure(); A.wake(); setTimeout(() => { if (R && R.phase === 'mic' && R.micGate === 'tap') { if (A.running) nextQuestion(); else renderStage(); } }, 200); },
    micContinue: () => { if (R && R.phase === 'mic') nextQuestion(); },
    micResume,
    singCopy,
    takeAsk: (d, el, e) => {
      if (!(R && R.mic)) return;
      R.mic.take = { ask: true };
      renderStage();
      if (e && e.detail === 0) { const b = $('.take-row button[data-act="takeSave"]'); if (b) b.focus(); }
    },
    takeSave: (d) => {
      const m = R && R.mic;
      const v = d.v === '' || d.v == null ? null : +d.v;
      const app = m && m.result ? m.result.v : null;
      const said = d.said || (v == null ? 'unsure' : app == null ? 'self' : v > app ? 'misheard' : v < app ? 'lower' : 'agree');
      takeSave(v, said);
    },
  };

export { MIC, micActions, micAvailable, micFinish, micFramed, micGate, micGo, micListen, micPause, micPermission, micPref, micQuestion, micRelease, micReset, micResume, micRounds, setMicPref, singBack, singTarget, takeHere };
