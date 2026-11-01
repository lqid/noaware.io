/* Tone Ladder — the session runner: sets, questions, keys, playback, scoring, the end of a session. */
import { $, $$, A, CUR, S, TL, TRACK, avg, deviceInfo, flash, pickTimbre, releaseWake, requestWake, safeAudio, setDeviceInfo, sungTrack, toast, tonicForPc } from './base.js';
import { R, app, setR } from './state.js';
import { MIC, micAvailable, micGate, micListen, micPref, micQuestion, micRelease, micReset } from './mic.js';
import { FREE_COUNT, reviewable, savePlanNow } from './plan.js';
import { rhythmEvents, rhythmListen } from './rhythm.js';
import { go, render } from './router.js';
import { renderSession, renderStage } from './session-view.js';

  // ======================================================================
  // SESSION RUNNER
  // ======================================================================
  function startSession(plan, opts = {}) {
    if (S.blocked) { toast('Reload the page first: your progress was saved by a newer version.'); return; }
    if (!safeAudio()) return;
    micRelease();
    A.stop();
    setR({
      plan: plan.map((b) => ({ ...b, done: b.done || 0, done0: b.done || 0, score: 0, sn: 0 })), bi: -1, phase: null, q: null, qid: 0, planDay: opts.day,
      levelUps: [], recent: {}, retry: [], key: null, answered: 0, score: 0, sn: 0,
      started: Date.now(), lastActive: performance.now(), itemsSession: {}, daily: !!opts.daily,
    });
    S.state.sessions = (S.state.sessions || 0) + 1;
    S.setBusy(true);
    S.touch();
    app.view = 'session';
    render();
    requestWake();
    nextBlock();
  }
  const block = () => R.plan[R.bi];
  const levelFor = (b) => (b.level != null ? b.level : S.track(b.track).level);

  function nextBlock() {
    R.bi++;
    // sets already finished earlier today are passed over
    while (R.bi < R.plan.length && (R.plan[R.bi].skipped || R.plan[R.bi].done >= R.plan[R.bi].count)) R.bi++;
    if (R.bi >= R.plan.length) return finishSession();
    const b = block();
    R.retry = [];
    if (!sungTrack(b.track) && !(b.track === 'melody' && S.settings.singBack) && !(b.track === 'rhythm' && S.settings.clap)) micRelease();
    R.micSkip = false; R.micErr = null; R.micGate = null;
    if (b.track === 'mix') { b.tracks = reviewable(); if (!b.tracks.length) { b.skipped = true; savePlanNow(); return nextBlock(); } }
    if (R.played && R.plan.length > 1) { R.phase = 'between'; R.q = null; A.stop(); renderSession(); }
    else { R.played = true; nextQuestion(); }
  }

  function introData(trackId, L, tonic) {
    const st = S.settings;
    return TRACK[trackId].intro(L, { tonic, hints: st.hints, voice: st.voice, context: st.context, cadenceEvery: st.cadenceEvery, keyMode: st.keyMode, labels: st.labels, mic: micAvailable() && !MIC.denied ? micPref() || 'ask' : 'none' });
  }
  function showIntro(trackId, L) {
    const tr = TRACK[trackId];
    let tonic;
    if (tr.usesKey) {
      // take the first question's key now and hold it, so the intro plays in the same key
      const k = nextKey(tr.modeOf ? tr.modeOf(L) : 'major');
      R.key.held = k.changed;
      tonic = k.tonic;
    } else tonic = R.key ? R.key.tonic : tonicForPc(TL.randInt(0, 11));
    if (A.micOn) micRelease();
    R.phase = 'intro';
    R.q = null;
    R.intro = { trackId, L, tonic, reshow: !!S.track(trackId).intro[L], data: introData(trackId, L, tonic) };
    if (trackId === 'sing' && L === 0) R.findDoMisses = 0;
    A.droneStop(0.3);
    renderSession();
    const first = R.intro.data.cards[0];
    const demo = first ? first.demos[0] : R.intro.data.demos[0];
    if (demo) setTimeout(() => { if (R && R.phase === 'intro') A.play(demo.events, { timbre: S.settings.timbre === 'vary' ? 'piano' : S.settings.timbre }); }, 350);
  }

  function pickMixTrack(b) {
    const recent = R.mixRecent || (R.mixRecent = []);
    const entries = b.tracks.map((id) => {
      const days = Math.min(7, S.daysSince(id));
      const m = S.mastery(id);
      let w = (1 + days) * (1.6 - (m.n ? m.acc : 0.6));
      if (recent[recent.length - 1] === id && recent[recent.length - 2] === id) w = 0;
      return [id, w];
    });
    const id = TL.weightedPick(entries) || b.tracks[0];
    recent.push(id);
    return id;
  }

  function nextKey(mode) {
    const s = S.settings;
    if (R.key && R.key.held !== undefined) {
      const changed = R.key.held;
      delete R.key.held;
      if (R.key.mode === mode) return { tonic: R.key.tonic, changed };
    }
    if (s.keyMode === 'fixed') {
      const tonic = tonicForPc(+s.fixedKey || 0);
      const changed = !R.key || R.key.tonic !== tonic || R.key.mode !== mode;
      R.key = { tonic, mode, count: 0 };
      return { tonic, changed };
    }
    let changed = false;
    if (s.keyMode === 'each' || !R.key || R.key.count >= 8 || R.key.mode !== mode) {
      let pc;
      do { pc = TL.randInt(0, 11); } while (R.key && pc === TL.mod12(R.key.tonic));
      R.key = { tonic: tonicForPc(pc), mode, count: 0 };
      changed = true;
    }
    R.key.count++;
    return { tonic: R.key.tonic, changed };
  }

  function takeRetry(trackId, pool) {
    R.retry.forEach((r) => { if (r.track === trackId) r.wait--; });
    const i = R.retry.findIndex((r) => r.track === trackId && r.wait <= 0 && pool.includes(r.item));
    if (i < 0) return null;
    return R.retry.splice(i, 1)[0].item;
  }

  function nextQuestion() {
    const b = block();
    if (!b) return finishSession();
    if (b.done >= b.count) return nextBlock();
    A.stop();
    if (b.track === 'mix') {
      // a track can level up during review; never test a level whose sounds have not been introduced
      b.tracks = b.tracks.filter((id) => S.track(id).intro[S.track(id).level]);
      if (!b.tracks.length) { if (b.done) b.count = b.done; else b.skipped = true; savePlanNow(); return nextBlock(); }
    }
    const trackId = b.track === 'mix' ? pickMixTrack(b) : b.track;
    const tr = TRACK[trackId];
    const t = S.track(trackId);
    const L = b.track === 'mix' ? t.level : levelFor(b);
    const lv = tr.levels[L];
    if (b.track !== 'mix' && !S.introSeen(trackId, L)) return showIntro(trackId, L);
    const sb = b.track === 'melody' && !!S.settings.singBack; // sing-back dictation: in a dictation set, not a mixed review
    const cl = b.track === 'rhythm' && !!S.settings.clap; // clapped rhythms: in a rhythm set
    if ((sungTrack(trackId) || sb || cl) && micGate(trackId)) return;
    const pool = b.pool || lv.items;
    let item;
    if (tr.picksItem) {
      item = takeRetry(trackId, pool) ?? S.chooseItem(trackId, pool, { newItems: b.pool ? [] : lv.introduce || [], recent: R.recent[trackId] || [], levelStats: t.levelStats });
    }
    const mode = tr.modeOf ? tr.modeOf(L) : 'major';
    const findDo = trackId === 'sing' && lv.type === 'degree' && lv.items.length === 1;
    // Find Do moves to a new key every question (the one held from the intro is kept)
    const fade = t.window.length >= 10; // drop the "top note of the last chord" hint once the window is half full
    // a level that hides the key must not open in the key its introduction just named and played
    const hidesKey = lv.key === 'hidden' || (lv.key === 'fade' && fade);
    if (lv.keyEach && hidesKey && R.key && R.key.held !== undefined && S.settings.keyMode !== 'fixed') delete R.key.held;
    if ((findDo || lv.keyEach) && R.key && R.key.held === undefined && S.settings.keyMode !== 'fixed') R.key.count = 8; // and so do the levels that find Do on the staff
    let tonic = 60, keyChanged = false;
    if (tr.usesKey) ({ tonic, changed: keyChanged } = nextKey(mode));
    // no drone under singing: it would sound the answer
    const drone = S.settings.context === 'drone' && tr.usesKey && trackId !== 'harmony' && !sungTrack(trackId);
    const withContext = !drone && (S.settings.cadenceEvery || keyChanged);
    // Find Do practice rounds: the first three ever, two right after its intro, and after two misses in a row
    let practice = false;
    if (findDo && L === 0) {
      const it = S.item('sing', item);
      practice = it.n + (it.p || 0) < 3 || (R.findDoPractice || 0) > 0 || !!S.state.findDoPracticeNext;
      if (practice) {
        R.findDoMisses = 0;
        if (R.findDoPractice) R.findDoPractice--;
        if (S.state.findDoPracticeNext) { S.state.findDoPracticeNext = false; S.touch(); }
      }
    }
    const q = tr.generate(L, { tonic, item, withContext, pool: b.pool, hints: S.settings.hints, voice: S.settings.voice, practice, fade, maxLevel: t.maxLevel, labels: S.settings.labels });
    Object.assign(q, { track: trackId, level: L, item, keyChanged, id: ++R.qid, timbre: pickTimbre(), drone, pooled: !!b.pool, singBack: sb });
    R.q = q;
    R.phase = 'answering';
    R.input = q.kind === 'sequence' ? Array(q.answer.length).fill(null) : [];
    R.cursor = 0;
    R.mainEnd = null;
    R.mainH = null;
    R.replays = 0;
    R.levelUpNow = null;
    R.singMissed = false;
    R.rPhase = null; R.rResult = null; R.rScored = false; R.taps = []; R.staffAlt = false;
    if (micQuestion(q)) micListen(q); else if (A.micOn && !cl) micRelease();
    R.clap = q.kind === 'tap' && cl && A.micOn && !R.micSkip ? { qid: q.id, on: false, floor: 0, leak: 0, last: -1, n: 0 } : null;
    renderSession();
    let lead = 0.08;
    if (drone) {
      if (A.droneTonic !== tonic) { A.droneStart(tonic); lead = 1.5; }
    } else A.droneStop(0.4);
    if (q.kind === 'tap') rhythmListen();
    else playPart('main', lead);
  }

  function playPart(part = 'main', lead) {
    const q = R && R.q;
    if (!q) return null;
    const evs = part === 'main' ? q.audio.main : part === 'reveal' ? q.audio.reveal : q.audio.parts[part];
    if (!evs || !evs.length) return null;
    const revealing = part === 'reveal' || R.phase !== 'answering';
    if (!revealing && R.mic && R.mic.L && (R.mic.state === 'listening' || R.mic.state === 'quiet' || R.mic.state === 'missed')) {
      micReset(R.mic);
      R.mic.quietFrom = null;
      if (R.mic.state !== 'listening') { R.mic.state = 'listening'; renderStage(); }
    }
    setListening(true);
    const h = A.play(evs, { timbre: q.timbre, lead, onEvent: (ev, i) => litEvent(q, ev, i, revealing) });
    if (part === 'main' && R.phase === 'answering') R.replays++;
    const id = q.id;
    R.playH = h;
    if (part === 'main') R.mainH = h;
    h.done.then((ok) => {
      if (!R || !R.q || R.q.id !== id || R.playH !== h) return;
      const m = R.mic;
      if (R.phase === 'revealed' && m && m.state === 'heard' && !m.shown && m.qid === id) { m.shown = true; renderStage(); }
      setListening(false);
      if (part === 'main' && ok && R.mainEnd == null) {
        R.mainEnd = performance.now();
        $$('[data-needs-main]').forEach((el) => (el.disabled = false));
        setListening(false);
      }
    });
    return h;
  }
  // While the mic listens, the app's own sound is "Playing", so the pill never reads as "I hear you".
  function pillLabel(on) {
    const micOn = R && R.mic && R.mic.state !== 'off';
    if (on) return micOn ? 'Playing' : 'Listening';
    if (R && R.phase === 'answering') return R.q && R.q.kind === 'sing' ? 'Your turn: sing' : 'Your turn';
    if (R && R.phase === 'revealed') return micOn && !R.mic.shown ? 'Sing along' : 'Now grade it';
    return 'Ready';
  }
  function setListening(on) {
    const el = $('#listenState');
    if (!el) return;
    el.classList.toggle('idle', !on);
    const label = $('span:last-child', el);
    if (label) label.textContent = pillLabel(on);
  }

  function litEvent(q, ev, i, revealing) {
    const ms = ((ev.dur || 0.4) * 1000) / (S.settings.speed || 1);
    if (ev.slot != null) flash($(`.slot[data-i="${ev.slot}"]`), ms);
    if (ev.staffIdx != null) flash($$('.sight-staff g.note')[ev.staffIdx], ms); // the written note that is sounding
    if (!revealing) return;
    if (q.kind === 'sing') flash($(`.pattern span[data-i="${q.staff ? ev.staffIdx : i}"]`), ms);
    if (ev.deg && ev.notes && q.tonic != null) {
      const s = ev.notes[0] - (q.kind === 'sing' ? CUR.voiceTonic(q.tonic, S.settings.voice) : q.tonic);
      let key = TL.mod12(s);
      if (key === 0 && s > 0 && $('.ladder .rung[data-semi="12"]')) key = 12;
      flash($(`.ladder .rung[data-semi="${key}"]`), ms);
      flash($(`.piano .pkey[data-semi="${s}"]`) || $(`.piano .pkey[data-semi="${TL.mod12(s)}"]`), ms); // the piano has the octave where it shows it
      flash($(`.staff-in .spos[data-semi="${s}"]`) || $(`.staff-in .spos[data-semi="${TL.mod12(s)}"]`) || $(`.staff-in .spos[data-twin-semi="${TL.mod12(s)}"]`), ms);
    }
  }

  // Score one question and advance the learning engine. Practice rounds count toward the set and the day only.
  // early: answered while the question's sound was still playing
  function commit(q, results, rt, confusions, early = false) {
    const b = block();
    const scored = !q.pooled && !q.practice;
    b.played = true;
    S.record({ track: q.track, level: scored ? q.level : -1, items: q.stats, results, rt, confusions, practice: !!q.practice, early });
    // the first answer ends onboarding; a newcomer never needs the 'updated' notice
    if (!S.state.onboarded) { S.state.onboarded = true; S.state.seen.v2 = true; }
    b.done++;
    savePlanNow();
    R.answered++;
    if (!q.practice) {
      const sc = avg(results);
      b.score += sc; b.sn++;
      R.score += sc; R.sn++;
      q.stats.forEach((it, i) => {
        const k = q.track + ':' + it;
        const s = R.itemsSession[k] || (R.itemsSession[k] = { n: 0, c: 0, track: q.track, item: it });
        s.n++; s.c += results[i];
      });
    }
    const rec = R.recent[q.track] || (R.recent[q.track] = []);
    rec.push(q.item ?? q.stats[0]);
    if (rec.length > 6) rec.shift();
    const now = performance.now();
    S.addTime(Math.min(60, (now - R.lastActive) / 1000));
    R.lastActive = now;
    if (scored && q.level === S.track(q.track).level) {
      const before = q.level;
      const up = S.maybeLevelUp(q.track);
      if (up !== null) { R.levelUps.push({ track: q.track, from: before, to: up }); R.levelUpNow = { track: q.track, to: up }; }
      else if (S.track(q.track).complete && !R.completeShown) { R.completeShown = true; R.levelUpNow = { track: q.track, complete: true }; }
    }
    S.touch();
  }
  function queueRetry(q, chosen) {
    R.retry.push({ track: q.track, item: q.item, wait: 3 });
    if (chosen && chosen !== q.item && Math.random() < 0.6) R.retry.push({ track: q.track, item: chosen, wait: 1 });
  }
  function itemFromChoice(q, id) { return q.track === 'intervals' ? id + q.item.slice(-1) : id; }

  function exitSession() {
    if (!R) return go('today');
    if (R.answered === 0) { endRunner(); return go('today'); }
    finishSession(true);
  }
  function finishSession(early = false) {
    micRelease();
    A.stop();
    A.droneStop(0.5);
    releaseWake();
    R.phase = 'summary';
    R.early = early;
    S.setBusy(false);
    keepStorage();
    R.q = null;
    S.save(true);
    renderSession();
  }
  // Ask the browser to keep this site's data: iPhone Safari can otherwise clear it after a week away.
  function keepStorage() {
    if (S.mode === 'cloud' || !navigator.storage || !navigator.storage.persist || deviceInfo().persistAsked) return;
    setDeviceInfo({ persistAsked: Date.now() }); // Firefox shows a prompt, so ask once per device
    navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
  }

  function endRunner() {
    micRelease();
    if (R) { A.stop(); A.droneStop(0.3); releaseWake(); }
    setR(null);
    S.setBusy(false);
  }

  // this screen's part of the action table (data-act), merged in main.js
  const sessionActions = {
    exitSession,
    replay: (d) => { if (R && R.q) { if (d.part === 'reveal') playPart('reveal'); else playPart(d.part); } },
    hear: (d) => {
      const q = R && R.q;
      if (!q) return;
      if (d.what === 'correct') { playPart('reveal'); return; }
      const evs = q.kind === 'sequence' ? q.compare(R.input) : q.compare(R.chosen);
      A.play(evs, { timbre: q.timbre, onEvent: (ev, i) => litEvent(q, ev, i, true) });
    },
    next: () => { if (R && (R.phase === 'feedback' || (R.q && R.q.kind === 'tap' && R.rPhase === 'result'))) nextQuestion(); },
    levelDown: (d) => { const t = S.track(d.track); S.setLevel(d.track, t.level - 1); toast('Back one level. It will open again when you master this one.'); nextQuestion(); },
    startLevel: () => {
      if (!R || R.phase !== 'intro') return;
      const { trackId, L, reshow } = R.intro;
      if (trackId === 'sing' && L === 0) {
        R.findDoPractice = 2;
        const t = S.track('sing');
        if (reshow && t.level === 0) S.resetWindow(t);
      }
      S.markIntro(trackId, L);
      A.stop();
      nextQuestion();
    },
    demo: (d) => {
      if (!R || !R.intro) return;
      const data = R.intro.data;
      const demo = +d.card < 0 ? data.demos[+d.demo] : data.cards[+d.card].demos[+d.demo];
      if (demo) A.play(demo.events, { timbre: S.settings.timbre === 'vary' ? 'piano' : S.settings.timbre });
    },
    introRhythm: (d) => {
      const c = R.intro.data.cards[+d.card];
      const fake = { rhythm: c.rhythm, bpm: c.bpm };
      const { events } = rhythmEvents(fake, true);
      A.play(events, { raw: true });
    },
    continueBlock: () => { if (R && R.phase === 'between') nextQuestion(); },
    skipBlock: () => { if (R && R.phase === 'between') { block().skipped = true; savePlanNow(); nextBlock(); } },
    weakRound: () => {
      const weak = Object.values(R.itemsSession).filter((s) => s.n >= 2 && s.c / s.n < 0.75);
      const byTrack = {};
      weak.forEach((s) => (byTrack[s.track] = (byTrack[s.track] || 0) + 1));
      const tid = Object.entries(byTrack).sort((a, b) => b[1] - a[1])[0][0];
      endRunner();
      startSession([{ track: tid, count: Math.round(FREE_COUNT[tid] * 0.6), role: 'Weak spots' }]);
    },
  };

export { block, commit, endRunner, finishSession, introData, itemFromChoice, levelFor, nextQuestion, pillLabel, playPart, queueRetry, sessionActions, setListening, startSession };
