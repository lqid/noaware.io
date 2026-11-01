/* Tone Ladder — rhythm questions: timing, tapping, clapping, and their rendering. */
import { $, $$, A, S, TL, avg, esc } from './base.js';
import { R } from './state.js';
import { levelUpHTML, rhythmStaff } from './answer-view.js';
import { MIC } from './mic.js';
import { commit } from './session.js';

  // ---------- answering: rhythm ----------
  function rhythmTimes(q) {
    const r = q.rhythm;
    const bpm = q.bpm * (S.settings.speed || 1);
    const beatSec = 60 / bpm;
    const tickSec = beatSec / (r.meter === '6/8' ? 18 : 12);
    const clickTicks = r.meter === '6/8' ? 6 : 12;
    return { beatSec, tickSec, barSec: r.barTicks * tickSec, clickTicks, clicksPerBar: r.barTicks / clickTicks };
  }
  const isAccent = (r, i) => (r.meter === '6/8' ? i % 3 === 0 : r.meter === '5/4' ? i === 0 || i === 3 : i === 0);
  function rhythmEvents(q, withPattern) {
    const r = q.rhythm;
    const { tickSec, barSec, clickTicks, clicksPerBar } = rhythmTimes(q);
    const ev = [];
    for (let i = 0; i < clicksPerBar; i++) ev.push({ t: i * clickTicks * tickSec, perc: isAccent(r, i) ? 'accent' : 'click', dur: 0.05, vel: 1, countIn: i });
    const T0 = barSec;
    for (let b = 0; b < r.bars; b++) for (let i = 0; i < clicksPerBar; i++) {
      ev.push({ t: T0 + b * barSec + i * clickTicks * tickSec, perc: isAccent(r, i) ? 'accent' : 'click', dur: 0.05, vel: withPattern ? 0.45 : 0.8, beat: b * clicksPerBar + i });
    }
    if (withPattern) for (const o of TL.rhythmOnsets(r)) ev.push({ t: T0 + o.tick * tickSec, perc: 'wood', dur: o.len * tickSec, vel: 1 });
    ev.sort((a, b) => a.t - b.t);
    return { events: ev, T0, end: T0 + r.bars * barSec };
  }
  function beatLight(ev) {
    const r = R.q.rhythm;
    const per = r.barTicks / (r.meter === '6/8' ? 6 : 12);
    const idx = ev.countIn != null ? ev.countIn : ev.beat != null ? ev.beat % per : null;
    if (idx == null) return;
    const dots = $$('.beats i');
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    const lab = $('.beats .lab');
    if (lab) lab.textContent = ev.countIn != null ? `get ready ${idx + 1}` : r.bars > 1 ? 'bar ' + (Math.floor(ev.beat / per) + 1) : '';
  }
  function rhythmListen() {
    const q = R.q;
    R.rPhase = 'listening';
    renderRhythmState();
    const { events } = rhythmEvents(q, true);
    const h = A.play(events, { raw: true, onEvent: beatLight });
    const id = q.id;
    h.done.then((ok) => {
      if (!ok || !R || !R.q || R.q.id !== id || R.rPhase !== 'listening') return;
      R.rPhase = R.rResult ? 'result' : 'ready';
      renderRhythmState();
    });
  }
  function rhythmGo() {
    const q = R && R.q;
    if (!q || q.kind !== 'tap' || R.rPhase === 'countin' || R.rPhase === 'tapping') return;
    R.rPhase = 'countin';
    R.taps = []; R.clapped = false;
    clapStart();
    renderRhythmState();
    const { events, T0, end } = rhythmEvents(q, false);
    const h = A.play(events, {
      raw: true,
      onEvent: (ev) => {
        beatLight(ev);
        if (ev.beat === 0 && R.rPhase === 'countin') { R.rPhase = 'tapping'; renderRhythmState(); }
      },
    });
    R.rT0 = h.t0 + T0;
    R.rEnd = h.t0 + end;
    if (R.clap) R.clap.clicks = events.filter((e) => e.countIn != null).map((e) => h.t0 + e.t);
    const id = q.id;
    const wait = (R.rEnd - A.now() + A.latency() + 0.35) * 1000;
    setTimeout(() => { if (R && R.q && R.q.id === id && (R.rPhase === 'tapping' || R.rPhase === 'countin')) evaluateTaps(); }, wait);
  }
  // ---------- clapping ----------
  // A clap is a sudden, broadband burst: the newest few milliseconds of the microphone frame jump
  // well above both the room and the app's own clicks, whose loudness at the mic is measured during
  // the count-in (the learner is told not to clap then). A clap counts like a tap at its moment.
  function clapStart() {
    const c = R && R.clap;
    if (!c) return;
    if (!A.micOn) { R.clap = null; return; } // the mic went away (a hidden tab closes it): back to tapping, and the copy says so
    Object.assign(c, { on: true, floor: 0, leak: 0, last: -1, n: 0 });
    if (!MIC.clapTimer) MIC.clapTimer = setInterval(clapTick, 10);
  }
  function clapStop() {
    if (MIC.clapTimer) { clearInterval(MIC.clapTimer); MIC.clapTimer = null; }
    if (R && R.clap) R.clap.on = false;
  }
  function clapTick() {
    const c = R && R.clap, q = R && R.q;
    if (!c || !c.on || !q || q.id !== c.qid) { clapStop(); return; }
    if (!A.micOn) { clapStop(); R.clap = null; renderRhythmState(); return; } // the mic went away: back to tapping, and the copy says so
    if (!A.running) return; // a paused clock comes back
    if (R.rPhase !== 'countin' && R.rPhase !== 'tapping') return;
    const f = A.micFrame();
    if (!f) return;
    const sr = A.micRate(), now = A.now();
    const nNew = Math.max(64, Math.round(sr * 0.012));
    let eNew = 0, eOld = 0;
    for (let i = f.length - nNew; i < f.length; i++) eNew += f[i] * f[i];
    for (let i = 0; i < f.length - nNew; i++) eOld += f[i] * f[i];
    eNew = Math.sqrt(eNew / nNew); eOld = Math.sqrt(eOld / Math.max(1, f.length - nNew));
    c.floor = c.floor ? Math.min(eNew, c.floor * 1.01) : eNew;
    // The burst began somewhere in the newest window, up to a poll ago. A clap answers a click the
    // learner heard, which left the speakers A.latency() after it was rendered, and the microphone
    // hears a little late itself: taken off, the clap sits on the schedule clock like a tap does.
    const at = now - nNew / sr - 0.005 - A.latency() - A.inLatency();
    // The count-in measures the app's own clicks at the microphone, by time rather than by phase: a
    // clap a little ahead of the first note is a tap (evaluateTaps allows the same margin), not a
    // click. Only the clicks themselves count: a chair, a word or a stray clap between them must not
    // raise the bar for the whole question.
    if (R.rT0 == null || at < R.rT0 - 0.35 * rhythmTimes(q).beatSec) {
      if ((c.clicks || []).some((t) => at > t - 0.08 && at < t + 0.2)) c.leak = Math.max(c.leak, eNew);
      return;
    }
    const thr = Math.max(c.leak * 2.5, c.floor * 8, 0.004);
    if (eNew > thr && eNew > eOld * 2.5 && now - c.last > 0.1) { c.last = now; c.n++; onClap(at); }
  }
  function onClap(t) {
    if (!R || !R.q || R.q.kind !== 'tap' || (R.rPhase !== 'countin' && R.rPhase !== 'tapping')) return;
    R.taps.push(t); R.clapped = true;
    const pad = $('#tapPad');
    if (pad) { pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 90); }
  }
  const safeTs = (ts) => (ts > 0 && ts <= performance.now() + 50 ? ts : performance.now());
  function onTap(ts) {
    if (!R || !R.q || R.q.kind !== 'tap') return false;
    if (R.rPhase !== 'countin' && R.rPhase !== 'tapping') return false;
    R.taps.push(A.heardTime(safeTs(ts)) - (S.settings.tapOffsetMs || 0) / 1000);
    const pad = $('#tapPad');
    if (pad) { pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 90); }
    return true;
  }
  function evaluateTaps() {
    const q = R.q;
    clapStop();
    const { tickSec, beatSec } = rhythmTimes(q);
    const ons = TL.rhythmOnsets(q.rhythm).map((o) => ({ ...o, t: R.rT0 + o.tick * tickSec }));
    let minGap = Infinity;
    for (let i = 1; i < ons.length; i++) minGap = Math.min(minGap, ons[i].t - ons[i - 1].t);
    const tol = Math.max(0.06, Math.min(0.13, (isFinite(minGap) ? minGap : 1) * 0.45, beatSec * 0.22));
    const taps = R.taps.filter((t) => t >= R.rT0 - 0.35 * beatSec && t <= R.rEnd + 0.12).sort((a, b) => a - b);
    const used = new Set();
    const res = ons.map((o) => {
      let best = -1, bd = Infinity;
      taps.forEach((t, i) => { if (used.has(i)) return; const d = Math.abs(t - o.t); if (d < bd) { bd = d; best = i; } });
      if (best >= 0 && bd <= tol) { used.add(best); return { ...o, hit: true, err: taps[best] - o.t, tap: taps[best] }; }
      return { ...o, hit: false };
    });
    const hits = res.filter((x) => x.hit).length;
    const pass = hits === ons.length && taps.length === used.size;
    // A tap just outside the window belongs to its note: report it as early or late, not as a miss plus an extra.
    res.forEach((o, i) => {
      if (o.hit) return;
      const gaps = [i > 0 ? o.t - res[i - 1].t : beatSec, i < res.length - 1 ? res[i + 1].t - o.t : beatSec];
      const win = Math.min(0.5 * Math.min(...gaps), 0.5 * beatSec);
      let best = -1, bd = Infinity;
      taps.forEach((t, k) => { if (used.has(k)) return; const d = Math.abs(t - o.t); if (d < bd) { bd = d; best = k; } });
      if (best >= 0 && bd <= win) { used.add(best); o.off = taps[best] - o.t; o.tap = taps[best]; }
    });
    const extras = taps.filter((t, i) => !used.has(i));
    const errs = res.filter((x) => x.hit).map((x) => x.err * 1000);
    R.rResult = { res, extras, pass, mean: avg(errs), hits, n: ons.length, tol, offTaps: res.filter((o) => o.off != null) };
    if (!R.rScored) { R.rScored = true; commit(q, q.stats.map(() => (pass ? 1 : 0)), 0, []); }
    R.rPhase = 'result';
    renderRhythmState();
  }

  // ----- rhythm -----
  function rhythmHTML() {
    const q = R.q;
    const r = q.rhythm;
    const per = r.barTicks / (r.meter === '6/8' ? 6 : 12);
    const dots = Array.from({ length: per }, (_, i) => `<i class="${isAccent(r, i) ? 'down' : ''}"></i>`).join('');
    return `<div class="q-body">
      <div class="rhythm">
        <div class="beats" aria-hidden="true">${dots}<span class="lab"></span></div>
        <p class="r-status" id="rStatus"></p>
        <button class="tap-pad" id="tapPad" type="button" aria-label="Tap">Tap<small>or press Space</small></button>
        <div class="row" id="rActions"></div>
      </div>
      <div id="fb"><div class="fb" id="rPanel"></div></div>
    </div>`;
  }
  function renderRhythmState() {
    const q = R && R.q;
    if (!q || q.kind !== 'tap') return;
    const st = $('#rStatus'), actions = $('#rActions'), panel = $('#rPanel'), pad = $('#tapPad');
    if (!st) return;
    const ph = R.rPhase;
    const n = rhythmTimes(q).clicksPerBar;
    const counting = Array.from({ length: n }, (_, i) => i + 1).join(', ');
    st.textContent = {
      listening: `Listen. ${n} clicks set the beat, then the rhythm plays over the clicks.`,
      ready: R.clap ? `Your turn. Press Start. Stay quiet through the ${n} get-ready clicks (the app measures the room then), and clap or tap from the very next click.` : `Your turn. Press Start. After ${n} get-ready clicks, start tapping on the very next click.`,
      countin: R.clap ? `Get ready. Count silently: ${counting}. Clap or tap from the next 1.` : `Get ready. Count along: ${counting}. Start tapping on the next 1.`,
      tapping: R.clap ? 'Clap or tap where each note starts.' : 'Tap where each note starts.',
      result: R.rResult && R.rResult.pass ? 'In time. Well done.' : 'Not quite. See where the taps landed.',
    }[ph] || '';
    pad.disabled = !(ph === 'ready' || ph === 'countin' || ph === 'tapping');
    pad.classList.toggle('live', ph === 'tapping');
    pad.innerHTML = ph === 'ready' ? `Start<small>${n} get-ready clicks, then ${R.clap ? 'clap or tap' : 'tap'}</small>` : R.clap ? (ph === 'countin' ? 'Wait<small>clap or tap from the next 1</small>' : 'Tap<small>or clap, or press Space</small>') : 'Tap<small>or press Space</small>';
    const listenBtn = `<button class="btn" data-act="rListen" ${ph === 'countin' || ph === 'tapping' || ph === 'listening' ? 'disabled' : ''}>Listen again</button>`;
    if (ph === 'result') {
      actions.innerHTML = `<button class="btn" data-act="rGo">Try again (practice)</button>${listenBtn}<button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button>`;
    } else {
      actions.innerHTML = `<button class="btn primary" data-act="rGo" ${ph === 'ready' ? '' : 'disabled'}>Start <kbd>Enter</kbd></button>${listenBtn}`;
    }
    if (ph === 'result') {
      const res = R.rResult;
      const late = res.offTaps.filter((o) => o.off > 0).length, early = res.offTaps.length - late;
      const missed = res.n - res.hits - res.offTaps.length;
      const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      const lines = [`${res.hits} of ${res.n} notes in time.`];
      if (late) lines.push(plural(late, 'tap was too late.', 'taps were too late.'));
      if (early) lines.push(plural(early, 'tap was too early.', 'taps were too early.'));
      if (missed) lines.push(missed === 1 ? '1 note missed: no tap near it.' : `${missed} notes missed: no tap near them.`);
      if (res.extras.length) lines.push(res.extras.length === 1 ? '1 extra tap where there was no note.' : `${res.extras.length} extra taps where there were no notes.`);
      lines.push(`A tap counts as in time if it lands within ${Math.round(res.tol * 1000)} ms of the note.`);
      if (res.hits) lines.push(Math.abs(res.mean) < 15 ? (res.pass ? 'Your timing was right on the beat.' : 'The taps that landed in time were right on the beat.') : `On average your in-time taps were ${Math.abs(Math.round(res.mean))} ms ${res.mean >= 0 ? 'late' : 'early'}.`);
      const offs = [...res.res.filter((o) => o.hit).map((o) => o.err), ...res.offTaps.map((o) => o.off)];
      const clapped = !!R.clapped; // the Calibrate tip is about taps: it does not move claps
      const steadyLate = !clapped && offs.length >= 3 && offs.every((x) => x > 0.04) && Math.max(...offs) - Math.min(...offs) < 0.08;
      panel.className = 'fb ' + (res.pass ? 'good' : 'bad');
      panel.innerHTML = `<p class="verdict">${res.pass ? 'Correct' : 'Not quite'}</p>
        <p class="explain">${esc(lines.join(' '))}</p>
        ${steadyLate ? '<p class="tip">Your taps land late by about the same amount every time. With Bluetooth headphones or a touch screen, that is usually the device’s delay. Open Preferences, Rhythm timing, and press Calibrate.</p>' : ''}
        ${rhythmStaff(q.rhythm)}
        ${rhythmSVG(q, res)}
        <div class="legend"><span><i style="background:var(--good)"></i>a note you tapped in time</span><span><i style="background:var(--bad)"></i>a note you missed</span><span><i style="background:var(--ink-2);height:3px"></i>your tap</span><span><i style="background:var(--bad);height:3px"></i>a tap off its note</span><span><i style="background:transparent;border:1.5px dashed var(--muted)"></i>rest</span></div>
        <p class="muted" style="font-size:12.5px">A block’s length shows how long the note lasts.</p>
        ${R.rScored && !res.pass ? '<p class="tip muted">Only your first attempt is scored. “Try again” is practice.</p>' : ''}
        ${levelUpHTML()}`;
    } else {
      panel.className = 'fb';
      const countWords = { '6/8': 'Count 1 to 6 with the clicks.', '3/4': 'Count 1 2 3 with the clicks.', '5/4': 'Count 1 2 3, 4 5 with the clicks: a group of three, then two.' }[q.rhythm.meter] || 'Count 1 2 3 4 with the clicks.';
      panel.innerHTML = `<p class="eyebrow">How to listen</p><p class="tip">${countWords} ${R.clap ? 'Clap or tap once where each note starts. A long note still gets only one clap. Stay quiet through the get-ready clicks.' : 'Tap once where each note starts. A long note still gets only one tap.'} Do not tap on a rest, which is a silence. You see the pattern after you try.</p>${rhythmSVG(q, null)}`;
    }
  }
  function rhythmSVG(q, res) {
    const r = q.rhythm;
    const total = r.barTicks * r.bars;
    const W = window.innerWidth < 520 ? 340 : 640, padX = 14, H = res ? 112 : 46;
    const x = (tick) => padX + (tick / total) * (W - 2 * padX);
    const step = r.meter === '6/8' ? 6 : 12;
    const parts = [];
    for (let tk = 0; tk <= total; tk += step) {
      const bar = tk % r.barTicks === 0;
      parts.push(`<line x1="${x(tk)}" x2="${x(tk)}" y1="6" y2="${H - 18}" stroke="${bar ? 'var(--ink-2)' : 'var(--line)'}" stroke-width="${bar ? 1.5 : 1}"/>`);
      if (tk < total) parts.push(`<text x="${x(tk) + 3}" y="${H - 5}">${esc(TL.countLabel(tk, r))}</text>`);
    }
    if (res) {
      const { tickSec } = rhythmTimes(q);
      const tapLine = (t, color) => {
        const tick = (t - R.rT0) / tickSec;
        if (tick < -2 || tick > total + 2) return;
        const tx = x(Math.max(0, Math.min(total, tick)));
        parts.push(`<line x1="${tx}" x2="${tx}" y1="48" y2="74" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`);
      };
      let pos = 0;
      for (const t of r.ticks) {
        if (t < 0) parts.push(`<rect x="${x(pos) + 1}" y="14" width="${Math.max(4, x(pos - t) - x(pos) - 3)}" height="16" rx="3" fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="3 3"/>`);
        pos += Math.abs(t);
      }
      res.res.forEach((o) => {
        const w = Math.max(4, x(o.tick + o.len) - x(o.tick) - 3);
        parts.push(`<rect x="${x(o.tick) + 1}" y="14" width="${w}" height="16" rx="3" fill="${o.hit ? 'var(--good)' : 'var(--bad)'}" opacity="0.88"/>`);
        if (o.tick % step) parts.push(`<text x="${x(o.tick) + 3}" y="${H - 5}">${esc(TL.countLabel(o.tick, r))}</text>`);
        if (o.hit) tapLine(o.tap, 'var(--ink-2)');
        else if (o.off != null) tapLine(o.tap, 'var(--bad)');
      });
      res.extras.forEach((t) => tapLine(t, 'var(--bad)'));
      parts.push(`<text x="${padX}" y="42">notes</text><text x="${padX}" y="88">your taps</text>`);
    }
    return `<div class="tbl-wrap"><svg class="rgrid" viewBox="0 0 ${W} ${H}" role="img" aria-label="${res ? 'Rhythm with your taps' : 'Empty bar grid'}">${parts.join('')}</svg></div>`;
  }

  // this screen's part of the action table (data-act), merged in main.js
  const rhythmActions = {
    rListen: () => { if (R && R.q && R.q.kind === 'tap' && R.rPhase !== 'countin' && R.rPhase !== 'tapping') rhythmListen(); },
    rGo: () => rhythmGo(),
  };

export { clapStop, onTap, renderRhythmState, rhythmActions, rhythmEvents, rhythmGo, rhythmHTML, rhythmListen, safeTs };
