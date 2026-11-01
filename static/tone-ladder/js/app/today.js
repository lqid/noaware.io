/* Tone Ladder — the Today view. */
import { DEG, S, TL, TRACK, TRACKS, degText, deviceInfo, esc, fmtNum, itemName, pct, setDeviceInfo } from './base.js';
import { FREE_COUNT, buildDailyPlan, planLeft, planMinutes, savedPlan } from './plan.js';
import { render } from './router.js';
import { startSession } from './session.js';

  // ======================================================================
  // TODAY
  // ======================================================================
  // the notes Scale Degrees has taught so far
  function learnedDegrees() {
    const t = S.track('degrees');
    const levels = TRACK.degrees.levels;
    const learned = new Set();
    levels.slice(0, t.level).forEach((lv) => lv.items.forEach((i) => { if (DEG[i]) learned.add(i); }));
    const cur = levels[t.level];
    cur.items.forEach((i) => { if (DEG[i] && (!cur.introduce.includes(i) || t.complete)) learned.add(i); });
    return learned;
  }
  function ladderFigure() {
    const t = S.track('degrees');
    const levels = TRACK.degrees.levels;
    const learned = learnedDegrees();
    const cur = levels[t.level];
    const next = new Set(t.complete ? [] : cur.introduce.filter((i) => DEG[i] && !learned.has(i)));
    const order = ['1', '7', '6', '5', '4', '3', '2', '1'];
    const rung = (id, i) => {
      const cls = learned.has(id) ? 'learned' : next.has(id) ? 'next' : '';
      const d = degText(id);
      return `<div class="lad-rung ${cls}" data-deg="${id}" style="--h:${DEG[id].hue}"><span>${esc(i === 0 ? (S.settings.labels === 'numbers' ? '1 (high)' : 'High ' + d.main) : d.main)}</span><span class="n">${esc(DEG[id].num)}</span></div>`;
    };
    const chromY = { b7: 1, b6: 2, '#4': 3, b3: 5, b2: 6 };
    const chips = Object.entries(chromY).map(([id, i]) => {
      const cls = learned.has(id) ? 'learned' : next.has(id) ? 'learned' : '';
      return `<div class="lad-chip ${cls}" data-deg="${id}" style="--h:${DEG[id].hue}; top:${i * 34 + 32}px">${esc(degText(id).main)}</div>`;
    }).join('');
    const count = learned.size;
    return `<figure class="ladder-fig" aria-label="Scale degrees learned">
      <div class="lad"><div class="lad-rungs" style="gap:4px">${order.map(rung).join('')}</div><div class="lad-side">${chips}</div></div>
      <figcaption>${count ? `${count} of 12 scale degrees learned` : 'Your tone ladder fills in as you learn each scale degree'}${next.size ? ` · next: ${[...next].map((i) => degText(i).main).join(', ')}` : ''}</figcaption>
    </figure>`;
  }

  function masteryLine(id, m) {
    return TRACK[id].selfGraded
      ? `${fmtNum(m.correct)} points from the last ${m.n} rounds · ${m.need} to level up (Matched 1, Close ½)`
      : `${fmtNum(m.correct)} of the last ${m.n} right · ${m.need} of ${m.window} to level up`;
  }
  // "To level up: 4 more right answers · Fa: 2 more right · with some on another day"
  // What one counted answer is in each track: a question, or one chord, note or rhythm figure of a question.
  const UNIT = {
    harmony: ['right chord', 'right chords'], melody: ['right note', 'right notes'],
    rhythm: ['rhythm figure tapped right', 'rhythm figures tapped right'], sing: ['Matched round', 'Matched rounds'], sight: ['Matched round', 'Matched rounds'],
  };
  const unitOf = (id, n) => (UNIT[id] || ['right answer', 'right answers'])[n === 1 ? 0 : 1];
  function toGoText(id) {
    const g = S.toGo(id);
    if (g.complete) return '';
    const gateName = g.gate ? `${TRACK[g.gate.track].name} level ${g.gate.level + 1}` : '';
    if (!g.answers && !g.items.length) {
      if (g.needsDay) return `Ready. A right answer on another day confirms the level.${g.gate ? ` Then it moves on when you reach ${gateName}.` : ''}`;
      if (g.gate) return `Ready. It moves on when you reach ${gateName}.`;
      return 'Ready to level up with your next right answer.';
    }
    const parts = [];
    if (g.answers) parts.push(`${g.answers} more ${unitOf(id, g.answers)}`);
    g.items.slice(0, 2).forEach((x) => parts.push(`${itemName(id, x.item)}: ${x.more} more right`));
    if (g.items.length > 2) parts.push(`and ${g.items.length - 2} more new sounds, 3 right each`);
    return `${g.isLast ? 'To finish the track' : 'To level up'}: ${parts.join(' · ')}.${g.needsDay ? ' Answers must come from at least two days.' : ''}${g.gate ? ` Then it waits for ${gateName}.` : ''}`;
  }
  function toGoShort(id) {
    const g = S.toGo(id);
    if (g.complete) return '';
    if (g.answers) return id === 'harmony' || id === 'melody' ? `${g.answers} ${id === 'harmony' ? 'chords' : 'notes'} to level up` : `${g.answers} to level up`;
    if (g.items.length) return `${itemName(id, g.items[0].item)} needs ${g.items[0].more} more`;
    if (g.needsDay) return 'confirms on another day';
    return g.gate ? `waits for ${TRACK[g.gate.track].short} ${g.gate.level + 1}` : '';
  }
  function gateText(id, need) {
    const t = S.track(id);
    return `Level ${t.level + 2} opens when you reach ${TRACK[need.track].name} level ${need.level + 1} (${TRACK[need.track].levels[need.level].name}).`;
  }
  function trackCard(tr) {
    const t = S.track(tr.id);
    const unlocked = S.isUnlocked(tr.id);
    const lv = tr.levels[t.level];
    const m = S.mastery(tr.id);
    const gate = m.ready && S.nextNeeds(tr.id);
    const meta = t.complete ? '<span class="done-badge">All levels mastered.</span> Keep it fresh with review.'
      : gate ? esc(gateText(tr.id, gate))
        : m.n ? masteryLine(tr.id, m)
          : t.intro[t.level] ? 'Started' : 'Not started';
    return `<article class="tcard ${unlocked ? '' : 'locked'}" style="--h:${tr.hue}">
      <header><h3><span class="dot" aria-hidden="true"></span>${esc(tr.name)}</h3><span class="lvl">Level ${t.level + 1} of ${tr.levels.length}</span></header>
      <p class="lvname">${esc(lv.name)}</p>
      ${unlocked ? `<div class="meter" role="img" aria-label="Mastery ${pct(m.pct)}"><span style="width:${(t.complete ? 1 : m.pct) * 100}%"></span></div><p class="meta">${meta}</p>${!t.complete && (m.n || t.intro[t.level]) && !gate ? `<p class="meta togo">${esc(toGoText(tr.id))}</p>` : ''}`
        : `<p class="meta">Opens when you reach ${esc(S.prereqText(tr.id))}.</p>`}
      <div class="actions">
        ${unlocked ? `<button class="btn sm primary" data-act="practice" data-track="${tr.id}">Practice</button>` : ''}
        <button class="btn sm ghost" data-act="go" data-view="track" data-track="${tr.id}">Levels</button>
      </div>
    </article>`;
  }

  function planRow(b) {
    const finished = (b.done || 0) >= b.count;
    const cnt = b.skipped ? 'skipped' : finished ? `✓ ${b.count} q` : b.done ? `${b.done} / ${b.count} q` : `${b.count} q`;
    const cls = finished ? ' class="done"' : '';
    if (b.track === 'mix') return `<li${cls}><div class="what"><div class="role">${esc(b.role)}</div><div class="tname">Tracks you have practiced, shuffled</div></div><span class="cnt">${cnt}</span></li>`;
    const tr = TRACK[b.track];
    const t = S.track(b.track);
    return `<li${cls}><div class="what"><div class="role">${esc(b.role)}</div><div><span class="tname">${esc(tr.name)}</span> <span class="lv">· ${esc(tr.levels[t.level].name)}</span></div></div><span class="cnt">${cnt}</span></li>`;
  }

  function viewToday() {
    const saved = savedPlan();
    const resuming = planLeft(saved);
    const plan = resuming ? saved.blocks : buildDailyPlan();
    const left = plan.map((b) => ({ ...b, count: b.count - Math.min(b.done || 0, b.count) }));
    const day = S.today();
    const dayQ = S.dayQ(day);
    const goal = S.settings.dailyGoal;
    const met = dayQ >= goal;
    const streak = S.streak();
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    // a Home Screen copy on iOS has storage of its own, so the progress made in Safari is not here (elsewhere an installed copy shares the browser's)
    const installed = window.navigator.standalone === true;
    const welcome = !S.state.onboarded ? `
      <section class="welcome">
        <div>
          <p class="eyebrow">Start here</p>
          <h2>Hear music the way you write it</h2>
          ${installed ? '<p class="tip">Added to the Home Screen after practising in Safari? This copy starts fresh. In Safari, open Preferences and press Copy my progress, then paste it here under Preferences.</p>' : ''}
          <p>Tone Ladder trains your ear inside a key, the way composers think. Every key has a home note, called Do. The other notes are named by their place counting up from Do: Re, Mi, Fa, Sol, La, Ti, numbered 2 to 7. These names and numbers are called scale degrees. Questions that ask you to name or sing a note in the key start with four chords that set the key; musicians call this a cadence. You start with two notes, Do and Sol, and add one at a time. A new level opens only when the current one is solid.</p>
          <div class="row" style="margin-top:18px"><button class="btn" data-act="soundCheck">Play a sound check</button><button class="btn ghost" data-act="go" data-view="method">How the method works</button></div>
        </div>
        <ol>
          <li><strong>Use headphones</strong> or good speakers at a comfortable volume.</li>
          <li><strong>Sing.</strong> Hum each note before you answer. Singing is how hearing turns into thinking.</li>
          <li><strong>Little and often.</strong> Ten to fifteen minutes a day beats an hour once a week.</li>
          <li><strong>Take your time.</strong> Let the note settle in your ear, then answer. Speed comes later on its own.</li>
        </ol>
      </section>` : '';
    const whatsNew = S.state.onboarded && !S.state.seen.v2 ? `
      <section class="welcome" style="grid-template-columns:1fr">
        <div>
          <p class="eyebrow">Updated</p>
          <h2>The lessons now explain themselves</h2>
          <p>Every introduction now says what you will hear and what to do. You will see the new introduction for your current level in each track once.${S.track('sing').level === 0 ? ' Find Do comes first, with a few practice rounds where the app plays Do for you to copy. Practice rounds do not count toward the next level.' : ''}</p>
          <div class="row" style="margin-top:16px"><button class="btn" data-act="dismissNew">Got it</button></div>
        </div>
      </section>` : '';
    const WHY = {
      'Tune in': 'Four chords set the key, then you sing. This puts the key in your ear and your voice before the listening questions.',
      Core: 'Scale Degrees, every day. You learn to hear each note by its place in the key. Every other skill here builds on this.',
      Focus: 'One more skill, rotating so each gets regular attention without crowding the session.',
      'Mixed review': 'Questions from the tracks you have practiced, except the singing tracks, shuffled. Mixing feels harder in the moment and makes memory last.',
      'Sing to finish': 'A short singing set to end on. If you can sing a sound, you can hear it in your head.',
    };
    const backup = backupDue() ? `
      <section class="welcome" style="grid-template-columns:1fr">
        <div>
          <p class="eyebrow">Keep a copy</p>
          <h2>Your progress lives only in this browser</h2>
          <p>An iPhone can clear a website’s saved data after a week without a visit. Copy your progress now and then and keep it somewhere safe, such as a note. Paste it back under Preferences if it is ever lost.</p>
          <div class="row" style="margin-top:16px"><button class="btn" data-act="exportProgress">Copy my progress</button><button class="btn ghost" data-act="backupLater">Remind me in two weeks</button></div>
        </div>
      </section>` : '';
    const whyRows = [...new Set(plan.map((b) => b.role))].filter((r) => WHY[r]).map((r) => `<div><strong>${esc(r)}</strong><p>${esc(WHY[r])}</p></div>`).join('');
    return `<div class="today">
      ${S.state.onboarded ? '' : welcome}${whatsNew}${backup}
      <section class="hero">
        <div>
          <p class="eyebrow">${esc(date)}</p>
          <h1>${met ? 'Today’s goal is <em>met</em>' : 'Today’s <em>practice</em>'}</h1>
          <p class="lede">${met ? 'You can stop here, or run another set. Extra practice still counts toward your review schedule.' : resuming ? `About ${planMinutes(left)} minutes left in today’s plan. It picks up where you stopped.` : `About ${planMinutes(plan)} minutes in ${plan.length} short sets. Sing along whenever you can.`}</p>
          <div class="hero-actions">
            <button class="btn primary lg" data-act="startDaily">${resuming ? 'Continue practice' : met ? 'Practice again' : 'Start practice'}</button>
            ${S.state.onboarded ? '<button class="btn lg" data-act="soundCheck">Sound check</button>' : ''}
          </div>
          <div class="daystats">
            <div class="daystat"><div class="v num">${streak}</div><div class="l">day streak</div></div>
            <div class="daystat"><div class="v num">${dayQ}<span class="muted" style="font-size:18px"> / ${goal}</span></div><div class="l">questions today</div><div class="meter goal-meter"><span style="width:${Math.min(1, dayQ / goal) * 100}%"></span></div></div>
            <div class="daystat"><div class="v num">${Math.round(day.s / 60)}</div><div class="l">minutes today</div></div>
          </div>
        </div>
        ${ladderFigure()}
      </section>
      <section class="plan-grid">
        <div>
          <div class="section-title"><h2>Set list</h2><span class="muted">${plan.reduce((a, b) => a + b.count, 0)} questions</span></div>
          <ol class="setlist">${plan.map(planRow).join('')}</ol>
        </div>
        <div>
          <div class="section-title"><h2>Why this order</h2></div>
          <div class="why-list">${whyRows}</div>
        </div>
      </section>
      <section>
        <div class="section-title"><h2>Tracks</h2><span class="muted">Practice any track on its own</span></div>
        <div class="track-grid">${TRACKS.map(trackCard).join('')}</div>
      </section>
    </div>`;
  }

  // A reminder to keep a copy, for progress that lives only in this browser.

  function backupDue() {
    if (S.mode !== 'local' || S.connecting || S.blocked || S.answeredIn(S.state) < 40) return false;
    const d = deviceInfo(), now = Date.now(), fortnight = 14 * 86400000;
    return (!d.backupAt || now - d.backupAt > fortnight) && (!d.snoozeUntil || now > d.snoozeUntil);
  }

  // this screen's part of the action table (data-act), merged in main.js
  const todayActions = {
    startDaily: () => {
      const saved = savedPlan();
      if (planLeft(saved)) { startSession(saved.blocks, { daily: true, day: saved.day }); return; }
      startSession(buildDailyPlan(), { daily: true, day: TL.dayKey() });
    },
    practice: (d) => startSession([{ track: d.track, count: FREE_COUNT[d.track], role: 'Practice' }]),
    dismissNew: () => { S.state.seen.v2 = true; S.touch(); render(); },
    backupLater: () => { setDeviceInfo({ snoozeUntil: Date.now() + 14 * 86400000 }); render(); },
  };

export { gateText, learnedDegrees, toGoShort, toGoText, todayActions, viewToday };
