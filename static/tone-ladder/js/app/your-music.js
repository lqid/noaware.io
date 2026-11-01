/* Tone Ladder — the Music view: a recording of the learner's own. */
import { $, A, DEG, TL, degText, esc, pickTimbre, rnHue, toast, tonicForPc } from './base.js';
import { R, app } from './state.js';
import { EX_CHORDS } from './explore.js';
import { micAvailable } from './mic.js';
import { render } from './router.js';

  // ---------- your music ----------
  // A recording of the learner's own: looped, slowed, with Do held under it and the chords marked.
  // The player and the analysis live in TL.Music; this is the page over them. Everything stays on
  // the device: the file in memory for the visit, what was marked in localStorage.
  const PL = TL.Music ? TL.Music.player : null;
  const MU = { fp: null, entry: null, an: null, analysing: false, progress: 0, gen: 0, key: null, mode: 'major', cands: null, hum: null, mark: null, droneOn: false, drone: 1.5, tooLong: false, decodeErr: '', resume: false };
  // the hum's result names the note in the mode chosen now, which the learner may change after
  const muHumText = () => (!MU.hum ? '' : MU.hum.state === 'done' ? `You hummed ${(muMode() === 'minor' ? TL.MINOR_KEY_NAMES : TL.KEY_NAMES)[MU.hum.pc]}. Major or minor is your call: pick one and hold the drone.` : MU.hum.text || '');
  const muKeyName = (k) => (k ? (k.mode === 'minor' ? TL.MINOR_KEY_NAMES[k.pc] + ' minor' : TL.KEY_NAMES[k.pc] + ' major') : '');
  const muTonic = () => (MU.key ? tonicForPc(MU.key.pc) : null);
  const muMode = () => (MU.key ? MU.key.mode : MU.mode);
  const muSave = () => {
    if (!MU.fp || !PL) return;
    const st = PL.state();
    MU.entry = TL.Music.files.put(MU.fp, { name: st.name, dur: st.duration, key: MU.key, loop: st.loop, speed: st.rate, drone: MU.drone, marks: MU.entry ? MU.entry.marks : [] });
  };
  async function musicOpen(file) {
    if (!file || !PL) return;
    const gen = ++MU.gen; // a later open supersedes this one at any point
    Object.assign(MU, { an: null, analysing: false, progress: 0, cands: null, hum: null, mark: null, tooLong: '', decodeErr: '', resume: false });
    A.droneStop(0.3); MU.droneOn = false;
    const st = await PL.open(file);
    if (gen !== MU.gen) return;
    MU.fp = TL.Music.fingerprint(file, st.duration);
    MU.entry = TL.Music.files.get(MU.fp) || TL.Music.files.put(MU.fp, { name: file.name, dur: st.duration, marks: [] });
    MU.key = MU.entry.key; MU.mode = MU.key ? MU.key.mode : 'major'; MU.drone = MU.entry.drone;
    if (MU.entry.loop) PL.setLoop(MU.entry.loop[0], MU.entry.loop[1]);
    PL.setRate(MU.entry.speed || 1);
    if (app.view === 'music') render();
    if (st.error) return;
    // looping and slowing still work on anything; the picture and Find Do need the whole file decoded
    if (st.duration > 20 * 60 || file.size > 150e6) { MU.tooLong = st.duration > 20 * 60 ? 'Longer than twenty minutes' : 'Larger than 150 MB'; if (app.view === 'music') render(); return; }
    MU.analysing = true; renderMusicState();
    try {
      const src = await TL.Music.decode(file);
      if (gen !== MU.gen) return;
      const an = await TL.Music.analyse(src, { onProgress: (p) => { MU.progress = p; renderMusicState(); }, cancelled: () => gen !== MU.gen });
      if (gen !== MU.gen) return;
      MU.an = an;
    } catch (e) { if (gen === MU.gen) MU.decodeErr = e.message; }
    if (gen !== MU.gen) return;
    MU.analysing = false;
    if (app.view !== 'music') return; // the read may finish while another view is up
    // someone typing in a mark keeps the caret: only the picture and the check button change
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('.music input[type="text"]')) {
      musicAfterRender();
      const b = $('[data-act="muCheck"]');
      if (b && MU.an) { b.disabled = false; if (b.nextElementSibling) b.nextElementSibling.remove(); }
    } else render();
  }
  function musicLeave() {
    if (!PL) return;
    PL.pause();
    A.droneStop(0.3); MU.droneOn = false;
    MU.hum = null; MU.resume = false;
  }
  // the picture of the file, from the analysis's peaks, drawn whenever the view is built
  function musicAfterRender() {
    const c = $('#muCanvas');
    if (c && MU.an) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = getComputedStyle(c).color; g.globalAlpha = 0.55;
      const n = MU.an.columns, pk = MU.an.peaks;
      for (let i = 0; i < n; i++) { const x = (i / n) * w, lo = pk[2 * i], hi = pk[2 * i + 1]; g.fillRect(x, h / 2 - hi * h * 0.48, Math.max(1, w / n), (hi - lo) * h * 0.48 + 1); }
    }
    renderMusicState();
  }
  // the parts that move: time, the playhead, the loop, the Play button, the analysis progress
  function renderMusicState() {
    if (!PL || app.view !== 'music') return;
    const st = PL.state(), M = TL.Music.mmss;
    const t = $('#muTime'); if (t) t.textContent = st.file ? `${M(st.time)} / ${M(st.duration)}` : '';
    const p = $('#muPlay'); if (p) p.innerHTML = `${st.playing ? 'Pause' : 'Play'} <kbd>Space</kbd>`;
    const head = $('#muHead'); if (head && st.duration) head.style.left = `${((st.time / st.duration) * 100).toFixed(2)}%`;
    const shade = $('#muShade'); if (shade) { if (st.loop && st.duration) { shade.style.display = ''; shade.style.left = `${((st.loop[0] / st.duration) * 100).toFixed(2)}%`; shade.style.width = `${(((st.loop[1] - st.loop[0]) / st.duration) * 100).toFixed(2)}%`; } else shade.style.display = 'none'; }
    const lp = $('#muLoopText'); if (lp) lp.textContent = st.loop ? `Loop ${M(st.loop[0])} – ${M(st.loop[1])}` : 'No loop: press Loop from here at the start of a passage and to here at its end.';
    const pr = $('#muProgress'); if (pr) pr.textContent = MU.analysing ? `Reading the file for the picture and Find Do… ${Math.round(MU.progress * 100)}%` : '';
    const rv = $('#muRateVal'); if (rv) rv.textContent = `${Math.round(st.rate * 100)}%`;
    const hm = $('#muHum'); if (hm && MU.hum) hm.textContent = MU.hum.state === 'opening' ? 'Opening the microphone…' : MU.hum.state === 'listening' ? 'Listening. Hum home and hold it…' : muHumText();
    const err = $('#muErr'); if (err) err.textContent = st.error || MU.decodeErr || '';
  }
  // hum home for two seconds: the app names the note; major or minor stays the learner's call
  async function musicHum() {
    if (!micAvailable() || !PL || (MU.hum && (MU.hum.state === 'opening' || MU.hum.state === 'listening'))) return;
    MU.hum = { state: 'opening' }; renderMusicState();
    const gen = MU.gen;
    // in silence: the speaker sits next to the microphone. The four chords stop too, and the
    // recording they were going to bring back comes back after the hum instead.
    const was = PL.state().playing || MU.resume;
    MU.resume = false;
    A.stop(); PL.pause(); if (MU.droneOn) A.droneStop(0.1);
    const here = () => app.view === 'music' && gen === MU.gen;
    // the drone as the learner has it now (they may have pressed it while the app listened)
    const back = () => { if (!here()) return; if (MU.droneOn && MU.key && A.droneTonic == null) A.droneStart(muTonic(), MU.drone); if (was) PL.play(); };
    // leaving mid-hum: the microphone goes, unless a set that listens has taken it over
    const gone = () => { MU.hum = null; if (!(R && app.view === 'session')) A.micClose(); };
    try { A.ensure(); A.wake(); await A.micOpen(); } catch (e) { if (!here()) { MU.hum = null; return; } MU.hum = { state: 'failed', text: 'The microphone did not open. You can still pick the note by ear below.' }; back(); renderMusicState(); return; }
    if (!here()) { gone(); return; }
    MU.hum = { state: 'listening' }; renderMusicState();
    const hz = [], t0 = performance.now();
    while (performance.now() - t0 < 2500 && gen === MU.gen && app.view === 'music') {
      await new Promise((r) => setTimeout(r, 50));
      const f = A.micFrame();
      if (f) { try { const d = TL.Pitch.detect(f, A.micRate()); if (d && d.hz > 0) hz.push(d.hz); } catch (e) { /* counted as unheard */ } }
    }
    if (!here()) { gone(); return; }
    A.micClose();
    if (hz.length < 8) { MU.hum = { state: 'failed', text: 'Nothing steady was heard. Hum a little louder, for two seconds.' }; back(); renderMusicState(); return; }
    hz.sort((a, b) => a - b);
    const pc = TL.mod12(Math.round(69 + 12 * Math.log2(hz[hz.length >> 1] / 440)));
    MU.key = { pc, mode: muMode() }; MU.cands = null; muSave();
    MU.hum = { state: 'done', pc };
    back();
    render();
  }
  function musicCheck() {
    if (!MU.an || !PL) return;
    const st = PL.state(), [a, b] = st.loop || [0, Infinity];
    MU.cands = TL.Music.keysOver(MU.an, a, b).keys.slice(0, 3);
    render();
  }
  // what the check says, against the learner's own pick
  function muCheckText() {
    if (!MU.cands) return '';
    const top = MU.cands[0], name = muKeyName(top), k = MU.key;
    if (!k) return `The app hears ${name}. Hum home and hold that drone: does the music settle on it?`;
    if (top.pc === k.pc && top.mode === k.mode) return `The app hears ${name} too.`;
    const relative = (k.mode === 'major' && top.mode === 'minor' && top.pc === TL.mod12(k.pc + 9)) || (k.mode === 'minor' && top.mode === 'major' && top.pc === TL.mod12(k.pc + 3));
    if (relative) return `The app hears ${name}, the relative of ${muKeyName(k)}: the same notes, a different home. Hold each drone in turn and hum home.`;
    return `The app hears ${name}; you picked ${muKeyName(k)}. Hold both drones in turn and hum home: which one does the music settle on?`;
  }
  function muChordsFor(bassId) {
    const groups = EX_CHORDS[muMode()] || EX_CHORDS.major, semi = DEG[bassId] ? DEG[bassId].semi : -1;
    return groups.map(([name, rns]) => [name, rns.filter((rn) => TL.RN[rn] && TL.rnBassPc(rn) === TL.mod12(semi))]).filter(([, rns]) => rns.length);
  }
  function viewMusic() {
    if (!PL) return '<section class="music"><p class="lede">This copy cannot open music.</p></section>';
    const st = PL.state(), has = !!st.file, M = TL.Music.mmss, mode = muMode();
    setTimeout(musicAfterRender, 0);
    const names = mode === 'minor' ? TL.MINOR_KEY_NAMES : TL.KEY_NAMES;
    const pcRow = Array.from({ length: 12 }, (_, pc) => `<button class="chip${MU.key && MU.key.pc === pc ? ' on' : ''}" data-act="muKey" data-pc="${pc}">${esc(names[pc])}</button>`).join('');
    const cands = MU.cands ? `<p class="tip">${esc(muCheckText())}</p><div class="chip-row">${MU.cands.map((c) => `<button class="chip${MU.key && MU.key.pc === c.pc && MU.key.mode === c.mode ? ' on' : ''}" data-act="muPick" data-pc="${c.pc}" data-mode="${c.mode}">${esc(muKeyName(c))}</button>`).join('')}</div>` : '';
    const marks = MU.entry ? MU.entry.marks : [];
    const markRows = marks.map((m, i) => `<li><button class="btn sm ghost mono" data-act="muSeek" data-t="${m.t}">${M(m.t)}</button><b class="serif">${esc(m.rn || '?')}</b><span class="muted">${m.bass ? 'on ' + esc(m.bass) : ''}</span><input type="text" class="note" data-live="muNote" data-i="${i}" value="${esc(m.note || '')}" placeholder="what you hear" maxlength="80"><button class="btn sm ghost" data-act="muDel" data-i="${i}" aria-label="Remove this mark">×</button></li>`).join('');
    const pending = MU.mark ? `<div class="mark-edit">
        <p class="eyebrow">Mark at ${M(MU.mark.t)}</p>
        ${!MU.mark.bass ? `<p class="tip">Sing the lowest note along with the recording. Name it against Do.</p><div class="chip-row">${TL.DEGREES.map((d) => `<button class="chip${TL.MODE_SCALE[mode].includes(d.id) ? '' : ' chrom'}" data-act="muBass" data-id="${d.id}">${esc(degText(d.id).main)}</button>`).join('')}</div>`
          : `<p class="tip">${esc(degText(MU.mark.bass).main)} in the bass. Which chord stands on it?</p>${muChordsFor(MU.mark.bass).map(([name, rns]) => `<div class="grp"><span class="muted">${esc(name)}</span><div class="chip-row">${rns.map((rn) => `<button class="rn-btn serif" data-act="muRn" data-rn="${esc(rn)}" style="--h:${rnHue(rn)}">${esc(rn)}</button>`).join('')}</div></div>`).join('')}<div class="row"><input type="text" id="muOther" data-live="muOther" value="${esc(MU.mark.other || '')}" placeholder="Something else: write it" maxlength="12"><button class="btn sm" data-act="muRnOther">Add</button><button class="btn sm ghost" data-act="muBassBack">Another bass</button></div>`}
        <div class="row"><button class="btn sm ghost" data-act="muMarkCancel">Cancel</button></div>
      </div>` : '';
    return `<section class="music">
      <p class="eyebrow">Your music</p>
      <h1>Work on a recording</h1>
      <p class="lede">Loop a passage from your own music, slow it down, hold Do under it, and mark the chords. The file stays on this device.</p>
      <div class="row"><label class="btn primary">Open a file<input type="file" accept="audio/*,.mp3,.m4a,.wav,.aif,.aiff,.flac,.ogg" data-change="musicFile" hidden></label>${has ? `<span class="muted">${esc(st.name)} · ${M(st.duration)}</span>` : ''}</div>
      <p class="muted" style="font-size:13px;max-width:62ch">MP3, M4A, WAV or AIFF. On an iPhone, open from Files or iCloud Drive; songs in the Music app cannot be opened here, your own bounces and downloads can. Nothing is uploaded.</p>
      <p class="tip" id="muErr" style="color:var(--bad)">${esc(st.error || MU.decodeErr)}</p>
      ${has ? `
      <div class="overview" data-act="muOver"><canvas id="muCanvas"></canvas><div class="shade" id="muShade"></div><div class="head" id="muHead"></div></div>
      <p class="muted" id="muProgress" style="font-size:13px"></p>
      ${MU.tooLong ? `<p class="tip">${esc(MU.tooLong)}: looping and slowing work, the picture and Find Do are left out.</p>` : ''}
      <div class="row">
        <button class="btn primary" id="muPlay" data-act="muPlay">Play <kbd>Space</kbd></button>
        <button class="btn" data-act="muBack" title="Two seconds back">−2 s <kbd>←</kbd></button>
        <button class="btn" data-act="muFwd" title="Two seconds on">+2 s <kbd>→</kbd></button>
        <span class="mono" id="muTime"></span>
      </div>
      <div class="row">
        <button class="btn" data-act="muA">Loop from here <kbd>A</kbd></button>
        <button class="btn" data-act="muB">to here <kbd>B</kbd></button>
        <button class="btn ghost" data-act="muLoopOff">No loop <kbd>L</kbd></button>
        <span class="muted" id="muLoopText"></span>
      </div>
      <p class="muted" style="font-size:13px">A loop jumps back with a short gap; M4A and WAV loop tighter than MP3.</p>
      <div class="row">
        <label class="field">Speed <input type="range" min="50" max="100" step="5" value="${Math.round(st.rate * 100)}" data-live="muRate"> <span class="mono" id="muRateVal">${Math.round(st.rate * 100)}%</span></label>
        <button class="btn sm" data-act="muRateSet" data-v="1">100%</button><button class="btn sm" data-act="muRateSet" data-v="0.75">75%</button><button class="btn sm" data-act="muRateSet" data-v="0.5">50%</button>
      </div>
      <p class="muted" style="font-size:13px">Slow it down to hear the bass and the inner voices. Then go back to full speed.</p>

      <h2>Find Do</h2>
      <ol class="steps">
        <li><strong>Hum what feels like home.</strong> Let the passage play, pause it, then hum the note the music keeps coming back to.${micAvailable() ? ` <button class="btn sm" data-act="muHum">Hum your Do: the app names the note</button> <span class="muted" id="muHum">${esc(muHumText())}</span>` : ''}</li>
        <li><strong>Pick that note, and major or minor.</strong> Hold the drone on it. Does the music settle on it, or lean away?
          <div class="seg" role="group" aria-label="Major or minor"><button aria-pressed="${mode === 'major'}" data-act="muMode" data-mode="major">Major</button><button aria-pressed="${mode === 'minor'}" data-act="muMode" data-mode="minor">Minor</button></div>
          <div class="chip-row">${pcRow}</div>
          <div class="row">
            <button class="btn" data-act="muDrone" ${MU.key ? '' : 'disabled'}>${MU.droneOn ? 'Stop the drone' : 'Hold Do (drone)'}</button>
            <button class="btn" data-act="muCadence" ${MU.key ? '' : 'disabled'}>Play the four chords</button>
            <label class="field">Drone level <input type="range" min="0.3" max="3" step="0.1" value="${MU.drone}" data-live="muDroneLevel"></label>
          </div>
        </li>
        <li><strong>Then the check.</strong> The app guesses from the sound of the ${st.loop ? 'loop' : 'whole file'}; the ear decides.
          <div class="row"><button class="btn" data-act="muCheck" ${MU.an ? '' : 'disabled'}>${MU.key ? 'Check my Do' : 'Guess the key'}</button>${MU.an ? '' : '<span class="muted">(after the file is read)</span>'}</div>
          ${cands}
        </li>
      </ol>

      <h2>Mark the chords</h2>
      <p class="tip">Sing the lowest note of each chord against the drone and name it. The chord stands on that note. Press Mark where a chord changes.</p>
      <div class="row"><button class="btn primary" data-act="muMark" ${MU.key ? '' : 'disabled'}>Mark here <kbd>M</kbd></button>${MU.key ? '' : '<span class="muted">Pick the key first.</span>'}${marks.length ? '<button class="btn ghost" data-act="muCopy">Copy as text</button>' : ''}</div>
      ${pending}
      <ol class="marks">${markRows}</ol>
      ` : ''}
    </section>`;
  }

  // this screen's part of the action table (data-act), merged in main.js
  const yourMusicActions = {
    // your music
    muPlay: () => { A.wake(); MU.resume = false; PL.toggle(); }, // the learner's own Play or Pause overrides a pending resume
    muBack: () => PL.seek(PL.time - 2),
    muFwd: () => PL.seek(PL.time + 2),
    muOver: (d, el, e) => { const r = el.getBoundingClientRect(); const st = PL.state(); if (st.duration && e && e.clientX != null) PL.seek(((e.clientX - r.left) / r.width) * st.duration); },
    muA: () => { const st = PL.state(); if (!st.file) return; const t = PL.time, b = st.loop ? Math.max(st.loop[1], t + 1) : Math.min(st.duration, t + 8); PL.setLoop(t, b); muSave(); renderMusicState(); },
    muB: () => { const st = PL.state(); if (!st.file) return; const t = PL.time, a = st.loop ? Math.min(st.loop[0], t - 0.5) : Math.max(0, t - 8); PL.setLoop(a, t); muSave(); renderMusicState(); },
    muLoopOff: () => { PL.setLoop(null, null); muSave(); renderMusicState(); },
    muRate: (d) => { PL.setRate((+d.v || 100) / 100); muSave(); renderMusicState(); },
    muRateSet: (d) => { PL.setRate(+d.v || 1); muSave(); render(); },
    muKey: (d) => { MU.key = { pc: +d.pc, mode: muMode() }; MU.cands = null; muSave(); if (MU.droneOn) A.droneStart(muTonic(), MU.drone); render(); },
    muMode: (d) => { MU.mode = d.mode === 'minor' ? 'minor' : 'major'; if (MU.key) { MU.key = { pc: MU.key.pc, mode: MU.mode }; muSave(); if (MU.droneOn) A.droneStart(muTonic(), MU.drone); } MU.cands = null; render(); },
    muPick: (d) => { MU.key = { pc: +d.pc, mode: d.mode }; MU.mode = d.mode; muSave(); if (MU.droneOn) A.droneStart(muTonic(), MU.drone); render(); },
    muDrone: () => { if (!MU.key) return; A.wake(); if (MU.droneOn) { A.droneStop(0.5); MU.droneOn = false; } else { A.droneStart(muTonic(), MU.drone); MU.droneOn = true; } render(); },
    muDroneLevel: (d) => { MU.drone = +d.v || 1; if (MU.droneOn) A.droneLevel(MU.drone); muSave(); },
    muCadence: () => {
      if (!MU.key) return;
      // a second press cuts the first short (its done is false) and takes over its promise to resume
      MU.resume = PL.state().playing || MU.resume; PL.pause(); A.wake();
      const h = A.play(TL.cadenceEvents(muTonic(), muMode()), { timbre: pickTimbre() });
      h.done.then((ok) => { if (!ok) return; const r = MU.resume; MU.resume = false; if (r && app.view === 'music') PL.play(); });
    },
    muHum: () => musicHum(),
    muCheck: () => musicCheck(),
    muMark: () => { if (!MU.key || !PL.state().file) return; MU.mark = { t: Math.round(PL.time * 10) / 10, bass: '' }; render(); },
    muMarkCancel: () => { MU.mark = null; render(); },
    muBass: (d) => { if (MU.mark) { MU.mark.bass = d.id; render(); } },
    muBassBack: () => { if (MU.mark) { MU.mark.bass = ''; render(); } },
    muRn: (d) => { if (!MU.mark || !MU.entry) return; MU.entry.marks.push({ t: MU.mark.t, bass: degText(MU.mark.bass).main, rn: d.rn, note: '' }); MU.mark = null; muSave(); render(); },
    muOther: (d) => { if (MU.mark) MU.mark.other = String(d.v || '').slice(0, 12); },
    muRnOther: () => { const v = (MU.mark && MU.mark.other) || ''; if (!MU.mark || !MU.entry || !v.trim()) return; MU.entry.marks.push({ t: MU.mark.t, bass: degText(MU.mark.bass).main, rn: v.trim().slice(0, 12), note: '' }); MU.mark = null; muSave(); render(); },
    muNote: (d) => { if (MU.entry && MU.entry.marks[+d.i]) { MU.entry.marks[+d.i].note = String(d.v || '').slice(0, 80); muSave(); } },
    muDel: (d) => { if (MU.entry) { MU.entry.marks.splice(+d.i, 1); muSave(); render(); } },
    muSeek: (d) => { PL.seek(+d.t || 0); },
    muCopy: () => { if (!MU.entry) return; const text = `${MU.entry.name} · ${muKeyName(MU.key)}\n${TL.Music.marksText(MU.entry)}`; navigator.clipboard.writeText(text).then(() => toast('Marks copied.', 2000), () => toast('Copying was blocked here.', 2600)); },
  };

export { MU, PL, musicLeave, musicOpen, renderMusicState, viewMusic, yourMusicActions };
