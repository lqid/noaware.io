/* Tone Ladder — Preferences: settings, the microphone tools, calibration, moving progress, reset. */
import { $, A, CUR, S, TL, applyAudio, esc, micCopy, safeAudio, setDeviceInfo, timbreOptions, toast } from './base.js';
import { R, app } from './state.js';
import { MIC, micAvailable, micFramed, micPermission, micPref, setMicPref } from './mic.js';
import { MIDI, midiSupported } from './midi.js';
import { dropPlan } from './plan.js';
import { go, render } from './router.js';
import { micUnblockHint } from './sing-view.js';

  // ======================================================================
  // PREFERENCES
  // ======================================================================
  let resetArmed = false;
  function disarmReset() { resetArmed = false; } // go() leaves the reset unarmed
  const MOVE = { copied: null, pasting: false, error: '', warn: '', pasted: '' };
  // a link always opens the site copy: the claude.ai one sits in a frame the fragment never reaches
  const linkBase = () => (micCopy() ? 'https://noaware.io/tone-ladder/' : location.origin + location.pathname);
  // opened from a link: the progress it carries goes into the paste panel, with the same checks
  function openLink(hash) {
    history.replaceState(null, '', location.pathname + location.search); // a reload must not ask again
    S.textFromLink(hash).then(
      (text) => { go('prefs'); Object.assign(MOVE, { pasting: true, pasted: text, error: '', warn: '' }); render(); const t = $('#importText'); if (t) t.scrollIntoView({ block: 'center' }); },
      (e) => { go('prefs'); Object.assign(MOVE, { pasting: true, pasted: '', error: e.message, warn: '' }); render(); }
    );
  }
  const CAL = { active: false, taps: [] };
  const MIC_PREF_ERR = {
    blocked: () => `The browser blocked the microphone. ${micUnblockHint()} Then choose it again here.`,
    dismissed: () => 'The microphone request was closed. Choose the microphone again, or press Ask again, to see it.',
    system: () => 'Your computer’s privacy settings keep this browser from the microphone. Allow it in System Settings, Privacy & Security, Microphone, then reload the page.',
    framed: () => 'The microphone is not available in this copy of Tone Ladder. It works at noaware.io/tone-ladder/.',
    none: () => 'No microphone was found.',
    busy: () => 'Another app is using the microphone.',
    other: () => 'The microphone could not start.',
  };
  // Turning the microphone on in Settings asks right away, inside the learner's gesture, so the
  // permission prompt does not arrive in the middle of a question.
  function micPrefAsk() {
    setMicPref('on');
    MIC.denied = false;
    MIC.prefErr = null;
    const tok = ++MIC.prefTok;
    A.micOpen().then(() => { if (!R) A.micClose(); micPermission().then(render); }, async (er) => {
      if ((er && er.tlClosed) || tok !== MIC.prefTok) return;
      const st = await micPermission();
      if (tok !== MIC.prefTok || micPref() !== 'on') return;
      const name = (er && er.name) || '';
      if (name === 'NotAllowedError' && st !== 'prompt') { setMicPref('off'); MIC.denied = true; }
      // a closed prompt is not a choice: back to not chosen, so choosing again asks again
      if (name === 'NotAllowedError' && st === 'prompt') setMicPref(null);
      MIC.prefErr = name === 'NotAllowedError' ? (/system/i.test((er && er.message) || '') ? 'system' : st === 'prompt' ? 'dismissed' : micFramed() ? 'framed' : 'blocked') : name === 'NotFoundError' ? 'none' : name === 'NotReadableError' ? 'busy' : 'other';
      render();
    });
  }
  function midiNote_() {
    const names = MIDI.inputs.map((i) => i.name).filter(Boolean).join(', ');
    return { on: `Connected: ${names}. A key played answers a note question, by its name in the question’s key.`, empty: 'Connected, but no keyboard is plugged in. Plug one in and it will be found.', blocked: 'The browser blocked MIDI access. Allow it for this site, then connect again.' }[MIDI.status]
      || 'Answer note questions by playing them, named in the question’s key. Works in Chrome and Edge.';
  }
  function micPrefNote() {
    if (window.isSecureContext === false) return 'The microphone needs a secure (https) page, so you check your own singing here.';
    if (!A.micSupported()) return 'This browser cannot use a microphone, so you check your own singing.';
    if (!micAvailable()) return 'The microphone is not available in this copy of Tone Ladder. It works at noaware.io/tone-ladder/.';
    if (MIC.prefErr) return (MIC_PREF_ERR[MIC.prefErr] || MIC_PREF_ERR.other)();
    if (MIC.perm === 'denied') return `The browser blocks the microphone for this site. ${micUnblockHint()}`;
    return 'The microphone grades Sing questions, hears the melody you sing back in Melodic Dictation, and hears your claps in rhythm sets. The sound is analysed on this device and never sent anywhere; only the current answer is kept, until the next question, so you can save it if a grade looks wrong.';
  }
  // Sing a slow slide from the lowest comfortable note to the highest: the app picks the singing range.
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const noteName = (m) => NOTE_NAMES[TL.mod12(Math.round(m))] + (Math.floor(Math.round(m) / 12) - 1);
  // Outside a set nothing else needs the mic, so whichever of these tools ran last owns it and
  // closes it on every way out (a newer run, or a set starting, takes it over instead).
  async function micRange() {
    const say = (t) => { const el = $('#micRangeOut'); if (el) el.textContent = t; };
    if (R) return;
    const run = ++MIC.test;
    const mine = () => run === MIC.test && !R;
    try { await A.micOpen(); } catch (e) { if (mine() && !(e && e.tlClosed)) say('The microphone could not start.'); return; }
    try { await micRangeRun(say, mine); } finally { if (mine()) A.micClose(); }
  }
  async function micRangeRun(say, mine) {
    MIC.prefErr = null;
    A.wake();
    await new Promise((res) => setTimeout(res, 300));
    if (!mine()) return;
    if (!A.running) { say('Tap Find my range again: the browser paused the sound.'); return; }
    say('Listening. Sing “oo” from your lowest comfortable note, slide slowly up to your highest, then stop.');
    const midis = [];
    let heard = null, last = null;
    const t0 = performance.now();
    await new Promise((res) => {
      const timer = setInterval(() => {
        if (!mine()) { clearInterval(timer); res(); return; }
        const now = performance.now(), f = A.micFrame();
        if (f) {
          try {
            const d = TL.Pitch.detect(f, A.micRate());
            if (d && d.hz > 0 && d.clarity >= 0.85) { midis.push(69 + 12 * Math.log2(d.hz / 440)); last = now; if (heard == null) heard = now; }
          } catch (e) { /* counted as unheard */ }
        }
        if ((heard != null && now - last > 1500 && midis.length > 20) || now - t0 > 20000) { clearInterval(timer); res(); }
      }, 25);
    });
    if (!mine()) return;
    if (midis.length < 20) { say('I did not hear a slide. Sing louder and closer to the microphone, and try again.'); return; }
    midis.sort((a, b) => a - b);
    const lo = midis[Math.floor(midis.length * 0.08)], hi = midis[Math.floor(midis.length * 0.92)];
    if (hi - lo < 5) { say('That was a short slide. Go from your lowest comfortable note up to your highest.'); return; }
    // the setting whose span (Do within it, patterns up to a 13th above its bottom) the voice covers best
    const best = ['low', 'mid', 'high'].map((v) => {
      const a = CUR.VOICE[v] - 2, b = CUR.VOICE[v] + 19;
      return { v, fit: Math.max(0, Math.min(b, hi) - Math.max(a, lo)) - 0.2 * Math.abs((a + b) / 2 - (lo + hi) / 2) };
    }).sort((x, y) => y.fit - x.fit)[0].v;
    S.set('voice', best);
    const sel = $('#pref-voice'); if (sel) sel.value = best;
    say(`Your comfortable range is about ${noteName(lo)} to ${noteName(hi)}. The setting “${CUR.VOICE_LABELS.find((x) => x[0] === best)[1]}” fits it best, and is now chosen.`);
  }
  // Play a pure A through the speakers and listen for it: the speaker and the mic must agree on pitch.
  async function micTest() {
    const say = (t) => { const el = $('#micTestOut'); if (el) el.textContent = t; };
    if (R) return;
    const run = ++MIC.test;
    const mine = () => run === MIC.test && !R;
    try { await A.micOpen(); } catch (e) { if (mine() && !(e && e.tlClosed)) say('The microphone could not start.'); return; }
    try { await micTestRun(say, mine); } finally { if (mine()) A.micClose(); }
  }
  async function micTestRun(say, mine) {
    MIC.prefErr = null;
    A.wake();
    await new Promise((res) => setTimeout(res, 300)); // as when a set starts: let the audio route settle
    if (!mine()) return;
    if (!A.running) { say('Tap Test the microphone again: the browser paused the sound.'); return; }
    say('Playing a test note. Stay quiet for two seconds.');
    const hz = [];
    const h = A.play([{ t: 0, notes: [69], dur: 1.6, vel: 0.8 }], { timbre: 'pure' });
    const t0 = A.now();
    const timer = setInterval(() => {
      const dt = A.now() - t0;
      if (dt < 0.4 || dt > 1.5) return;
      const f = A.micFrame();
      if (!f) return;
      try { const d = TL.Pitch.detect(f, A.micRate()); if (d && d.hz > 0) hz.push(d.hz); } catch (e) { /* counted as unheard */ }
    }, 25);
    const ok = await h.done;
    clearInterval(timer);
    if (!mine()) return;
    if (!ok) { say('The test note was interrupted. Try again.'); return; }
    if (hz.length < 8) { say('The microphone did not hear the test note. With headphones on that is expected; otherwise turn the volume up and try again.'); return; }
    hz.sort((a, b) => a - b);
    const c = Math.round(1200 * Math.log2(hz[hz.length >> 1] / 440));
    if (Math.abs(c) <= 25) say(`The microphone heard the test note in tune (${c >= 0 ? '+' : ''}${c} cents). Checking will work on this device.`);
    else {
      say(`The microphone heard the test note ${Math.abs(c)} cents ${c < 0 ? 'low' : 'high'}. Something on this device shifts pitch, so checking is turned off here.`);
      setMicPref('off');
      const sel = $('#pref-mic'); if (sel) sel.value = 'off';
    }
  }
  function viewPrefs() {
    const s = S.settings;
    const sel = (key, options) => `<select id="pref-${key}" data-pref="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const chk = (key, label) => `<label class="check"><input type="checkbox" id="pref-${key}" data-pref="${key}" ${s[key] ? 'checked' : ''}> ${esc(label)}</label>`;
    const row = (title, desc, control) => `<div class="prow"><div class="lab"><strong>${esc(title)}</strong>${desc ? `<span>${esc(desc)}</span>` : ''}</div><div>${control}</div></div>`;
    const storage = S.mode === 'cloud' ? 'Saved to your claude.ai account, so it follows you across devices.' : S.mode === 'local' ? 'Saved in this browser only.' : 'Not saved: this browser blocks storage.';
    return `<div>
      <div class="page-head"><p class="eyebrow">Settings</p><h1>Preferences</h1></div>
      <div class="prefs">
        <section class="pgroup"><h2>Sound</h2>
          ${(() => {
            const opts = [...timbreOptions(s.timbre), ['vary', 'Vary by question']];
            const rec = A.SAMPLED[s.timbre], state = rec ? A.sampled(s.timbre) : 'none';
            const credits = Object.entries(A.SAMPLED).map(([n, d]) => { const i = A.samplesInfo(n); return i && i.source ? `${d.label}: ${i.source}${i.licence ? ', ' + i.licence : ''}.` : ''; }).filter(Boolean).join(' ');
            const own = rec ? rec.label.toLowerCase() : '', synth = rec ? A.TIMBRES[rec.synth].toLowerCase() : '';
            const note = !rec || state === 'ready' ? '' : state === 'missing' ? ` The ${own} is not on this copy, so the ${synth} plays instead.` : state === 'failed' ? ` The ${own} could not be loaded; the ${synth} plays until it has.` : ` The ${own} is still loading; the ${synth} plays until it has.`;
            return row('Instrument', 'Varying the instrument helps you hear each note’s place in the key, not the sound of one instrument.' + note + (credits ? ' ' + credits : ''), sel('timbre', opts));
          })()}
          ${row('Volume', '', `<input type="range" min="0" max="1" step="0.05" id="pref-volume" data-pref="volume" value="${esc(s.volume)}">`)}
          ${row('Playback speed', 'Applies to the four chords, melodies, progressions and rhythm tempo.', sel('speed', [[0.8, 'Slower'], [1, 'Normal'], [1.2, 'Faster']]))}
          <div class="row"><button class="btn" data-act="soundCheck">Sound check</button><button class="btn ghost" data-act="selfTest">Test the audio engine</button><span class="muted" id="selfTestOut" style="font-size:13px"></span></div>
        </section>
        <section class="pgroup"><h2>Key and context</h2>
          ${row('Key changes', 'Changing key keeps you hearing each note’s place in the key rather than memorizing pitches.', sel('keyMode', [['rotate', 'Every 8 questions'], ['each', 'Every question'], ['fixed', 'Stay in one key']]))}
          ${s.keyMode === 'fixed' ? row('Fixed key', '', sel('fixedKey', TL.KEY_NAMES.map((n, i) => [i, n]))) : ''}
          ${row('Setting the key', 'Four chords before each question, or a held Do (a drone) underneath it. Singing questions always use the chords.', sel('context', [['cadence', 'Four chords (I–IV–V7–I)'], ['drone', 'A held Do (drone)']]))}
          ${s.context === 'cadence' ? row('Four chords every question', 'Off: the chords play only when the key changes. Harder; for later.', chk('cadenceEvery', 'Play them every time')) : ''}
        </section>
        <section class="pgroup"><h2>Practice</h2>
          ${row('Note names', '', sel('labels', [['both', 'Solfège and numbers (Sol 5)'], ['solfege', 'Solfège only (Sol)'], ['numbers', 'Numbers only (5)']]))}
          ${row('Answer notes on', 'The ladder shows the notes by their place in the key. The piano shows the same notes on a keyboard of the question’s key, with its black and white keys. The staff writes them in the key, with its signature.', sel('input', [['ladder', 'The tone ladder'], ['piano', 'Piano keys'], ['staff', 'A staff']]))}
          ${row('The answer on a staff', 'After each answer, what sounded is written on a staff in the key, with the names underneath: the path from hearing to the page. Sight-Singing always shows its staff: there it is the question.', sel('notation', [['answers', 'Shown'], ['off', 'Off']]))}
          ${midiSupported() ? row('MIDI keyboard', midiNote_(), MIDI.status === 'on' || MIDI.status === 'empty' ? '<button class="btn ghost" data-act="midiOff">Disconnect</button>' : '<button class="btn" data-act="midiOn">Connect a MIDI keyboard</button>') : ''}
          ${row('Daily goal', 'Sets the length of the Today plan.', sel('dailyGoal', [[15, '15 questions · about 6 min'], [30, '30 questions · about 12 min'], [50, '50 questions · about 20 min']]))}
          ${row('Auto-advance', 'Move on after a correct answer once the answer has finished playing.', chk('autoAdvance', 'On'))}
          ${row('Your call first', 'With the microphone on, every third singing round asks for your own grade before the app shows what it heard. Judging your singing before you are told is what trains the ear.', chk('guessFirst', 'On'))}
          ${row('Sing it back first', 'With the microphone on, each Melodic Dictation melody is sung back before you name its notes. The echo is checked but not scored.' + (micPref() === 'off' ? ' Off while the microphone is set to Myself.' : ''), chk('singBack', 'On'))}
          ${row('Clap rhythms', 'With the microphone on, a rhythm can be clapped as well as tapped. Keep quiet during the get-ready clicks: the app measures the room then.' + (micPref() === 'off' ? ' Off while the microphone is set to Myself.' : ''), chk('clap', 'On'))}
          ${row('Dictation playback', 'Hear each note, chord or rhythm figure as you enter it, and in Full Dictation play what you wrote before you check it. Easier, but less training of your inner ear.', chk('dictationSound', 'On'))}
          ${row('Singing range', 'Where the answer note plays in singing questions, and the clef Sight-Singing writes its melodies in.', sel('voice', CUR.VOICE_LABELS))}
          ${micAvailable() ? '<div class="row"><button class="btn ghost" data-act="micRange">Find my range</button><span class="muted" id="micRangeOut" role="status" style="font-size:13px">Sing a slow slide from your lowest comfortable note to your highest, and the app picks the range for you.</span></div>' : ''}
          ${row('Microphone', micPrefNote(), micAvailable() ? `<select id="pref-mic" data-change="micPref">${micPref() ? '' : '<option value="" selected disabled>Not chosen: asks at the next set that can listen</option>'}<option value="on" ${micPref() === 'on' ? 'selected' : ''}>With the microphone</option><option value="off" ${micPref() === 'off' ? 'selected' : ''}>Myself</option></select>${MIC.prefErr === 'dismissed' ? ' <button class="btn ghost" data-act="micAsk">Ask again</button>' : ''}` : '<span class="muted" style="font-size:13px">Myself</span>')}
          ${micAvailable() && micPref() === 'on' ? '<div class="row"><button class="btn ghost" data-act="micTest">Test the microphone</button><span class="muted" id="micTestOut" role="status" style="font-size:13px"></span></div>' : ''}
        </section>
        <section class="pgroup"><h2>Rhythm timing</h2>
          ${row('Tap offset', 'Compensates for Bluetooth headphones and touch screens. Calibrate by tapping along with clicks.', `<input type="number" id="pref-tapOffsetMs" data-pref="tapOffsetMs" value="${esc(s.tapOffsetMs)}" step="5" min="-400" max="400"> <span class="muted" style="font-size:12.5px">ms</span>`)}
          <div class="calib" id="calib">${calibHTML()}</div>
        </section>
        <section class="pgroup"><h2>Progress</h2>
          <p class="muted">${esc(storage)}</p>
          ${row('Open all levels', 'For when you already know some of this. Tracks and levels stay open; mastery still tracks.', chk('unlockAll', 'Open everything'))}
          <div class="move">
            <strong>Move your progress</strong>
            <span>Copy your progress here, then paste it into Tone Ladder in another browser or on another device, or between noaware.io and the claude.ai version. On an iPhone or iPad, a copy added to the Home Screen keeps its own progress: copy it here, then paste it there.</span>
            <div class="row"><button class="btn" data-act="exportProgress">Copy my progress</button><button class="btn" data-act="importOpen">Paste progress…</button></div>
            ${S.canLink ? `<div class="row"><button class="btn" data-act="linkCopy">Copy a link</button>${navigator.share ? '<button class="btn" data-act="linkShare">Share a link…</button>' : ''}</div>
            <span>A link carries your progress and opens Tone Ladder with it on another device${micCopy() ? ', at noaware.io' : ''}: send it to yourself and open it there. Text is for the copies that cannot open a link: the claude.ai version, and a copy added to the Home Screen on an iPhone or iPad.</span>` : '<span>This browser cannot make a link that carries your progress; Copy my progress works.</span>'}
            ${MOVE.copied ? `<label class="field">Copying was blocked here. Select all of this text and copy it yourself:<textarea id="exportText" readonly>${esc(MOVE.copied)}</textarea></label>` : ''}
            ${MOVE.pasting ? `<label class="field">Paste the progress you copied:<textarea id="importText" placeholder="Paste here">${esc(MOVE.pasted)}</textarea></label>
              ${MOVE.error ? `<p class="tip" style="color:var(--bad)">${esc(MOVE.error)}</p>` : ''}
              ${MOVE.warn ? `<p class="tip" style="color:var(--bad)">${esc(MOVE.warn)}</p>` : ''}
              <span>${S.mode === 'cloud' ? 'This replaces the progress saved to your claude.ai account, on every device: levels, statistics, streak and preferences.' : 'This replaces everything saved in this browser: levels, statistics, streak and preferences.'} You can undo it here afterwards.</span>
              <div class="row"><button class="btn danger" data-act="importConfirm"${MOVE.warn ? ' data-force="1"' : ''}>${MOVE.warn ? 'Replace anyway' : 'Replace my progress here'}</button><button class="btn ghost" data-act="importCancel">Cancel</button></div>` : ''}
            ${!MOVE.pasting && S.hasUndo() ? '<div class="row"><button class="btn ghost" data-act="importUndo">Undo the last paste</button></div>' : ''}
          </div>
          <div class="row">${resetArmed ? `<span class="muted">This erases every level, statistic and streak. Your preferences stay.</span><button class="btn danger" data-act="resetConfirm">Erase my progress</button><button class="btn ghost" data-act="resetCancel">Keep it</button>` : '<button class="btn danger" data-act="resetArm">Reset progress…</button>'}</div>
        </section>
      </div>
    </div>`;
  }
  function calibHTML() {
    if (CAL.active) return `<p class="tip">Tap along with the clicks (after the first four). Space works too.</p><button class="tap-pad" id="calPad" type="button" style="height:110px">Tap</button>`;
    return `<div class="row"><button class="btn" data-act="calibrate">Calibrate</button>${CAL.result ? `<span class="muted" style="font-size:13px">${esc(CAL.result)}</span>` : ''}</div>`;
  }
  function calibrate() {
    if (!safeAudio()) return;
    const bpm = 90, beat = 60 / bpm, n = 14;
    const ev = Array.from({ length: n }, (_, i) => ({ t: i * beat, perc: i % 4 === 0 ? 'accent' : 'click', dur: 0.05, vel: 1 }));
    const h = A.play(ev, { raw: true });
    Object.assign(CAL, { active: true, taps: [], t0: h.t0, beat, n, result: '' });
    $('#calib').innerHTML = calibHTML();
    setTimeout(() => {
      const offs = [];
      for (const t of CAL.taps) {
        const k = Math.round((t - CAL.t0) / beat);
        if (k < 4 || k >= n) continue;
        const o = t - (CAL.t0 + k * beat);
        if (Math.abs(o) < beat * 0.4) offs.push(o);
      }
      CAL.active = false;
      if (offs.length < 5) CAL.result = 'Not enough taps to calibrate. Try again.';
      else {
        offs.sort((a, b) => a - b);
        const med = offs[Math.floor(offs.length / 2)];
        S.set('tapOffsetMs', Math.round(med * 1000));
        CAL.result = `Set to ${Math.round(med * 1000)} ms from ${offs.length} taps.`;
      }
      if (app.view === 'prefs') render();
    }, (n * beat + 0.8) * 1000);
  }

  // this screen's part of the action table (data-act), merged in main.js
  const prefsActions = {
    selfTest: async () => {
      const out = $('#selfTestOut');
      try {
        const r = await A.renderTest('pure', 69);
        if (!r) { out.textContent = 'Offline rendering is not supported here.'; return; }
        out.textContent = r.peak > 0.01 && Math.abs(r.hz - 440) < 8 ? `Working: A4 measured at ${Math.round(r.hz)} Hz.` : `Unexpected output (peak ${r.peak.toFixed(3)}, ${Math.round(r.hz)} Hz).`;
      } catch (e) { out.textContent = 'Test failed: ' + e.message; }
    },
    micTest,
    micRange,
    micAsk: () => micPrefAsk(),
    exportProgress: () => {
      const text = S.exportText();
      const fallback = () => { if (app.view !== 'prefs') go('prefs'); MOVE.copied = text; render(); const t = $('#exportText'); if (t) { t.focus(); t.select(); } };
      try {
        navigator.clipboard.writeText(text).then(() => { MOVE.copied = null; setDeviceInfo({ backupAt: Date.now() }); toast('Progress copied. Keep it somewhere safe, or paste it into another Tone Ladder under Preferences.', 3600); render(); }, fallback);
      } catch (e) { fallback(); }
    },
    importOpen: () => { Object.assign(MOVE, { pasting: true, error: '', warn: '', pasted: '' }); render(); const t = $('#importText'); if (t) t.focus(); },
    linkCopy: () => S.exportLink(linkBase()).then((link) => navigator.clipboard.writeText(link).then(() => { setDeviceInfo({ backupAt: Date.now() }); toast('Link copied. Open it on the other device: Tone Ladder asks there before replacing anything.', 3800); }, () => { MOVE.copied = link; render(); const t = $('#exportText'); if (t) { t.focus(); t.select(); } }), (e) => toast(e.message, 3000)),
    linkShare: () => S.exportLink(linkBase()).then((url) => navigator.share({ title: 'Tone Ladder progress', url }).catch(() => { /* the sheet was closed */ }), (e) => toast(e.message, 3000)),
    importCancel: () => { Object.assign(MOVE, { pasting: false, error: '', warn: '', pasted: '' }); render(); },
    importConfirm: (d) => {
      const t = $('#importText');
      const text = t ? t.value : '';
      // a changed paste needs checking again
      const force = d.force === '1' && text === MOVE.pasted;
      let st;
      try { st = S.parseBackup(text); } catch (e) {
        Object.assign(MOVE, { error: e.message, warn: '', pasted: text });
        render();
        return;
      }
      const here = S.answeredIn(S.state), there = S.answeredIn(st);
      if (!force && here > 0 && there < here) {
        Object.assign(MOVE, {
          error: '', pasted: text,
          warn: `The pasted progress has ${there} answered question${there === 1 ? '' : 's'}; this browser has ${here}. You may have copied from the wrong place. Copy from where your progress is, or replace anyway.`,
        });
        render();
        return;
      }
      if (S.blocked) { toast('Reload the page first: your progress was saved by a newer version.'); return; }
      S.applyBackup(st);
      dropPlan();
      Object.assign(MOVE, { pasting: false, error: '', warn: '', pasted: '' });
      applyAudio();
      toast('Progress loaded.');
      render();
    },
    importUndo: () => {
      if (S.undoImport()) { dropPlan(); applyAudio(); toast('Restored the progress from before the paste.'); }
      render();
    },
    resetArm: () => { resetArmed = true; render(); },
    resetCancel: () => { resetArmed = false; render(); },
    resetConfirm: () => {
      if (S.blocked) { toast('Reload the page first: your progress was saved by a newer version.'); return; }
      S.reset(); dropPlan(); resetArmed = false; toast('Progress erased.'); render();
    },
    calibrate,
  };

export { CAL, MOVE, disarmReset, micPrefAsk, openLink, prefsActions, viewPrefs };
