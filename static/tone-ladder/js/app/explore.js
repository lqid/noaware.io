/* Tone Ladder — Explore. */
import { $, A, DEG, S, TL, esc, flash, rnHue, safeAudio, timbreOptions, tonicForPc } from './base.js';
import { ladderHTML } from './answer-view.js';
import { render } from './router.js';

  // ======================================================================
  // EXPLORE
  // ======================================================================
  // trail: the chords played in Explore; voicings: exactly what was heard, so a replay sounds the same
  const EX = { pc: 0, mode: 'major', timbre: null, prev: null, trail: [], voicings: [], dir: 'a', resolve: true };
  const EX_CHORDS = {
    major: [['Diatonic', ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']], ['Sevenths & inversions', ['V7', 'I6', 'ii6', 'V6']], ['Borrowed from minor', ['iv', '♭III', '♭VI', '♭VII']], ['Secondary dominants', ['V/V', 'V/vi', 'V/ii']]],
    minor: [['Diatonic', ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']], ['Dominant', ['V', 'V7']]],
  };
  const exTonic = () => tonicForPc(EX.pc);
  const exTimbre = () => EX.timbre || (S.settings.timbre === 'vary' ? 'piano' : S.settings.timbre);

  function viewExplore() {
    const opts = TL.DEGREES.map((d) => ({ id: d.id }));
    const keyOpts = TL.KEY_NAMES.map((n, i) => `<option value="${i}" ${i === EX.pc ? 'selected' : ''}>${EX.mode === 'minor' ? TL.MINOR_KEY_NAMES[i] : n}</option>`).join('');
    const tim = timbreOptions(exTimbre()).map(([k, v]) => `<option value="${k}" ${k === exTimbre() ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const groups = EX_CHORDS[EX.mode].map(([name, list]) => `<div class="grp"><span>${esc(name)}</span><div class="chip-row">${list.map((n) => `<button class="rn-btn" data-act="exChord" data-rn="${esc(n)}" style="box-shadow: inset 0 -3px 0 oklch(var(--mark-l) var(--mark-c) ${rnHue(n)})">${esc(n)}</button>`).join('')}</div></div>`).join('');
    const ivBtns = TL.INTERVALS.map((iv) => `<button class="choice" data-act="exInterval" data-iv="${iv.id}" style="min-height:52px"><span class="lbl">${iv.short}</span><span class="sub">${esc(iv.name)}</span></button>`).join('');
    const qBtns = Object.entries(TL.CHORD_TYPES).map(([k, c]) => `<button class="choice" data-act="exQuality" data-q="${k}" style="min-height:52px"><span class="lbl">${esc(c.name)}</span><span class="sub">${esc(TL.KEY_NAMES[EX.pc] + c.sym)}</span></button>`).join('');
    return `<div>
      <div class="page-head"><p class="eyebrow">Sandbox</p><h1>Explore</h1><p class="lede">Listen freely and try ideas. Everything plays in the key you choose, so you can hear how each note and chord behaves in the key.</p></div>
      <div class="ex-controls">
        <label class="field">Key<select id="exKey" data-change="exKey">${keyOpts}</select></label>
        <div class="field">Mode<div class="seg" role="group" aria-label="Mode"><button data-act="exMode" data-mode="major" aria-pressed="${EX.mode === 'major'}">Major</button><button data-act="exMode" data-mode="minor" aria-pressed="${EX.mode === 'minor'}">Minor</button></div></div>
        <label class="field">Instrument<select id="exTimbre" data-change="exTimbre">${tim}</select></label>
        <div class="row" style="margin-left:auto"><button class="btn" data-act="exCadence">Play the four chords</button><button class="btn" data-act="exDrone" aria-pressed="${A.droneTonic != null}">${A.droneTonic != null ? 'Stop the drone' : 'Hold Do (drone)'}</button></div>
      </div>
      <div class="ex-grid">
        <section class="ex-sec">
          <h2>Scale degrees</h2>
          <p>Choose a note to hear it. With “Walk home to Do” on, it steps back to Do, so you hear its pull.</p>
          <label class="check"><input type="checkbox" id="exResolve" data-change="exResolve" ${EX.resolve ? 'checked' : ''}> Walk home to Do</label>
          ${ladderHTML(opts, EX.mode, 'exNote', { noKeys: true })}
          <p class="muted" style="font-size:13px">Tip: turn on the drone and sing each degree against it. Notice which ones feel stable and which ones lean.</p>
        </section>
        <div>
          <section class="ex-sec">
            <h2>Chords in the key</h2>
            <p>Voices move as little as possible from the last chord you played, so you can sketch progressions and hear the voice leading.</p>
            <div class="chord-groups">${groups}</div>
            <div class="row"><span class="trail" id="exTrail">${EX.trail.length ? esc(EX.trail.join(' → ')) : '<span class="muted" style="font-family:var(--f-body);font-size:14px">Your progression appears here.</span>'}</span></div>
            <div class="row"><button class="btn sm" data-act="exReplayTrail" ${EX.trail.length ? '' : 'disabled'}>Play progression</button><button class="btn sm ghost" data-act="exResetTrail">Clear</button></div>
          </section>
          <section class="ex-sec">
            <h2>Intervals from Do</h2>
            <div class="seg" role="group" aria-label="Direction">${[['a', 'Up'], ['d', 'Down'], ['h', 'Together']].map(([d, l]) => `<button data-act="exDir" data-dir="${d}" aria-pressed="${EX.dir === d}">${l}</button>`).join('')}</div>
            <div class="choices">${ivBtns}</div>
          </section>
          <section class="ex-sec">
            <h2>Chord qualities on Do</h2>
            <div class="choices">${qBtns}</div>
          </section>
        </div>
      </div>
    </div>`;
  }
  function exNote(id, semi) {
    if (!safeAudio()) return;
    const t = exTonic();
    if (!Number.isFinite(semi)) semi = DEG[id].semi;
    const evs = EX.resolve
      ? TL.resolutionPath(semi, EX.mode).map((s, i, arr) => ({ t: i === 0 ? 0 : 0.7 + (i - 1) * 0.42, notes: [t + s], dur: i === 0 ? 0.7 : i === arr.length - 1 ? 1.1 : 0.4, vel: 0.72, deg: TL.degBySemi(s).id }))
      : [{ t: 0, notes: [t + semi], dur: 1.2, vel: 0.72, deg: id }];
    A.play(evs, { timbre: exTimbre(), onEvent: (ev) => {
      const s = ev.notes[0] - t;
      let key = TL.mod12(s); if (key === 0 && s > 0) key = 12;
      flash($(`.ladder .rung[data-semi="${key}"]`), ev.dur * 1000 / S.settings.speed);
    } });
  }
  function exChord(name) {
    if (!safeAudio()) return;
    const t = exTonic();
    const v = TL.voiceChord(TL.rnPcs(name), TL.rnBassPc(name), t, EX.prev);
    EX.prev = v;
    EX.trail.push(name);
    EX.voicings.push(v);
    if (EX.trail.length > 10) { EX.trail.shift(); EX.voicings.shift(); }
    A.play([{ t: 0, notes: v, dur: 1.6, vel: 0.62 }], { timbre: exTimbre() });
    const tr = $('#exTrail');
    if (tr) tr.textContent = EX.trail.join(' → ');
    const btn = $('[data-act="exReplayTrail"]');
    if (btn) btn.disabled = false;
  }

  // this screen's part of the action table (data-act), merged in main.js
  const exploreActions = {
    exMode: (d) => { EX.mode = d.mode; EX.prev = null; EX.trail = []; EX.voicings = []; render(); },
    exNote: (d) => exNote(d.id, +d.semi),
    exChord: (d) => exChord(d.rn),
    exCadence: () => { if (safeAudio()) A.play(TL.cadenceEvents(exTonic(), EX.mode), { timbre: exTimbre() }); },
    exDrone: () => { if (!safeAudio()) return; if (A.droneTonic != null) A.droneStop(); else A.droneStart(exTonic()); render(); },
    exDir: (d) => { EX.dir = d.dir; render(); },
    exInterval: (d) => {
      if (!safeAudio()) return;
      const t = exTonic(), semi = TL.IV[d.iv].semi;
      const evs = EX.dir === 'a' ? [{ t: 0, notes: [t], dur: 0.8 }, { t: 0.8, notes: [t + semi], dur: 1.1 }]
        : EX.dir === 'd' ? [{ t: 0, notes: [t + 12], dur: 0.8 }, { t: 0.8, notes: [t + 12 - semi], dur: 1.1 }]
          : [{ t: 0, notes: [t, t + semi], dur: 1.6 }];
      A.play(evs.map((e) => ({ ...e, vel: 0.72 })), { timbre: exTimbre() });
    },
    exQuality: (d) => { if (safeAudio()) A.play([{ t: 0, notes: TL.chordVoicing(exTonic(), d.q), dur: 1.7, vel: 0.62 }], { timbre: exTimbre() }); },
    exReplayTrail: () => {
      if (!safeAudio() || !EX.voicings.length) return;
      const v = EX.voicings;
      A.play(v.map((notes, i) => ({ t: i * 1.0, notes, dur: i === v.length - 1 ? 1.6 : 0.94, vel: 0.62 })), { timbre: exTimbre() });
    },
    exResetTrail: () => { EX.trail = []; EX.voicings = []; EX.prev = null; render(); },
  };

export { EX, EX_CHORDS, exTonic, exploreActions, viewExplore };
