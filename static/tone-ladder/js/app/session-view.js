/* Tone Ladder — the session screen: header, stage, the question frame, introductions, between sets, the summary. */
import { $, A, CUR, DEG, S, TL, TRACK, degText, esc, fmtNum, itemName, pct, rnHue } from './base.js';
import { R } from './state.js';
import { choiceBodyHTML, feedbackHTML, rhythmStaff, seqBodyHTML } from './answer-view.js';
import { singBack } from './mic.js';
import { renderRhythmState, rhythmHTML } from './rhythm.js';
import { block, levelFor, pillLabel } from './session.js';
import { micGateHTML, micPanelHTML, micResultHTML, sightStaffSVG, singHTML, takeRowHTML } from './sing-view.js';
import { toGoShort } from './today.js';

  // ======================================================================
  // SESSION RENDERING
  // ======================================================================
  function renderSession() {
    const v = $('#view');
    if (!R) return;
    v.innerHTML = `<div class="session">${sessionHead()}<div class="stage" id="stage"></div></div>`;
    renderStage();
  }
  function sessionHead() {
    const b = block();
    const trackId = R.q ? R.q.track : R.intro && R.phase === 'intro' ? R.intro.trackId : b && b.track !== 'mix' ? b.track : null;
    const tr = trackId ? TRACK[trackId] : null;
    const L = R.q ? R.q.level : R.phase === 'intro' ? R.intro.L : b && tr ? levelFor(b) : 0;
    const role = b ? b.role : 'Session';
    const done = b ? b.done : 0, count = b ? b.count : 0;
    const showProgress = R.phase !== 'summary';
    return `<header class="s-head">
      <button class="icon-btn" data-act="exitSession" aria-label="End session" title="End session"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
      <div class="s-title">${R.phase === 'summary' ? '<strong>Session complete</strong>' : `<span class="s-role">${esc(role)}${b && b.track === 'mix' ? ' · shuffled' : ''}</span><strong>${tr ? esc(tr.name) : 'Everything so far'}</strong>${tr ? `<span class="s-level">Level ${L + 1} · ${esc(tr.levels[L].name)}</span>` : ''}${tr && L === S.track(trackId).level && !(b && b.pool) && toGoShort(trackId) ? `<span class="s-togo">${esc(toGoShort(trackId))}</span>` : ''}`}</div>
      ${showProgress ? `<div class="s-progress">
        ${R.plan.length > 1 ? `<div class="blocks-dots" aria-hidden="true">${R.plan.map((x, i) => `<i class="${i < R.bi ? 'done' : i === R.bi ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        <div class="meter"><span style="width:${count ? (done / count) * 100 : 0}%"></span></div>
        <span class="count">${done} / ${count}</span>
      </div>` : '<div></div>'}
    </header>`;
  }
  function refreshHead() {
    const head = $('.s-head');
    if (head) head.outerHTML = sessionHead();
  }

  function renderStage() {
    const st = $('#stage');
    if (!st || !R) return;
    if (R.phase === 'intro') st.innerHTML = introHTML();
    else if (R.phase === 'between') st.innerHTML = betweenHTML();
    else if (R.phase === 'mic') st.innerHTML = micGateHTML();
    else if (R.phase === 'summary') st.innerHTML = summaryHTML();
    else if (R.q) st.innerHTML = questionHTML();
    refreshHead();
    if (R.q && R.q.kind === 'tap') renderRhythmState();
  }

  const DEG_TIP_END = ' If it sounds completely at rest, it is Do. If not, feel which way it wants to move to get home.';
  const TIPS = {
    degrees: (q) => q.listenTip || ((q.drone
      ? 'The drone is the low, steady sound under the question. Its strongest note is Do, the home note; a quieter Sol sits above it. Hum Do at any height that suits your voice, then hum the new note.'
      : q.withContext
        ? 'The chords end on Do, the home note: it is the top note of the last chord and its bottom note too. Hum it, then hum the new note.'
        : 'The chords played when the key last changed. Hum the Do you remember, then hum the new note.') + DEG_TIP_END),
    intervals: (q) => 'Sing both notes, low to high. Call the lower one Do and sing up the scale (Do, Re, Mi…) until you reach the higher one. The number of notes you sang is the number in the name. If the higher note falls between two scale notes (you overshoot it as you sing up), the interval is the minor one: between Re and Mi is a minor 3rd.'
      + (q.options.some((o) => o.id === 'TT') ? ' Halfway between Fa and Sol is the tritone.' : ''),
    chords: 'Listen for the overall color first: bright or dark, tense or floating. Press Note by note to hear the notes one at a time.',
    harmony: (q) => q.listenTip,
    melody: (q) => (q.voice ? `Sing the ${q.voice === 'bass' ? 'bass' : 'top voice'} back once before you answer.` : 'Sing the melody back once before you answer.') + ' Then name each note by how it sits against Do.',
    sing: '',
  };

  function questionHTML() {
    const q = R.q;
    const keyLine = q.tonic != null && TRACK[q.track].usesKey && !q.hideKey && !(q.keyHidden && R.phase === 'answering') ? `<p class="q-key">Key of <b>${esc(TL.keyName(q.tonic, q.mode || 'major'))}</b>${q.keyChanged && R.qid > 1 ? ' · <span class="new">new key: Do has moved</span>' : ''}${q.drone ? ' · drone' : ''}</p>` : '';
    // in singing questions, extra sounds wait until the chords finish, so a click cannot cut them off
    const wait = (r) => q.kind === 'sing' && r.part !== 'main' && R.mainEnd == null && R.phase === 'answering';
    const replays = (q.replays || []).map((r) => `<button class="btn sm" data-act="replay" data-part="${r.part}"${wait(r) ? ' disabled data-needs-main' : ''}>${esc(r.label)}${r.key ? ' <kbd>Space</kbd>' : ''}</button>`).join('');
    const top = `<div class="q-top"><p class="q-prompt">${esc(q.prompt)}</p>${keyLine}</div>`;
    const sounding = A.playing();
    const listen = `<span class="listen-state${sounding ? '' : ' idle'}" id="listenState"><i class="pulse"></i><span>${pillLabel(sounding)}</span></span>`;
    if (q.kind === 'tap') return top + rhythmHTML();
    if (q.kind === 'sing') return top + `<div class="q-replays">${replays}${listen}</div>` + singHTML();
    let echo = '';
    if (R.mic && singBack(q) && R.phase === 'answering') {
      echo = R.mic.state === 'heard' ? `<div class="sing echo">${micResultHTML(q, R.mic.result, { blind: true })}${takeRowHTML()}</div>` : R.mic.state !== 'off' ? `<div class="sing echo">${micPanelHTML(q)}</div>` : '';
    }
    const body = q.kind === 'choice' ? choiceBodyHTML() : seqBodyHTML();
    return `${top}<div class="q-replays">${replays}${listen}</div>${echo}<div class="q-body">${body}<div id="fb">${feedbackHTML()}</div></div>`;
  }

  // ----- intro -----
  // "1 2 3 4" under a rhythm: bold where a note starts, plain while it rings, bracketed through rests.
  function countLine(r) {
    const step = r.meter === '6/8' ? 6 : 12;
    const out = [];
    let pos = 0;
    for (const t of r.ticks) {
      const len = Math.abs(t);
      const inner = [];
      for (let p = Math.ceil((pos + 1) / step) * step; p < pos + len; p += step) inner.push(p);
      if (t > 0) {
        out.push(`<b style="color:var(--ink)">${esc(TL.countLabel(pos, r))}</b>`);
        inner.forEach((p) => out.push(`<span>${esc(TL.countLabel(p, r))}</span>`));
      } else {
        out.push(`<span>(${esc(TL.countLabel(pos, r))})</span>`);
        inner.forEach((p) => out.push(`<span>(${esc(TL.countLabel(p, r))})</span>`));
      }
      pos += len;
    }
    return `<p class="muted" style="font-family:var(--f-mono);font-size:14px;word-spacing:4px">${out.join(' ')}</p>`;
  }
  function introHTML() {
    const { trackId, L, data } = R.intro;
    const tr = TRACK[trackId];
    const degLike = trackId === 'degrees' || trackId === 'melody' || trackId === 'sing';
    const cards = data.cards.map((c, ci) => {
      const did = c.deg || c.id;
      const hue = degLike ? (DEG[did] ? DEG[did].hue : tr.hue) : trackId === 'harmony' ? rnHue(c.id) : tr.hue;
      const named = (trackId === 'degrees' || trackId === 'sing') && DEG[c.id];
      const title = named ? degText(c.id).main : c.title;
      const sub = named ? degText(c.id).sub || '' : c.sub || '';
      const demos = c.rhythm
        ? `<button class="btn sm" data-act="introRhythm" data-card="${ci}">Hear it</button>`
        : c.demos.map((d, di) => `<button class="btn sm" data-act="demo" data-card="${ci}" data-demo="${di}">${esc(d.label)}</button>`).join('');
      const hint = c.hintKey ? `<label>Optional: know a song with this jump? Type its name. It will show after each answer for this interval${c.hasSong ? ', in place of the song above' : ''}.<input type="text" id="hint-${esc(c.hintKey)}" data-hint="${esc(c.hintKey)}" value="${esc(c.hint)}" placeholder="Song name" maxlength="80"></label>` : '';
      let counts = c.rhythm ? countLine(c.rhythm) + rhythmStaff(c.rhythm) : '';
      if (c.staff && TL.Notation) try { counts = `<div class="score sight-staff">${sightStaffSVG(c.staff, c.staff.ids.map((id) => degText(id).main), [], Math.min(420, Math.max(280, window.innerWidth - 64)))}</div>`; } catch (e) { /* the card reads without it */ }
      return `<div class="icard deg" style="--h:${hue || tr.hue}">
        <h3 class="${trackId === 'harmony' || !degLike || !DEG[did] ? 'rn' : ''}">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h3>
        ${c.text ? `<p>${esc(c.text)}</p>` : ''}${counts}
        <div class="row">${demos}</div>
        ${c.sing ? `<p class="singtip">${esc(c.sing)}</p>` : ''}${hint}
      </div>`;
    }).join('');
    const demos = data.demos.map((d, di) => `<button class="btn" data-act="demo" data-card="-1" data-demo="${di}">${esc(d.label)}</button>`).join('');
    const hasCounts = data.cards.some((c) => c.rhythm);
    const range = data.rangePicker ? `<label class="field" style="max-width:420px">Your singing range. The app plays Do at this height. Too low or too high to hum? Change it:
        <select id="introVoice" data-pref="voice">${CUR.VOICE_LABELS.map(([v, l]) => `<option value="${v}" ${S.settings.voice === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <span class="muted" style="font-weight:400">You can change this later in Preferences.</span></label>` : '';
    return `<div class="intro">
      <div><p class="eyebrow">${esc(tr.name)} · Level ${L + 1} of ${tr.levels.length}</p><h2 style="margin-top:8px">${esc(data.title)}</h2></div>
      ${data.note ? `<p class="note">${esc(data.note)}</p>` : ''}
      ${cards ? `<div class="intro-cards">${cards}</div>` : ''}
      ${hasCounts ? '<p class="muted" style="font-size:13.5px">Tap on the bold counts. Counts in brackets are rests: keep counting, do not tap.</p>' : ''}
      ${demos ? `<div class="row">${demos}</div>` : ''}
      ${range}
      <p class="muted" style="max-width:62ch">${esc(tr.introFooter || 'Listen to each sound a few times and sing it before you start. Recognizing comes from hearing first, then naming.')}</p>
      <div class="row"><button class="btn primary lg" data-act="startLevel">Start <kbd>Enter</kbd></button></div>
    </div>`;
  }

  function betweenHTML() {
    let pi = R.bi - 1;
    while (pi > 0 && !R.plan[pi].played && !R.plan[pi].skipped) pi--;
    const prev = R.plan[pi];
    const b = block();
    const prevName = prev.track === 'mix' ? 'Mixed review' : TRACK[prev.track].name;
    const prevScore = prev.skipped || !prev.sn && !prev.played ? 'skipped' : prev.sn ? pct(prev.score / prev.sn) : 'practice rounds only';
    const next = b.track === 'mix'
      ? '<p class="lede" style="margin-top:0">Next: <strong>Mixed review</strong>. Questions from the tracks you have practiced, except the singing tracks, shuffled.</p>'
      : `<p class="lede" style="margin-top:0">Next: <strong>${esc(b.role)}</strong>, ${esc(TRACK[b.track].name)}. Level ${levelFor(b) + 1} · ${esc(TRACK[b.track].levels[levelFor(b)].name)}.</p>
         <p class="muted">${esc(TRACK[b.track].levels[levelFor(b)].task || (TRACK[b.track].taskFor && TRACK[b.track].taskFor(S.settings)) || TRACK[b.track].task)}</p>`;
    return `<div class="between">
      <p class="eyebrow">Set ${R.bi} of ${R.plan.length} done</p>
      <h2>${esc(prevName)}: ${prevScore}</h2>
      ${next}
      <div class="row"><button class="btn primary lg" data-act="continueBlock">Continue <kbd>Enter</kbd></button><button class="btn ghost" data-act="skipBlock">Skip this set</button></div>
    </div>`;
  }

  function summaryHTML() {
    const mins = Math.max(1, Math.round((Date.now() - R.started) / 60000));
    const acc = R.sn ? R.score / R.sn : 0;
    const blocks = R.plan.filter((b) => b.done > b.done0).map((b) => `<li><span>${esc(b.role)}${b.track === 'mix' ? '' : ' · ' + esc(TRACK[b.track].name)}</span><span class="sc">${b.done - b.done0} q · ${b.sn ? pct(b.score / b.sn) : 'practice'}</span></li>`).join('');
    const ups = R.levelUps.map((u) => `<li><span><strong>${esc(TRACK[u.track].name)}</strong> reached level ${u.to + 1}: ${esc(TRACK[u.track].levels[u.to].name)}</span><span class="sc">level up</span></li>`).join('');
    const weak = Object.values(R.itemsSession).filter((s) => s.n >= 2 && s.c / s.n < 0.75).sort((a, b) => a.c / a.n - b.c / b.n).slice(0, 4);
    const weakHTML = weak.map((s) => `<li><span>${esc(TRACK[s.track].short)}: ${esc(itemName(s.track, s.item))}</span><span class="sc">${fmtNum(s.c)} / ${s.n}</span></li>`).join('');
    return `<div class="between" style="max-width:720px">
      <p class="eyebrow">${R.early ? 'Session ended early' : 'Session complete'}</p>
      <h2>${acc >= 0.9 ? 'Strong work' : acc >= 0.7 ? 'Good session' : 'Good practice'}</h2>
      <div class="stat-row">
        <div class="stat"><div class="v num">${R.answered}</div><div class="l">questions</div></div>
        <div class="stat"><div class="v num">${R.sn ? pct(acc) : '–'}</div><div class="l">accuracy${R.answered > R.sn ? ', practice rounds left out' : ''}</div></div>
        <div class="stat"><div class="v num">${mins}</div><div class="l">minutes</div></div>
        <div class="stat"><div class="v num">${S.streak()}</div><div class="l">day streak</div></div>
      </div>
      ${ups ? `<div><p class="eyebrow" style="margin-bottom:8px">Level ups</p><ul class="result-list">${ups}</ul></div>` : ''}
      ${blocks ? `<div><p class="eyebrow" style="margin-bottom:8px">Sets</p><ul class="result-list">${blocks}</ul></div>` : ''}
      ${weakHTML ? `<div><p class="eyebrow" style="margin-bottom:8px">Worth another listen</p><ul class="result-list">${weakHTML}</ul></div>` : ''}
      <p class="muted">${S.blocked ? 'This session was not saved: a newer version of Tone Ladder saved your progress elsewhere. Reload the page to update.' : !R.sn ? 'Practice rounds are not scored. Your progress is saved.' : acc < 0.7 ? 'Lower scores mean the questions are working at the edge of what you can hear. That is where learning happens.' : 'Progress is saved. Missed items will come back sooner in your next sessions.'}</p>
      <div class="row"><button class="btn primary lg" data-act="go" data-view="today">Done</button>${weak.length ? '<button class="btn lg" data-act="weakRound">Drill the weak spots</button>' : ''}</div>
    </div>`;
  }

export { TIPS, renderSession, renderStage };
