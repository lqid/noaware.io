/* Tone Ladder — sing questions on screen: target, staff, grades, takes, the microphone panels and results. */
import { $, A, DEG, TL, degText, esc, isFindDo } from './base.js';
import { R } from './state.js';
import { levelUpHTML, struggleHTML } from './answer-view.js';
import { GRADE_NAME } from './answer.js';
import { singBack, singTarget, takeHere } from './mic.js';
import { learnedDegrees } from './today.js';

  // ----- sing -----
  // A row of note names; with semis, the names sit higher or lower to show the melody's shape.
  // ---------- sight-singing: the melody on its staff ----------
  function sightStaffSVG(st, lyrics, highlight = [], width = 520) {
    return TL.Notation.staff({ key: st.key, clef: st.clef, notes: st.notes, lyrics, highlight, width });
  }
  const CLEF_NAME = { bass: 'bass clef', treble: 'treble clef', treble8: 'treble clef with an 8' };
  // While answering, the names the level allows; after, all of them, the key, and in red the notes
  // the app heard wrong (once the learner has made their own call, and never for a tune sung from
  // the wrong first note, where every note is "wrong" but the shape was right).
  function sightStaffHTML(q) {
    const open = R.phase !== 'answering';
    const names = open || q.namesShown || q.copy ? 'all' : q.staff.names; // a copy round follows the lit notes by name
    const m = R.mic;
    const res = open && m && m.state === 'heard' && m.shown && !(m.guessFirst && m.guess == null) ? m.result : null;
    const wrong = res && res.reason !== 'transposed' && Array.isArray(res.steps) && res.steps.length === q.pattern.length ? res.steps.map((x, i) => (x.ok ? -1 : i)).filter((i) => i >= 0) : [];
    const lyrics = q.pattern.map((id, i) => (names === 'all' || (names === 'first' && i === 0) ? degText(id).main : ''));
    const label = open ? 'The melody: ' + q.pattern.map((id) => degText(id).main).join(', ') : `A melody of ${q.pattern.length} notes on a staff, ${CLEF_NAME[q.staff.clef] || 'treble clef'}`;
    let svg;
    try { svg = sightStaffSVG(q.staff, lyrics, wrong, Math.min(520, Math.max(300, window.innerWidth - 32))); } catch (e) { return patternRow(q.pattern, q.patternSemis); }
    const show = !open && names !== 'all' ? '<div class="row"><button class="btn sm ghost" data-act="showNames">Show the names</button><span class="muted" style="font-size:13px">makes this a practice round</span></div>' : '';
    return `<div class="score sight-staff" role="img" aria-label="${esc(label)}">${svg}</div>${show}`;
  }
  function patternRow(ids, semis) {
    const max = semis ? Math.max(...semis) : 0;
    return `<div class="pattern${semis ? ' shape' : ''}">${ids.map((id, i) => {
      const s = semis ? semis[i] : null;
      const tag = s == null ? '' : s < 0 ? '<small>low</small>' : s >= 12 ? '<small>high</small>' : '';
      const off = s == null ? '' : `margin-top:${(max - s) * 3}px;`;
      return `<span data-deg="${id}" data-i="${i}" style="--h:${DEG[id].hue};${off}">${esc(degText(id).main)}${tag}</span>`;
    }).join('')}</div>`;
  }
  function singHTML() {
    const q = R.q;
    let target = '';
    // a staff question shows its staff, never the names row, which would give the answer away
    if (q.staff) target = sightStaffHTML(q);
    else if (q.deg) { const d = degText(q.deg); target = `<p class="sing-target deg" style="--h:${DEG[q.deg].hue}">${esc(d.main)}${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</p>`; }
    else if (q.pattern) target = patternRow(q.pattern, q.patternSemis);
    let after = '';
    if (R.phase !== 'answering') {
      if (q.echoAnswer) after = `<p class="muted">It was:</p>${patternRow(q.echoAnswer, q.echoSemis)}`;
      if (q.bassAnswer) { const d = degText(q.bassAnswer); after = `<p class="muted">The bass was <strong>${esc(d.main)}</strong>.</p>`; }
      if (q.toneAnswer) { const d = degText(q.toneAnswer); after = `<p class="muted">The ${esc(q.chordTone)} was <strong>${esc(d.main)}</strong>.</p>`; }
    }
    const melodyLike = !!(q.pattern || q.echoAnswer);
    const heard = R.mic && R.mic.result && R.mic.state === 'heard' ? R.mic.result : null;
    const shown = heard && R.mic.shown;
    const guessing = shown && R.mic.guessFirst && R.mic.guess == null;
    if (shown && R.phase !== 'answering' && !guessing) after = micResultHTML(q, heard);
    let controls;
    if (R.phase === 'answering' && R.mic && R.mic.state !== 'off') {
      controls = micPanelHTML(q);
    } else if (R.phase === 'answering') {
      controls = `<button class="btn primary lg" data-act="singReveal"${R.mainEnd == null ? ' disabled data-needs-main' : ''}>I sang it: play the answer <kbd>Enter</kbd></button>`;
    } else if (R.phase === 'revealed' && heard && !shown) {
      controls = `<p class="tip">${melodyLike ? 'Sing it again along with the answer. Same notes?' : 'Sing your note again along with the answer. Do they melt into one sound?'}</p>`;
    } else if (R.phase === 'revealed' && guessing) {
      controls = `<p class="tip">Your call first: how was it?</p>
        <div class="grade">
          <button class="btn" data-act="singGuess" data-v="1">${melodyLike ? 'Matched: every note right' : 'Matched: one sound'} <kbd>1</kbd></button>
          <button class="btn" data-act="singGuess" data-v="0.5">${melodyLike ? 'Close: one note off, or slid' : 'Close: moved a little'} <kbd>2</kbd></button>
          <button class="btn" data-act="singGuess" data-v="0">${melodyLike ? 'Missed: two or more off' : 'Missed: a different note'} <kbd>3</kbd></button>
          <button class="btn ghost" data-act="replay" data-part="reveal">Hear it again</button>
        </div>
        <p class="muted" style="font-size:13.5px;max-width:60ch">Then the app shows what it heard. Judging your own singing before you are told is what trains the ear; this round is graded by the app as usual.</p>`;
    } else if (R.phase === 'revealed' && heard) {
      const sug = heard.v;
      const gb = (v, label, key) => `<button class="btn${v === sug ? ' primary' : ''}" data-act="singGrade" data-v="${v}">${label}${v === sug ? ' · the app’s grade' : v > sug ? ' · it misheard me' : ''} <kbd>${v === sug ? 'Enter' : key}</kbd></button>`;
      const why = q.echoAnswer && R.replays > 1 ? 'You replayed the melody' : q.namesShown ? 'You showed the names' : '';
      controls = `${why ? `<p class="tip">${why}, so this round is practice. It does not count for or against you.</p>` : R.mic.warmup ? '<p class="tip">A warm-up round with the microphone: it does not count yet.</p>' : ''}
        <div class="grade">
          ${gb(1, 'Matched', 1)}${gb(0.5, 'Close', 2)}${gb(0, 'Missed', 3)}
          <button class="btn ghost" data-act="replay" data-part="reveal">Hear it again</button>
        </div>
        <p class="muted" style="font-size:13.5px;max-width:60ch"><span class="kbd-only">Enter keeps the app’s grade. </span>If you know you were further off, choose a lower grade. If the app misheard you, choose what you sang: that round is not scored either way.</p>
        ${takeRowHTML()}`;
    } else if (R.phase === 'revealed') {
      const why = q.echoAnswer && R.replays > 1 ? 'You replayed the melody' : q.namesShown ? 'You showed the names' : '';
      controls = `${why ? `<p class="tip">${why}, so this round is practice. It does not count for or against you.</p>` : ''}
        <p class="tip">${melodyLike ? 'Sing it again along with the answer. Same notes, at any height?' : 'Keep singing your note while the answer plays. Do they melt into one sound, or does your voice have to move?'}</p>
        <div class="grade">
          <button class="btn" data-act="singGrade" data-v="1">${melodyLike ? 'Matched: every note right' : 'Matched: one sound'} <kbd>1</kbd></button>
          <button class="btn" data-act="singGrade" data-v="0.5">${melodyLike ? 'Close: one note off, or slid' : 'Close: moved a little'} <kbd>2</kbd></button>
          <button class="btn" data-act="singGrade" data-v="0">${melodyLike ? 'Missed: two or more off' : 'Missed: a different note'} <kbd>3</kbd></button>
          <button class="btn ghost" data-act="replay" data-part="reveal">Hear it again</button>
        </div>
        <p class="muted" style="font-size:13.5px;max-width:60ch">Higher or lower is fine if it is the same note. Two notes that only sound nice together, like Sol against Do, are different notes. Not sure? Choose Close.</p>
        ${takeRowHTML()}`;
    } else if (R.singMissed) {
      const twoMiss = isFindDo(q) && !R.levelUpNow && (R.findDoMisses || 0) >= 2;
      controls = `<p class="tip">${esc(q.missTip)}</p>
        ${twoMiss ? '<p class="tip">Two misses in a row, so your next Find Do round plays Do for you to copy.</p>' : ''}
        <div class="row"><button class="btn" data-act="replay" data-part="model">${esc(q.missLabel)}</button>${heard && A.micOn ? '<button class="btn" data-act="singCopy">Copy it with the app</button>' : ''}</div>
        ${levelUpHTML()}${struggleHTML(q)}
        <div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>`;
    } else if (R.takeOffer && R.takeOffer.qid === q.id) {
      const t = R.mic && R.mic.take && R.mic.take.sent ? R.mic.take : null;
      controls = `<div class="mic-panel">
          <p class="mic-status">Not scored: the app may have misheard you.${t ? '' : ' Saving this take lets the grading be checked against your real voice.'}</p>
          ${t ? takeSentHTML(t) : ''}
          <div class="row">${t ? '' : `<button class="btn" data-act="takeSave" data-v="${R.takeOffer.v}" data-said="misheard">Save this take</button>`}<button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>
        </div>${levelUpHTML()}`;
    } else {
      controls = `${levelUpHTML()}<div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>`;
    }
    return `<div class="sing">${target}<p class="muted" style="max-width:60ch">${esc(q.subline)}</p>${after}${controls}</div>`;
  }
  // "Save this take": a small row under the grades; asking what the grade should have been first.
  function takeSentHTML(t) {
    return `<div class="take-row muted">Sent to your downloads as ${esc(t.sent)}. Not there?
      <button class="btn sm ghost" data-act="takeSave" data-v="${t.expect == null ? '' : t.expect}" data-said="${esc(t.said || '')}">Save again</button></div>`;
  }
  function takeRowHTML() {
    if (!takeHere()) return '';
    const t = R.mic.take;
    if (t && t.sent) return takeSentHTML(t);
    if (t && t.ask) {
      return `<div class="take-row" role="group" aria-label="What should the grade have been?"><span>What should the grade have been?</span>
        ${[[1, 'Matched'], [0.5, 'Close'], [0, 'Missed']].map(([v, l]) => `<button class="btn sm" data-act="takeSave" data-v="${v}">${l}</button>`).join('')}
        <button class="btn sm ghost" data-act="takeSave" data-v="">Not sure</button>
        <span class="muted">The file holds this answer's sound, the question, and the names of your browser and microphone.</span></div>`;
    }
    return `<div class="take-row"><button class="btn sm ghost" data-act="takeAsk">Save this take</button><span class="muted">If the grade looks wrong, save a recording of this answer to your computer, to check the grading against your real voice.</span></div>`;
  }
  // ----- sing: the microphone -----
  function micUnblockHint() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'In Safari, tap the aA button in the address bar, then Website Settings, and set Microphone to Allow.';
    if (/Firefox\//.test(ua)) return 'Click the permissions icon at the left of the address bar and remove the block on the microphone.';
    if (/Edg\/|Chrome\//.test(ua)) return 'Click the site controls at the left of the address bar and set Microphone to Allow.';
    if (/Safari\//.test(ua)) return 'In Safari, choose Settings, then Websites, then Microphone, and set this site to Allow.';
    return 'Allow the microphone for this site in the browser’s settings.';
  }
  const MIC_ERR = {
    blocked: () => `The browser blocked the microphone, so you check yourself. To use it: ${micUnblockHint()} Then turn it on again in Settings.`,
    dismissed: () => 'The microphone request was closed, so you check yourself this set. The app asks again next set.',
    system: () => 'Your computer’s privacy settings keep this browser from the microphone. Allow it in System Settings, Privacy & Security, Microphone, then reload the page.',
    framed: () => 'The microphone is not available in this copy of Tone Ladder, so you check yourself. It works at noaware.io/tone-ladder/.',
    none: () => 'No microphone was found, so you check yourself this set.',
    busy: () => 'Another app is using the microphone, so you check yourself this set.',
    other: () => 'The microphone could not start, so you check yourself this set.',
  };
  // Shown in place of a question while the mic is being set up.
  function micGateHTML() {
    const g = R.micGate;
    const skip = `<button class="btn ghost" data-act="micSkipSet">${R.micFor === 'melody' ? 'Skip singing this set' : R.micFor === 'rhythm' ? 'Tap instead this set' : 'Check myself this set'}</button>`;
    let h2, body, actions;
    if (g === 'ask') {
      h2 = 'Let the app hear you?';
      body = `<p class="lede" style="margin-top:0">${R.micFor === 'melody' ? 'In dictation the app can listen while you sing each melody back before you name its notes. The echo is checked, not scored.' : R.micFor === 'rhythm' ? 'In rhythm questions the app can hear your claps through the microphone, so you can clap a rhythm instead of tapping it. Keep quiet during the get-ready clicks: that is when it measures the room.' : 'In singing questions the app can listen through your microphone and suggest the grade. It is stricter than your own ear, so Missed is normal at first.'}</p>
        <p class="muted">The sound is analysed on this device as you ${R.micFor === 'rhythm' ? 'clap' : 'sing'} and is never sent anywhere. Only the current answer is kept, in memory until the next question, so you can save it to your computer if a grade looks wrong. Your browser shows a microphone light during ${R.micFor === 'rhythm' ? 'rhythm' : R.micFor === 'melody' ? 'dictation' : 'singing'} sets, and it goes off when the set ends. You can change this in Settings.</p>`;
      actions = `<button class="btn primary lg" data-act="micYes">Use the microphone <kbd>Enter</kbd></button><button class="btn ghost" data-act="micNo">${R.micFor === 'melody' ? 'Not now' : R.micFor === 'rhythm' ? 'Tap instead' : 'I’ll check myself'}</button>`;
    } else if (g === 'start') {
      h2 = R.micFor === 'melody' ? 'Sing it back first' : R.micFor === 'rhythm' ? 'Clap the rhythm' : 'Ready to sing';
      body = R.micFor === 'melody'
        ? '<p class="lede" style="margin-top:0">After each melody plays, sing it back. The app checks the echo, and then you name the notes. Hearing, holding and singing a tune is the path from your head to the page.</p>'
        : R.micFor === 'rhythm'
          ? '<p class="lede" style="margin-top:0">The app listens for your claps through the microphone during this set; tapping still works too. Keep quiet during the get-ready clicks: that is when it measures the room.</p>'
          : '<p class="lede" style="margin-top:0">The app listens through your microphone during this set.</p>';
      actions = `<button class="btn primary lg" data-act="micYes">Start <kbd>Enter</kbd></button>${skip}`;
    } else if (g === 'opening') {
      h2 = 'Opening the microphone';
      body = `<p class="lede" style="margin-top:0">Your browser may ask first.</p>${R.micSlow ? '<p class="tip">Still waiting. Look for the microphone request near the address bar.</p>' : ''}`;
      actions = `<button class="btn primary lg" disabled>Opening… <kbd>Enter</kbd></button>${skip}`;
    } else if (g === 'tap') {
      h2 = 'Tap to continue';
      body = '<p class="lede" style="margin-top:0">The microphone is on. Tap so your browser lets the sound play.</p>';
      actions = '<button class="btn primary lg" data-act="micTap">Continue <kbd>Enter</kbd></button>';
    } else {
      h2 = 'Checking yourself';
      body = `<p class="lede" style="margin-top:0">${esc((MIC_ERR[R.micErr] || MIC_ERR.other)())}</p>`;
      actions = '<button class="btn primary lg" data-act="micContinue">Continue <kbd>Enter</kbd></button>';
    }
    return `<div class="between mic-gate"><p class="eyebrow">${R.micFor === 'melody' ? 'Dictation set' : R.micFor === 'rhythm' ? 'Rhythm set' : 'Singing set'}</p><h2>${h2}</h2>${body}<div class="row">${actions}</div></div>`;
  }
  // the line under the meter, from what the listener reports
  function micLine(q, st) {
    const m = R.mic;
    const hold = m.kind === 'hold';
    const along = q.practice && q.model && (q.copy || isFindDo(q));
    if (R.mainEnd == null || A.playing()) {
      if (along) return 'Sing along, then sing it once more on your own when it stops.';
      if (R.mainEnd != null) return 'Listen. Sing when it stops.';
      if (q.intervalName) return `Listen to the note. When it stops, sing it, then the ${q.intervalName} it.`;
      if (singBack(q) && q.voice) return `Listen to the two voices. Sing back the ${q.voice === 'bass' ? 'bass, the lower voice' : 'top voice'} when they end.`;
      return q.echoAnswer || singBack(q) ? 'Listen to the chords, then the melody. Sing it back when it ends.' : 'Listen to the chords. Sing when they stop.';
    }
    if (m.state === 'quiet') return 'I can’t hear you yet. Sing out loud and closer to the microphone.';
    if (m.state === 'missed') {
      const again = m.nulls >= 1 ? (singBack(q) ? ' Or press Done again to skip the echo.' : ' Or press Done again to check yourself.') : '';
      if (hold) return (m.reason === 'short' ? 'That was short. Sing it again and hold it for a second or two.' : 'I didn’t hear a held note. Sing it out loud and hold it.') + again;
      return 'I didn’t catch the notes. Sing them again, a little louder.' + again;
    }
    if (!st || !st.heard) return hold ? (q.bassAnswer ? 'Sing or hum the lowest note and hold it. Stop when you are done.' : q.chordTone ? `Sing the chord’s ${q.chordTone} and hold it. Stop when you are done.` : q.intervalName ? `Sing the given note, then the ${q.intervalName} it, and hold that. Stop when you are done.` : 'Sing it on its name and hold it. Stop when you are done.') : 'Sing the notes. Stop when you are done.';
    return hold && st.held >= 1 ? 'Holding a note. Stop when you are done.' : 'Hearing you…';
  }
  function micPanelHTML(q) {
    const m = R.mic;
    const self = `<button class="btn ghost" data-act="micSkipSet">${singBack(q) ? 'Skip singing this set' : 'Check myself instead'}</button>`;
    if (m.state === 'paused') {
      const why = { muted: 'The microphone is paused by the browser or another app.', ended: 'The microphone was disconnected.' }[m.pause] || 'The microphone paused while the sound was interrupted or the page was in the background.';
      return `<div class="mic-panel"><p class="mic-status">${esc(why)}</p><div class="row"><button class="btn primary" data-act="micResume">Listen again <kbd>Enter</kbd></button>${self}</div></div>`;
    }
    const info = A.micInfo();
    const notes = [];
    if (info && info.settings && (info.settings.echoCancellation === true || info.settings.noiseSuppression === true)) notes.push('This browser keeps its own noise filter on, so long notes may fade. If the grades look wrong, check yourself.');
    if (info && info.bluetooth) notes.push('With a Bluetooth headset the music sounds like a phone call while the app listens. The speaker or wired headphones sound better.');
    if (info && info.label && m.state === 'quiet') notes.push(`Listening with: ${info.label}.`);
    return `<div class="mic-panel">
      <div class="mic-meter" id="micMeter" aria-hidden="true"><i></i></div>
      <p class="mic-status" id="micStatus" aria-live="polite">${esc(micLine(q, null))}</p>
      <div class="row"><button class="btn primary" data-act="micDone"${R.mainEnd == null ? ' disabled data-needs-main' : ''}>Done <kbd>Enter</kbd></button>${self}${m.state === 'missed' && takeHere() && !(m.take && m.take.sent) ? '<button class="btn ghost" data-act="takeSave" data-v="" data-said="not-heard">Save this take</button>' : ''}</div>
      ${m.state === 'missed' && m.take && m.take.sent ? takeSentHTML(m.take) : ''}
      ${notes.map((n) => `<p class="muted" style="font-size:13px">${esc(n)}</p>`).join('')}
    </div>`;
  }
  // live meter and status while listening, written straight to the DOM (a re-render would flicker)
  function meterMic(p, st) {
    const bar = $('#micMeter');
    if (bar) { bar.style.setProperty('--lv', Math.max(0, Math.min(1, p.level || 0)).toFixed(3)); bar.classList.toggle('voiced', !!p.voiced); }
    const m = R.mic;
    if ((m.state === 'quiet' || m.state === 'missed') && st.heard && p.voiced) m.state = 'listening';
    const el = $('#micStatus');
    if (!el) return;
    const txt = micLine(R.q, st);
    if (el.textContent !== txt) el.textContent = txt;
  }
  // A note's name, only once Scale Degrees has taught it; otherwise null.
  function knownName(semi) {
    const id = TL.degBySemi(semi).id;
    return id === '1' || learnedDegrees().has(id) ? degText(id).main : null;
  }
  // What the app heard, in words (what was right first), then the pitch trace for anything short of Matched.
  function micResultHTML(q, res, opts = {}) {
    const tg = singTarget(q);
    const blind = !!opts.blind; // a dictation echo before the notes are named: no note names, no trace
    const v = res.v;
    const head = v === 1 ? 'Matched' : v === 0.5 ? 'Close' : 'Missed';
    let line = '';
    let marks = '';
    if (tg.kind === 'hold' && q.singSemi != null) {
      const notes = res.notes || [];
      const n = notes[Number.isInteger(res.graded) ? res.graded : notes.length - 1];
      const off = n ? n.off : 0, low = off < 0;
      const ivName = (semi) => { const iv = TL.INTERVALS.find((x) => x.semi === TL.mod12(semi)); return iv ? iv.name : null; };
      if (v === 1) line = `You sang the ${q.intervalName}.${Math.abs(off) >= 25 ? ` A little ${low ? 'low' : 'high'}, but clearly it.` : ''}`;
      else if (v === 0.5 && res.reason === 'octave') line = `The right note, but an octave away: ${TL.an(q.intervalName)} ${q.intervalName} lands ${n && n.cents / 100 > q.singSemi ? 'lower' : 'higher'} than that.`;
      else if (v === 0.5) line = `Near the ${q.intervalName}, but ${low ? 'low' : 'high'}, between it and the next note.`;
      else if (n) {
        // the sung distance, whichever way it went, within an octave (0 with a note sung: the octave itself)
        const size = TL.mod12(Math.abs(n.semi)) || (n.semi ? 12 : 0);
        const sung = size ? ivName(size) : null;
        const wrongWay = n.semi !== 0 && (n.semi > 0) !== (q.singSemi > 0);
        if (wrongWay) line = `${sung ? `You sang ${TL.an(sung)} ${sung}` : 'You sang a note'}, going ${n.semi > 0 ? 'up' : 'down'}; the ${q.intervalName} goes ${q.singSemi > 0 ? 'up' : 'down'}.`;
        else line = `${sung ? `You sang ${TL.an(sung)} ${sung}` : 'You sang the given note back'}. The ${q.intervalName} is ${Math.abs(q.singSemi) > size ? 'larger' : 'smaller'} than that.`;
      }
    } else if (tg.kind === 'hold') {
      const want = degText(TL.degBySemi(tg.semis[0]).id).main;
      const notes = res.notes || [];
      const gi = Number.isInteger(res.graded) ? res.graded : notes.length - 1;
      const n = notes[gi];
      const off = n ? n.off : 0;
      const low = off < 0;
      if (res.reason === 'slid') line = `You reached ${want}, but slid into it. Hear it inside first, then start right on it.`;
      else if (res.reason === 'wobble') line = `You found ${want}, but your voice wavered. Try a steady “loo”.`;
      else if (v === 1) line = `You sang ${want}.${Math.abs(off) >= 25 ? ` A little ${low ? 'low' : 'high'}, but clearly ${want}.` : ''}`;
      else if (v === 0.5) line = `Near ${want}, but ${low ? 'low' : 'high'}: between ${want} and the note ${low ? 'below' : 'above'} it.`;
      else if (n) {
        const pc = TL.mod12(n.semi), want0 = TL.mod12(tg.semis[0]);
        const name = knownName(n.semi);
        const d = TL.mod12(want0 - pc);
        const dir = d === 6 ? 'six half steps away' : d < 6 ? 'higher' : 'lower';
        if (q.bassAnswer && TL.rnPcs(q.item).includes(pc)) line = `You sang a note of the chord${name ? ` (${name})` : ''}, but not its lowest: the bass was ${want}. Listen underneath it.`;
        else if (q.bassAnswer) line = `${name ? `You sang ${name}.` : 'You sang a different note.'} The bass was ${want}, ${dir}.`;
        else if (q.chordRn && TL.rnPcs(q.chordRn).includes(pc)) line = `You sang a note of the chord${name ? ` (${name})` : ''}, but not its ${q.chordTone}: that was ${want}. Hear it note by note from the bottom.`;
        else if (q.chordRn) line = `${name ? `You sang ${name}.` : 'You sang a different note.'} The ${q.chordTone} was ${want}, ${dir}.`;
        else if (want0 === 0 && (pc === (q.mode === 'minor' ? 3 : 4) || pc === 7)) line = `You sang another note of the home chord${name ? ` (${name})` : ''}. Do is the one the chords come to rest on.`;
        else line = `${name ? `You sang ${name}.` : 'You sang a different note.'} ${want} is ${dir}.`;
        // the hummed steps tell a key-finding slip from a stepping one
        const first = notes[0];
        if (q.stepped && want0 !== 0 && gi > 0 && first && TL.mod12(first.semi) !== 0) line += ` Your first note was ${knownName(first.semi) || 'not Do'}: find Do from the chords before you step.`;
      }
    } else {
      const steps = res.steps || [];
      const right = steps.filter((x) => x.ok).length;
      const way = (res.offset || 0) < 0 ? 'low' : 'high';
      if (res.reason === 'transposed') line = q.staff ? 'The shape was right, but it started on the wrong note: Do was lost. Hear Do from the chords (Play Do helps), then count from it to the first note.' : 'The tune was right, but it started on the wrong note. Find Do from the chords first.';
      else if (res.reason === 'offset') line = `Every note was in place, but the whole tune sat ${way} against the key, nearly between notes. Hum Do from the chords before you start.`;
      else if (res.reason === 'drift') line = `The tune was right, but it drifted ${res.drift < 0 ? 'lower' : 'higher'} as you went. Keep Do in your ear.`;
      else if (v === 1) line = `Every note right.${Math.abs(res.offset || 0) >= 25 ? ` The whole tune sat a little ${way}.` : ''}`;
      else line = `${right} of ${tg.semis.length} notes right${res.extra ? `, and ${res.extra === 1 ? 'one extra note' : res.extra + ' extra notes'}` : ''}.${res.reason === 'restart' ? ' You started again, so this counts as Close at most.' : ''}`;
      if (!blind) marks = `<div class="pattern mic-steps">${steps.map((x, i) => {
        const id = TL.degBySemi(x.want).id;
        // a note not met yet is described by direction instead of by name
        const dir = x.got == null ? '' : ((TL.mod12(x.got - x.want) + 6) % 12) - 6 > 0 ? 'you: higher' : 'you: lower';
        const got = x.ok ? '' : `<small>${x.got == null ? 'missing' : knownName(x.got) ? 'you: ' + esc(knownName(x.got)) : dir}</small>`;
        return `<span data-deg="${id}" data-i="${i}" class="${x.ok ? 'ok' : 'bad'}" style="--h:${DEG[id].hue}">${esc(degText(id).main)}${got}</span>`;
      }).join('')}</div>`;
    }
    const m = R.mic || {};
    const bias = m.bias ? `<p class="tip">Your held notes tend to sit a little ${m.bias}. Breathe low and aim a touch ${m.bias === 'low' ? 'higher' : 'lower'}.</p>` : '';
    const range = m.rangeTip ? `<p class="tip">You keep singing an octave ${m.rangeTip.dir} where the app plays. The singing range “${esc(m.rangeTip.to)}” may fit your voice better: Settings, Singing range.</p>` : '';
    const guess = m.guessFirst && m.guess != null ? `<p class="mic-guess">You said <strong>${GRADE_NAME[m.guess]}</strong>; the app heard <strong>${head}</strong>.${m.guess === v ? ' Your ear agrees with it.' : ''}</p>` : '';
    return `<div class="mic-result v${String(v).replace('.', '')}">
      ${guess}<p class="mic-verdict"><strong>${head}.</strong> ${esc(line)}</p>${bias}${range}
      ${marks}${blind || (v === 1 && !res.reason?.match(/drift|slid|wobble/)) || q.singSemi != null ? '' : micTraceSVG(tg, res)}
    </div>`;
  }
  // The singing against the target notes, folded to the targets' octave: each note as a bold bar
  // at its middle pitch, over a faint line of the raw pitch.
  function micTraceSVG(tg, res) {
    const pts = (res.trace || []).filter((p) => p.cents != null);
    if (pts.length < 3) return '';
    const want = tg.semis.map((x) => x * 100);
    const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const ns = res.notes || [];
    const g = tg.kind === 'hold' ? ns[Number.isInteger(res.graded) ? res.graded : ns.length - 1] : null;
    const k = g ? Math.round((want[0] - g.cents) / 1200) : Math.round((med(want) - med(pts.map((p) => p.cents))) / 1200);
    const fold = (c) => c + 1200 * k;
    const ys = pts.map((p) => fold(p.cents));
    const near = ys.filter((y) => Math.abs(y - med(want)) < 1500);
    const lo = Math.floor((Math.min(...want, ...near) - 150) / 100);
    const hi = Math.ceil((Math.max(...want, ...near) + 150) / 100);
    const t0 = pts[0].t, t1 = Math.max(t0 + 0.5, pts[pts.length - 1].t);
    const W = 480, H = Math.max(120, Math.min(260, (hi - lo) * 16)), L = 40; // 16 per semitone: Ti and Do labels clear
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - 6);
    const Y = (c) => H - 6 - ((c / 100 - lo) / (hi - lo)) * (H - 12);
    const wantPcs = new Set(tg.semis.map(TL.mod12));
    let lanes = '';
    for (let x = lo; x <= hi; x++) {
      const d = TL.degBySemi(x);
      if (!d.diatonic && !wantPcs.has(TL.mod12(x))) continue;
      const isT = wantPcs.has(TL.mod12(x));
      const y = Y(x * 100).toFixed(1);
      lanes += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" class="${isT ? 'tgt' : ''}" style="--h:${d.hue}"/><text x="${L - 6}" y="${(+y + 4).toFixed(1)}" class="${isT ? 'tgt' : ''}">${esc(degText(d.id).main)}</text>`;
    }
    let path = '', last = null;
    pts.forEach((p, i) => {
      const y = ys[i];
      const gap = !last || p.t - last.t > 0.12 || Math.abs(y - last.y) > 250;
      path += `${gap ? 'M' : 'L'}${X(p.t).toFixed(1)} ${Y(y).toFixed(1)} `;
      last = { t: p.t, y };
    });
    const bars = (res.notes || []).filter((n) => n.t1 > n.t0).map((n) => {
      const y = Y(fold(n.cents)).toFixed(1);
      return `<line class="note" x1="${X(n.t0).toFixed(1)}" x2="${X(n.t1).toFixed(1)}" y1="${y}" y2="${y}"/>`;
    }).join('');
    return `<svg class="mic-trace" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your pitch over time, against the target notes">${lanes}<path d="${path.trim()}"/>${bars}</svg>`;
  }

export { meterMic, micGateHTML, micPanelHTML, micResultHTML, micUnblockHint, sightStaffSVG, singHTML, takeRowHTML };
