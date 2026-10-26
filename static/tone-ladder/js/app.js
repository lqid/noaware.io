/* Tone Ladder — the app: views, session runner, exercise UIs, keyboard handling. */
(function () {
  'use strict';
  const TL = window.TL;
  const S = TL.Store, A = TL.Audio, CUR = TL.Curriculum;
  const { TRACKS, TRACK } = CUR;
  const { DEG } = TL;

  // ---------- utilities ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pct = (x) => Math.round(x * 100) + '%';
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const fmtNum = (x) => (Math.round(x * 10) / 10).toString();
  function fmtDuration(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function degText(id) {
    const d = DEG[id];
    const L = S.settings.labels;
    if (L === 'numbers') return { main: d.num, sub: '' };
    if (L === 'solfege') return { main: d.sol, sub: '' };
    return { main: d.sol, sub: d.num };
  }
  const FN_HUE = { T: 25, PD: 145, D: 195 };
  const rnHue = (name) => FN_HUE[(TL.RN[name] || {}).fn] ?? 230;
  const tonicForPc = (pc) => 55 + TL.mod12(pc - 7);
  function nearestSemi(id, around) {
    const base = DEG[id].semi;
    let best = base, bd = Infinity;
    for (let o = -24; o <= 24; o += 12) { const d = Math.abs(base + o - around); if (d < bd) { bd = d; best = base + o; } }
    return best;
  }
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  function applyAudio() {
    const s = S.settings;
    A.configure({ volume: s.volume, timbre: s.timbre === 'vary' ? 'piano' : s.timbre, speed: s.speed });
  }
  const VARY = ['piano', 'epiano', 'strings', 'organ'];
  const pickTimbre = () => (S.settings.timbre === 'vary' ? TL.pick(VARY) : S.settings.timbre);
  function safeAudio() {
    try { A.ensure(); applyAudio(); return true; } catch (e) { toast(e.message || 'Audio is not available in this browser.'); return false; }
  }
  let wake = null;
  async function requestWake() { try { wake = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) { wake = null; } }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* ignore */ } wake = null; }

  const app = { view: 'today', params: {} };
  let R = null; // the running session

  // ---------- item description helpers ----------
  const DIR_ARROW = { a: '↑', d: '↓', h: 'together' };
  function levelItemsText(trackId, lv) {
    switch (trackId) {
      case 'degrees': return lv.items.map((i) => degText(i).main).join(' · ') + (lv.wide ? ' · two octaves' : '') + (lv.mode === 'minor' ? ' · minor' : '');
      case 'intervals': {
        const ids = [...new Set(lv.items.map((x) => x.slice(0, -1)))].sort((a, b) => TL.IV[a].semi - TL.IV[b].semi);
        const dirs = [...new Set(lv.items.map((x) => x.slice(-1)))].map((d) => DIR_ARROW[d]).join(' ');
        return ids.map((x) => TL.IV[x].short).join(' · ') + ' · ' + dirs;
      }
      case 'chords': return lv.items.map((x) => TL.CHORD_TYPES[x].name).join(' · ') + (lv.inversions ? ' · inversions' : '');
      case 'harmony': return lv.pool.join(' · ') + (lv.mode === 'minor' ? ' · minor' : '');
      case 'melody': return `${lv.length} notes · ` + lv.items.map((i) => degText(i).main).join(' ');
      case 'rhythm': return lv.cells.map((c) => TL.RCELLS[c].label).join(' · ') + (lv.meter ? ' · ' + lv.meter : '');
      case 'sing': return { degree: 'Sing notes of the key', read: `Sing ${lv.length}-note patterns`, echo: `Echo ${lv.length}-note melodies`, bass: 'Sing the lowest note of a chord' }[lv.type] + (lv.type === 'degree' ? ': ' + lv.items.map((i) => degText(i).main).join(' · ') : '');
      default: return '';
    }
  }
  function itemName(trackId, it) {
    if (trackId === 'degrees' || trackId === 'melody') return degText(it).main + (degText(it).sub ? ' ' + degText(it).sub : '');
    if (trackId === 'intervals') return TL.IV[it.slice(0, -1)].name + ' ' + DIR_ARROW[it.slice(-1)];
    return TRACK[trackId].itemLabel(it);
  }
  function itemHue(trackId, it) {
    if ((trackId === 'degrees' || trackId === 'melody') && DEG[it]) return DEG[it].hue;
    if (trackId === 'sing' && DEG[it]) return DEG[it].hue;
    if (trackId === 'harmony') return rnHue(it);
    return TRACK[trackId].hue;
  }

  // ======================================================================
  // DAILY PLAN
  // ======================================================================
  const SEC_PER = { degrees: 13, intervals: 10, chords: 10, harmony: 28, melody: 30, rhythm: 26, sing: 18, mix: 16 };
  const FOCUS_COUNT = { intervals: 10, chords: 10, harmony: 5, melody: 6, rhythm: 6 };
  const FREE_COUNT = { degrees: 20, intervals: 20, chords: 20, harmony: 8, melody: 10, rhythm: 10, sing: 8 };
  function buildDailyPlan() {
    const k = S.settings.dailyGoal / 30;
    const n = (x, min) => Math.max(min, Math.round(x * k));
    const unlocked = TRACKS.map((t) => t.id).filter((id) => S.isUnlocked(id));
    // On day one Do is taught in the Core set first, so the singing set moves to the end.
    const tuneIn = { track: 'sing', count: Math.min(3, n(2, 1)), role: 'Tune in' };
    const core = { track: 'degrees', count: n(10, 6), role: 'Core' };
    const plan = S.track('degrees').last ? [tuneIn, core] : [core];
    const rest = unlocked.filter((id) => id !== 'degrees' && id !== 'sing');
    // least recently practiced first; ties (day one) start with the track that needs no note names
    const ORDER = ['chords', 'intervals', 'rhythm', 'melody', 'harmony'];
    rest.sort((a, b) => (S.track(a).last || 0) - (S.track(b).last || 0) || ORDER.indexOf(a) - ORDER.indexOf(b));
    rest.slice(0, S.settings.dailyGoal >= 45 ? 2 : 1).forEach((id) => plan.push({ track: id, count: n(FOCUS_COUNT[id], 3), role: 'Focus' }));
    plan.push({ track: 'mix', count: n(8, 4), role: 'Mixed review' });
    plan.push({ track: 'sing', count: Math.min(3, n(2, 1)), role: 'Sing to finish' });
    return plan;
  }
  // Today's plan is kept on this device after it starts, so an interrupted session resumes where it stopped.
  const PLAN_KEY = 'tone-ladder-v1-plan';
  function savedPlan() {
    try {
      const p = JSON.parse(localStorage.getItem(PLAN_KEY));
      const ok = p && p.day === TL.dayKey() && Array.isArray(p.blocks) && p.blocks.length
        && p.blocks.every((b) => b && (b.track === 'mix' || (TRACK[b.track] && S.isUnlocked(b.track))) && Number.isFinite(b.count) && Number.isFinite(b.done));
      return ok ? p : null;
    } catch (e) { return null; }
  }
  function storePlan(blocks, day) {
    if (S.blocked) return;
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify({
        day,
        blocks: blocks.map((b) => ({ track: b.track, count: b.count, role: b.role, done: b.skipped ? b.count : Math.min(b.done || 0, b.count), skipped: !!b.skipped })),
      }));
    } catch (e) { /* storage blocked: the plan simply starts over */ }
  }
  const planLeft = (p) => !!p && p.blocks.some((b) => b.done < b.count);
  const dropPlan = () => { try { localStorage.removeItem(PLAN_KEY); } catch (e) { /* blocked */ } };
  const savePlanNow = () => { if (R && R.daily) storePlan(R.plan, R.planDay); };
  function reviewable() {
    return TRACKS.map((t) => t.id).filter((id) => id !== 'sing' && S.isUnlocked(id) && S.track(id).intro[S.track(id).level] && S.track(id).last);
  }
  const planMinutes = (plan) => Math.max(3, Math.round(plan.reduce((a, b) => a + b.count * (SEC_PER[b.track] || 15), 0) / 60));

  // ======================================================================
  // TODAY
  // ======================================================================
  // the notes Scale Degrees has taught so far
  function learnedDegrees() {
    const t = S.track('degrees');
    const levels = TRACK.degrees.levels;
    const learned = new Set();
    levels.slice(0, t.level).forEach((lv) => lv.items.forEach((i) => learned.add(i)));
    const cur = levels[t.level];
    cur.items.forEach((i) => { if (!cur.introduce.includes(i) || t.complete) learned.add(i); });
    return learned;
  }
  function ladderFigure() {
    const t = S.track('degrees');
    const levels = TRACK.degrees.levels;
    const learned = learnedDegrees();
    const cur = levels[t.level];
    const next = new Set(t.complete ? [] : cur.introduce.filter((i) => !learned.has(i)));
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
    rhythm: ['rhythm figure tapped right', 'rhythm figures tapped right'], sing: ['Matched round', 'Matched rounds'],
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
    const welcome = !S.state.onboarded ? `
      <section class="welcome">
        <div>
          <p class="eyebrow">Start here</p>
          <h2>Hear music the way you write it</h2>
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
      'Mixed review': 'Questions from the tracks you have practiced, except Sing, shuffled. Mixing feels harder in the moment and makes memory last.',
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

  // ======================================================================
  // TRACK PAGE
  // ======================================================================
  function viewTrack() {
    const id = app.params.track;
    const tr = TRACK[id];
    const t = S.track(id);
    const m = S.mastery(id);
    const unlocked = S.isUnlocked(id);
    const maxOpen = S.settings.unlockAll ? tr.levels.length - 1 : t.maxLevel;
    const rows = tr.levels.map((lv, L) => {
      const state = L === t.level ? (t.complete ? 'done' : 'current') : L < t.maxLevel ? 'done' : L <= maxOpen ? 'open' : 'locked';
      const stText = state === 'done' ? '<span class="st ok">Mastered</span>' : state === 'current' ? `<span class="st">${m.n ? `${fmtNum(m.correct)}/${m.n} recent` : 'Current'}</span>` : state === 'open' ? '<span class="st">Open</span>' : '<span class="st">Locked</span>';
      const btn = unlocked && state !== 'locked' ? `<button class="btn sm ${state === 'current' ? 'primary' : ''}" data-act="practiceLevel" data-track="${id}" data-level="${L}">Practice</button>` : stText;
      return `<li class="level ${state === 'current' ? 'current' : state === 'locked' ? 'locked' : ''}">
        <span class="n">${L + 1}</span>
        <div style="min-width:0"><div class="nm">${esc(lv.name)}</div><div class="its">${esc(levelItemsText(id, lv))}</div></div>
        <div class="row" style="justify-content:flex-end">${state !== 'locked' && unlocked ? stText : ''}${btn}</div>
      </li>`;
    }).join('');
    const statRows = itemOrder(id).map((it) => {
      const s = S.item(id, it);
      if (!s.n) return '';
      return `<tr><td><span class="deg" style="--h:${itemHue(id, it)};display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--c);margin-right:8px"></span>${esc(itemName(id, it))}</td><td class="r">${s.n}</td><td class="r">${pct(s.c / s.n)}</td><td class="r">${pct(s.e)}</td><td class="r">${s.rt ? (s.rt / 1000).toFixed(1) + ' s' : '–'}</td></tr>`;
    }).join('');
    return `<div>
      <div class="page-head">
        <button class="btn ghost sm back" data-act="go" data-view="today">← Today</button>
        <p class="eyebrow">Track</p>
        <h1>${esc(tr.name)}</h1>
        <p class="lede">${esc(tr.blurb)}</p>
      </div>
      <div class="two-col">
        <section>
          <div class="section-title"><h2>Levels</h2><span class="muted">${t.maxLevel + 1} of ${tr.levels.length} open</span></div>
          ${unlocked ? '' : `<p class="empty" style="margin-bottom:12px">This track opens when you reach ${esc(S.prereqText(id))}. You can open everything early in Preferences.</p>`}
          <ol class="levels">${rows}</ol>
        </section>
        <aside class="side-stack">
          <div class="card" style="display:grid;gap:12px">
            <p class="eyebrow">Why it matters for composing</p>
            <p>${esc(tr.why)}</p>
          </div>
          ${unlocked ? `<div class="card" style="display:grid;gap:12px">
            <p class="eyebrow">Current level · ${t.level + 1}</p>
            <h3 class="serif" style="font-size:26px">${esc(tr.levels[t.level].name)}</h3>
            <div class="meter deg" style="--h:${tr.hue}"><span style="width:${(t.complete ? 1 : m.pct) * 100}%"></span></div>
            <p class="muted" style="font-size:13.5px">${t.complete ? 'Every level in this track is mastered.' : tr.selfGraded
              ? `Level up at ${m.need} points from your last ${m.window} rounds (Matched counts 1, Close counts ½). Practice rounds are not counted, and the rounds must come from at least two different days.${S.nextNeeds(id) ? ' ' + esc(gateText(id, S.nextNeeds(id))) : ''}`
              : `Level up at ${m.need} right out of your last ${m.window}${(tr.levels[t.level].introduce || []).length ? ', with each new item answered correctly a few times' : ''}, on at least two different days.`}</p>
            ${t.complete ? '' : `<p style="font-size:14px;font-weight:600">${esc(toGoText(id))}</p>`}
            <div class="row">
              <button class="btn primary" data-act="practice" data-track="${id}">Practice</button>
              <button class="btn" data-act="reintro" data-track="${id}">Hear the new sounds</button>
              ${t.maxLevel < tr.levels.length - 1 ? `<button class="btn ghost" data-act="skipAhead" data-track="${id}">Skip ahead</button>` : ''}
            </div>
          </div>` : ''}
          <div class="card">
            <p class="eyebrow" style="margin-bottom:8px">Your accuracy</p>
            ${statRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Tries</th><th class="r">All-time</th><th class="r">Recent</th><th class="r">Time</th></tr></thead><tbody>${statRows}</tbody></table></div>` : '<p class="muted">No answers yet.</p>'}
          </div>
        </aside>
      </div>
    </div>`;
  }
  function itemOrder(trackId) {
    const seen = [];
    for (const lv of TRACK[trackId].levels) for (const it of lv.items || lv.pool || []) if (!seen.includes(it)) seen.push(it);
    if (trackId === 'degrees' || trackId === 'melody') seen.sort((a, b) => DEG[a].semi - DEG[b].semi);
    return seen;
  }

  // ======================================================================
  // SESSION RUNNER
  // ======================================================================
  function startSession(plan, opts = {}) {
    if (S.blocked) { toast('Reload the page first: your progress was saved by a newer version.'); return; }
    if (!safeAudio()) return;
    micRelease();
    A.stop();
    R = {
      plan: plan.map((b) => ({ ...b, done: b.done || 0, done0: b.done || 0, score: 0, sn: 0 })), bi: -1, phase: null, q: null, qid: 0, planDay: opts.day,
      levelUps: [], recent: {}, retry: [], key: null, answered: 0, score: 0, sn: 0,
      started: Date.now(), lastActive: performance.now(), itemsSession: {}, daily: !!opts.daily,
    };
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
    if (b.track !== 'sing') micRelease();
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
    if (trackId === 'sing' && micGate()) return;
    const pool = b.pool || lv.items;
    let item;
    if (tr.picksItem) {
      item = takeRetry(trackId, pool) ?? S.chooseItem(trackId, pool, { newItems: b.pool ? [] : lv.introduce || [], recent: R.recent[trackId] || [], levelStats: t.levelStats });
    }
    const mode = tr.modeOf ? tr.modeOf(L) : 'major';
    const findDo = trackId === 'sing' && lv.type === 'degree' && lv.items.length === 1;
    // Find Do moves to a new key every question (the one held from the intro is kept)
    if (findDo && R.key && R.key.held === undefined && S.settings.keyMode !== 'fixed') R.key.count = 8;
    let tonic = 60, keyChanged = false;
    if (tr.usesKey) ({ tonic, changed: keyChanged } = nextKey(mode));
    // no drone under singing: it would sound the answer
    const drone = S.settings.context === 'drone' && tr.usesKey && trackId !== 'harmony' && trackId !== 'sing';
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
    const fade = t.window.length >= 10; // drop the "top note of the last chord" hint once the window is half full
    const q = tr.generate(L, { tonic, item, withContext, pool: b.pool, hints: S.settings.hints, voice: S.settings.voice, practice, fade, maxLevel: t.maxLevel, labels: S.settings.labels });
    Object.assign(q, { track: trackId, level: L, item, keyChanged, id: ++R.qid, timbre: pickTimbre(), drone, pooled: !!b.pool });
    R.q = q;
    R.phase = 'answering';
    R.input = q.kind === 'sequence' ? Array(q.answer.length).fill(null) : [];
    R.cursor = 0;
    R.mainEnd = null;
    R.replays = 0;
    R.levelUpNow = null;
    R.singMissed = false;
    R.rPhase = null; R.rResult = null; R.rScored = false; R.taps = [];
    if (q.kind === 'sing') micListen(q); else if (A.micOn) micRelease();
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
      try { R.mic.L.reset(); } catch (e) { /* the next push reports it */ }
      R.mic.quietFrom = null;
      if (R.mic.state !== 'listening') { R.mic.state = 'listening'; renderStage(); }
    }
    setListening(true);
    const h = A.play(evs, { timbre: q.timbre, lead, onEvent: (ev, i) => litEvent(q, ev, i, revealing) });
    if (part === 'main' && R.phase === 'answering') R.replays++;
    const id = q.id;
    R.playH = h;
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
  function flash(el, ms) {
    if (!el) return;
    el.classList.add('lit');
    setTimeout(() => el.classList.remove('lit'), Math.max(160, ms - 30));
  }
  function litEvent(q, ev, i, revealing) {
    const ms = ((ev.dur || 0.4) * 1000) / (S.settings.speed || 1);
    if (ev.slot != null) flash($(`.slot[data-i="${ev.slot}"]`), ms);
    if (!revealing) return;
    if (q.kind === 'sing') flash($(`.pattern span[data-i="${i}"]`), ms);
    if (ev.deg && ev.notes && q.tonic != null) {
      const s = ev.notes[0] - (q.kind === 'sing' ? CUR.voiceTonic(q.tonic, S.settings.voice) : q.tonic);
      let key = TL.mod12(s);
      if (key === 0 && s > 0 && $('.ladder .rung[data-semi="12"]')) key = 12;
      flash($(`.ladder .rung[data-semi="${key}"]`), ms);
    }
  }

  // Score one question and advance the learning engine. Practice rounds count toward the set and the day only.
  function commit(q, results, rt, confusions) {
    const b = block();
    const scored = !q.pooled && !q.practice;
    b.played = true;
    S.record({ track: q.track, level: scored ? q.level : -1, items: q.stats, results, rt, confusions, practice: !!q.practice });
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

  // ---------- answering: choice ----------
  function answerChoice(id) {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'choice') return;
    if (!q.options.some((o) => o.id === id)) return;
    R.phase = 'feedback';
    R.chosen = id;
    const correct = id === q.answer;
    const rt = R.mainEnd ? performance.now() - R.mainEnd : 0;
    const chosenItem = itemFromChoice(q, id);
    commit(q, [correct ? 1 : 0], rt, correct ? [] : [[q.stats[0], chosenItem]]);
    if (!correct) {
      const pool = block().pool || TRACK[q.track].levels[q.level].items;
      queueRetry(q, pool.includes(chosenItem) ? chosenItem : null);
    }
    R.rt = rt;
    renderStage();
    revealFeedback();
    const h = playPart('reveal');
    if (correct && S.settings.autoAdvance && !R.levelUpNow && h) {
      const qid = q.id;
      h.done.then((ok) => setTimeout(() => { if (ok && R && R.q && R.q.id === qid && R.phase === 'feedback') nextQuestion(); }, 500));
    }
  }

  // ---------- answering: sequence ----------
  function revealFeedback() {
    if (window.innerWidth > 820) return;
    const fb = $('#fb');
    if (fb) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function seqPick(id) {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'sequence') return;
    if (!q.options.some((o) => o.id === id)) return;
    const n = q.answer.length;
    if (R.cursor >= n) R.cursor = n - 1;
    R.input[R.cursor] = id;
    if (q.track === 'melody' && S.settings.dictationSound) A.play(q.tapSound(id, q.melody[0]), { timbre: q.timbre });
    if (q.track === 'harmony' && S.settings.dictationSound) A.play([{ t: 0, notes: TL.voiceChord(TL.rnPcs(id), TL.rnBassPc(id), q.tonic, null), dur: 1, vel: 0.6 }], { timbre: q.timbre });
    let c = R.cursor + 1;
    while (c < n && R.input[c]) c++;
    if (c >= n) { const empty = R.input.findIndex((x) => !x); c = empty === -1 ? n : empty; }
    R.cursor = c;
    renderSeq();
  }
  function seqBack() {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'sequence') return;
    const n = q.answer.length;
    if (R.cursor < n && R.input[R.cursor]) R.input[R.cursor] = null;
    else {
      let c = Math.min(R.cursor, n) - 1;
      if (c < 0) return;
      R.input[c] = null; R.cursor = c;
    }
    renderSeq();
  }
  function seqSelect(i) {
    if (!R || R.phase !== 'answering') return;
    R.cursor = i;
    renderSeq();
  }
  function seqSubmit() {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.kind !== 'sequence') return;
    if (R.input.some((x) => !x)) { toast('Fill every slot first.'); return; }
    R.phase = 'feedback';
    const results = q.answer.map((a, i) => (R.input[i] === a ? 1 : 0));
    const conf = q.answer.map((a, i) => (R.input[i] !== a ? [a, R.input[i]] : null)).filter(Boolean);
    const rt = R.mainEnd ? performance.now() - R.mainEnd : 0;
    commit(q, results, rt / q.answer.length, conf);
    R.results = results;
    renderStage();
    revealFeedback();
    playPart('reveal');
  }

  // ---------- answering: sing ----------
  function singReveal() {
    if (!R || !R.q || R.q.kind !== 'sing' || R.phase !== 'answering' || R.mainEnd == null) return;
    R.phase = 'revealed';
    renderStage();
    playPart('reveal');
  }
  const GRADE_NAME = { 1: 'Matched', 0.5: 'Close', 0: 'Missed' };
  function singGrade(v) {
    const q = R && R.q;
    if (!q || q.kind !== 'sing' || R.phase !== 'revealed' || ![0, 0.5, 1].includes(v)) return;
    const heard = R.mic && R.mic.state === 'heard' ? R.mic : null;
    if (heard && !heard.shown) return; // the answer is still playing: sing along first
    if (q.echoAnswer && R.replays > 1) q.practice = true; // the melody was replayed
    if (q.copy) {
      // copying the app is practice for the voice: nothing is recorded
      R.phase = 'feedback';
      toast(`${GRADE_NAME[v]} (copy, not scored)`, 1200);
      const cid = q.id;
      setTimeout(() => { if (R && R.q && R.q.id === cid) nextQuestion(); }, 600);
      return;
    }
    let misheard = false;
    if (heard) {
      // a grade above the app's means it misheard: the round is not scored either way
      if (v > heard.result.v) { q.practice = true; misheard = true; R.micOverrides = (R.micOverrides || 0) + 1; }
      if (heard.warmup) q.practice = true;
      MIC.rounds = micRounds() + 1;
      setDeviceInfo({ micRounds: MIC.rounds });
    }
    if (q.level === 0 && !q.practice) R.findDoMisses = v === 0 ? (R.findDoMisses || 0) + 1 : 0;
    commit(q, [v], 0, []);
    if (q.level === 0 && !q.practice && R.findDoMisses >= 2 && !R.levelUpNow) { S.state.findDoPracticeNext = true; S.touch(); }
    R.phase = 'feedback';
    if (v === 0 && q.model) { R.singMissed = true; renderStage(); setListening(false); return; }
    if (R.levelUpNow) { renderStage(); setListening(false); return; }
    if (misheard && R.micOverrides === 3) toast('If the app keeps mishearing you, switch to checking yourself in Settings, or try another microphone.', 4200);
    else toast(misheard ? 'Not scored: the app may have misheard you.' : `Saved: ${GRADE_NAME[v]}${q.practice ? ' (practice)' : ''}`, misheard ? 2200 : 1100);
    const id = q.id;
    setTimeout(() => { if (R && R.q && R.q.id === id) nextQuestion(); }, misheard ? 900 : 450);
  }

  // ---------- answering: sing, checked by the microphone ----------
  // The choice is kept per device (microphone access belongs to one browser) and cached here, so a
  // browser that blocks storage still remembers it for the visit.
  const MIC = { choice: undefined, rounds: undefined, perm: null, denied: false, timer: null, lastT: -1, gate: 0, test: 0, prefTok: 0, warned: false };
  function micPref() { if (MIC.choice === undefined) MIC.choice = deviceInfo().mic || null; return MIC.choice; }
  function micRounds() { if (MIC.rounds === undefined) MIC.rounds = deviceInfo().micRounds || 0; return MIC.rounds; }
  function setMicPref(v) { MIC.choice = v; setDeviceInfo({ mic: v }); }
  // The claude.ai copy has no microphone access. Other frames are found out on the first try.
  const micCopy = () => !!document.querySelector('meta[name="tl-copy"][content="artifact"]');
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
  // what the listener grades: one pitch class held, or a melody, in semitones from Do
  function singTarget(q) {
    if (q.pattern) return { kind: 'sequence', semis: q.patternSemis };
    if (q.echoSemis) return { kind: 'sequence', semis: q.echoSemis };
    return { kind: 'hold', semis: [DEG[q.deg || q.bassAnswer].semi] };
  }

  // Before the first question of a Sing set, and after a level's introduction, the mic opens with
  // nothing playing: a permission prompt, or an iPhone switching to recording, would otherwise land
  // on the chords that set the key.
  function micGate() {
    if (R.micSkip || micPref() === 'off' || !micAvailable() || MIC.denied) return false;
    if (micPref() === 'on' && A.micOn && A.running) return false;
    A.stop();
    R.phase = 'mic';
    R.q = null;
    R.mic = null;
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
    if (!q || q.kind !== 'sing' || R.micSkip || !micWanted() || !A.micOn) return;
    const tg = singTarget(q);
    let L;
    try { L = TL.Pitch.listener({ sampleRate: A.micRate(), doMidi: CUR.voiceTonic(q.tonic, S.settings.voice), kind: tg.kind, target: tg.semis }); } catch (e) { micBroken(e); return; }
    R.mic = { qid: q.id, L, kind: tg.kind, state: 'listening', result: null, shown: false, nulls: 0, quietFrom: null, pause: null };
    if (A.micMuted) { R.mic.state = 'paused'; R.mic.pause = 'muted'; }
    MIC.lastT = -1;
    if (!MIC.timer) MIC.timer = setInterval(micTick, 20);
  }
  function micBroken(e) {
    if (!MIC.warned) { MIC.warned = true; console.warn('Tone Ladder: the pitch listener failed, so you check yourself.', e); }
    if (R && R.mic) { R.mic.state = 'off'; if (R.phase === 'answering') renderStage(); }
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
    if (res.v == null && res.reason === 'unclear') {
      // sound was there but not every note could be followed: the learner checks this one
      m.state = 'off';
      toast('The app could not follow every note this time. Check yourself.', 2600);
      singReveal();
      return;
    }
    if (res.v == null) {
      m.nulls++;
      // a second Done with nothing to grade: the learner checks themselves
      if (manual && m.nulls >= 2) { m.state = 'off'; singReveal(); return; }
      m.state = 'missed';
      m.reason = res.reason;
      try { m.L.reset(); } catch (e) { /* the next push reports it */ }
      renderStage();
      return;
    }
    m.result = res;
    m.state = 'heard';
    m.shown = false;
    if (m.kind === 'hold' && res.v > 0 && res.notes && res.notes.length) {
      const n = res.notes[Number.isInteger(res.graded) ? res.graded : res.notes.length - 1];
      const offs = R.micOffs = [...(R.micOffs || []), n.off].slice(-8);
      const mid = offs.slice().sort((a, b) => a - b)[offs.length >> 1];
      if (offs.length >= 6 && Math.abs(mid) > 30 && !R.micBiasShown) { m.bias = mid < 0 ? 'low' : 'high'; R.micBiasShown = true; }
    }
    // the first few rounds with the microphone (after Find Do) are a warm-up and not scored
    m.warmup = R.q.level > 0 && !R.q.copy && micRounds() < 3;
    R.phase = 'revealed';
    renderStage();
    // the answer plays while the learner sings along; playPart shows the verdict when it ends
    if (!playPart('reveal')) { m.shown = true; renderStage(); }
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
      try { m.L.reset(); } catch (e) { /* the next push reports it */ }
      m.state = 'listening'; m.pause = null; m.quietFrom = null; MIC.lastT = -1;
      if (!MIC.timer) MIC.timer = setInterval(micTick, 20);
      renderStage();
    };
    if (A.micOn) go();
    else A.micOpen().then(go, () => { if (R && R.mic === m) { m.state = 'off'; renderStage(); } });
  }
  A.onState = (st) => { if (st !== 'running') micPause('clock'); };
  A.onMic = (ev) => {
    if (ev === 'mute') micPause('muted');
    else if (ev === 'unmute' && R && R.mic && R.mic.pause === 'muted') micResume();
    else if (ev === 'ended') micPause('ended');
  };
  // After a miss on a single note: the app plays it and the learner copies it, unscored.
  function singCopy() {
    const q = R && R.q;
    if (!q || q.kind !== 'sing' || R.phase !== 'feedback' || !q.model || !R.mic) return;
    const c = {
      ...q, id: ++R.qid, practice: true, copy: true, keyChanged: false,
      prompt: 'Copy it: listen, then sing the last note again on your own and hold it.',
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
    if (R) R.mic = null;
    A.micClose();
  }

  // ---------- answering: rhythm ----------
  function rhythmTimes(q) {
    const r = q.rhythm;
    const bpm = q.bpm * (S.settings.speed || 1);
    const beatSec = 60 / bpm;
    const tickSec = beatSec / (r.meter === '6/8' ? 18 : 12);
    const clickTicks = r.meter === '6/8' ? 6 : 12;
    return { beatSec, tickSec, barSec: r.barTicks * tickSec, clickTicks, clicksPerBar: r.barTicks / clickTicks };
  }
  const isAccent = (r, i) => (r.meter === '6/8' ? i % 3 === 0 : i === 0);
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
    R.taps = [];
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
    const id = q.id;
    const wait = (R.rEnd - A.now() + A.latency() + 0.35) * 1000;
    setTimeout(() => { if (R && R.q && R.q.id === id && (R.rPhase === 'tapping' || R.rPhase === 'countin')) evaluateTaps(); }, wait);
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
  // A reminder to keep a copy, for progress that lives only in this browser.
  const DEVICE_KEY = 'tone-ladder-v1-device';
  function deviceInfo() { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {}; } catch (e) { return {}; } }
  function setDeviceInfo(patch) { try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...deviceInfo(), ...patch })); } catch (e) { /* blocked */ } }
  function backupDue() {
    if (S.mode !== 'local' || S.connecting || S.blocked || S.answeredIn(S.state) < 40) return false;
    const d = deviceInfo(), now = Date.now(), fortnight = 14 * 86400000;
    return (!d.backupAt || now - d.backupAt > fortnight) && (!d.snoozeUntil || now > d.snoozeUntil);
  }
  function endRunner() {
    micRelease();
    if (R) { A.stop(); A.droneStop(0.3); releaseWake(); }
    R = null;
    S.setBusy(false);
  }

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
    degrees: (q) => (q.drone
      ? 'The drone is the low, steady sound under the question. Its strongest note is Do, the home note; a quieter Sol sits above it. Hum Do at any height that suits your voice, then hum the new note.'
      : q.withContext
        ? 'The chords end on Do, the home note: it is the top note of the last chord and its bottom note too. Hum it, then hum the new note.'
        : 'The chords played when the key last changed. Hum the Do you remember, then hum the new note.') + DEG_TIP_END,
    intervals: (q) => 'Sing both notes, low to high. Call the lower one Do and sing up the scale (Do, Re, Mi…) until you reach the higher one. The number of notes you sang is the number in the name. If the higher note falls between two scale notes (you overshoot it as you sing up), the interval is the minor one: between Re and Mi is a minor 3rd.'
      + (q.options.some((o) => o.id === 'TT') ? ' Halfway between Fa and Sol is the tritone.' : ''),
    chords: 'Listen for the overall color first: bright or dark, tense or floating. Press Note by note to hear the notes one at a time.',
    harmony: (q) => q.listenTip,
    melody: 'Sing the melody back once before you answer. Then name each note by how it sits against Do.',
    sing: '',
  };

  function questionHTML() {
    const q = R.q;
    const keyLine = q.tonic != null && TRACK[q.track].usesKey ? `<p class="q-key">Key of <b>${esc(TL.keyName(q.tonic, q.mode || 'major'))}</b>${q.keyChanged && R.qid > 1 ? ' · <span class="new">new key: Do has moved</span>' : ''}${q.drone ? ' · drone' : ''}</p>` : '';
    // in singing questions, extra sounds wait until the chords finish, so a click cannot cut them off
    const wait = (r) => q.kind === 'sing' && r.part !== 'main' && R.mainEnd == null && R.phase === 'answering';
    const replays = (q.replays || []).map((r) => `<button class="btn sm" data-act="replay" data-part="${r.part}"${wait(r) ? ' disabled data-needs-main' : ''}>${esc(r.label)}${r.key ? ' <kbd>Space</kbd>' : ''}</button>`).join('');
    const top = `<div class="q-top"><p class="q-prompt">${esc(q.prompt)}</p>${keyLine}</div>`;
    const sounding = A.playing();
    const listen = `<span class="listen-state${sounding ? '' : ' idle'}" id="listenState"><i class="pulse"></i><span>${pillLabel(sounding)}</span></span>`;
    if (q.kind === 'tap') return top + rhythmHTML();
    if (q.kind === 'sing') return top + `<div class="q-replays">${replays}${listen}</div>` + singHTML();
    const body = q.kind === 'choice' ? choiceBodyHTML() : seqBodyHTML();
    return `${top}<div class="q-replays">${replays}${listen}</div><div class="q-body">${body}<div id="fb">${feedbackHTML()}</div></div>`;
  }

  // ----- ladder -----
  function keyHints(options, mode) {
    // digit = the mode's own degree with that number; Shift+digit = its altered twin
    const native = new Set(TL.MODE_SCALE[mode || 'major']);
    const groups = {};
    for (const o of options) {
      if (!DEG[o.id]) continue;
      const n = DEG[o.id].num.replace(/[♭♯]/g, '');
      (groups[n] || (groups[n] = [])).push(o.id);
    }
    const map = {};
    for (const [n, ids] of Object.entries(groups)) {
      ids.sort((a, b) => (native.has(b) ? 1 : 0) - (native.has(a) ? 1 : 0));
      map[n] = ids[0];
      if (ids[1]) map['S' + n] = ids[1];
    }
    return map;
  }
  function ladderHTML(options, mode, act, state = {}) {
    const native = new Set(TL.MODE_SCALE[mode || 'major']);
    const ids = options.map((o) => o.id);
    const left = ids.filter((id) => native.has(id));
    const right = ids.filter((id) => !native.has(id));
    const rows = left.map((id) => ({ id, semi: DEG[id].semi }));
    if (ids.includes('1')) rows.push({ id: '1', semi: 12 });
    rows.sort((a, b) => a.semi - b.semi);
    const compact = window.innerWidth < 520;
    const H = compact ? 42 : 46, RH = compact ? 34 : 36, base = 5, per = compact ? 8 : 10;
    let y = 0;
    const pos = rows.map((r, i) => { if (i > 0) y += H + base + (r.semi - rows[i - 1].semi - 1) * per; return { ...r, y }; });
    const total = (pos.length ? y : 0) + H;
    const hints = state.noKeys ? {} : keyHints(options, mode);
    const keyOf = (id) => { for (const [k, v] of Object.entries(hints)) if (v === id) return k.startsWith('S') ? '⇧' + k.slice(1) : k; return ''; };
    const cls = (id) => (state.correct === id ? ' is-correct' : '') + (state.wrong === id ? ' is-wrong' : '') + (state.dim && state.correct !== id && state.wrong !== id ? ' dim' : '');
    const rung = (id, semi, top, h, extra, chrom) => {
      const d = degText(id);
      const k = keyOf(id);
      const high = semi === 12;
      const label = high ? (S.settings.labels === 'numbers' ? '1 (high)' : 'High ' + d.main) : d.main;
      return `<button class="rung${chrom ? ' chrom' : ''}${cls(id)}" data-deg="${id}" data-semi="${semi}" data-act="${act}" data-id="${id}" style="--h:${DEG[id].hue}; top:${top}px; height:${h}px; ${extra}" aria-label="${esc((high ? 'High ' : '') + DEG[id].sol + ' ' + DEG[id].num)}">
        <span class="lbl">${esc(label)}</span><span class="meta">${d.sub ? `<span class="sub">${esc(d.sub)}</span>` : ''}${k && semi !== 12 && k !== d.sub ? `<kbd>${k}</kbd>` : ''}</span></button>`;
    };
    const lw = right.length ? 'width:63%' : 'width:100%';
    let html = pos.map((p) => rung(p.id, p.semi, total - p.y - H, H, lw, false)).join('');
    html += right.map((id) => {
      const s = DEG[id].semi;
      let lo = null, hi = null;
      for (const p of pos) { if (p.semi < s) lo = p; if (p.semi > s && !hi) hi = p; }
      let yc = lo && hi ? lo.y + H / 2 + ((hi.y - lo.y) * (s - lo.semi)) / (hi.semi - lo.semi) : lo ? lo.y + H : H / 2;
      yc = Math.max(RH / 2, Math.min(total - RH / 2, yc));
      return rung(id, s, total - yc - RH / 2, RH, 'left:auto; right:0; width:34%', true);
    }).join('');
    return `<div class="ladder" style="height:${total}px">${html}</div>`;
  }

  // ----- choice -----
  function gridKey(i) { return i < 9 ? String(i + 1) : i === 9 ? '0' : ''; }
  function choiceBodyHTML() {
    const q = R.q;
    const fb = R.phase === 'feedback';
    const state = fb ? { correct: q.answer, wrong: R.chosen !== q.answer ? R.chosen : null, dim: true } : {};
    if (q.layout === 'ladder') return `<div>${ladderHTML(q.options, q.mode, 'answer', state)}</div>`;
    return `<div class="choices">${q.options.map((o, i) => {
      const c = state.correct === o.id ? ' is-correct' : state.wrong === o.id ? ' is-wrong' : '';
      return `<button class="choice${c}" data-act="answer" data-id="${esc(o.id)}"><span class="lbl${o.serif ? ' serif' : ''}">${esc(o.label)}</span>${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}${gridKey(i) ? `<kbd>${gridKey(i)}</kbd>` : ''}</button>`;
    }).join('')}</div>`;
  }
  function answerLabelHTML(q, id) {
    if (q.track === 'degrees') {
      const d = degText(id);
      return `<p class="big deg" style="--h:${DEG[id].hue}">${esc(d.main)}${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</p>`;
    }
    const o = q.options.find((x) => x.id === id);
    if (q.track === 'intervals') return `<p class="big" style="font-style:normal">${esc(TL.IV[id].name)}</p>`;
    return `<p class="big" style="font-style:normal">${esc(o ? o.label : id)}</p>`;
  }
  function levelUpHTML() {
    const u = R.levelUpNow;
    if (!u) {
      const q = R.q;
      if (!q || q.pooled || q.level !== S.track(q.track).level) return '';
      const m = S.mastery(q.track);
      return m.full && !m.dayOk && !S.nextNeeds(q.track) ? '<div class="levelup"><strong>Level complete for today</strong>A right answer on another day confirms it, after your ear has slept on it.</div>' : '';
    }
    const tr = TRACK[u.track];
    if (u.complete) return `<div class="levelup"><strong>${esc(tr.name)} complete</strong>You have mastered every level in this track. It stays in your review mix.</div>`;
    const lv = tr.levels[u.to];
    return `<div class="levelup"><strong>Level ${u.to + 1}: ${esc(lv.name)}</strong>You mastered the previous level. ${lv.introduce && lv.introduce.length ? 'New sounds come next; you will meet them before being tested.' : 'The next level changes how the questions are asked.'}</div>`;
  }
  function struggleHTML(q) {
    if (q.pooled || q.level === 0 || q.level !== S.track(q.track).level) return '';
    const m = S.mastery(q.track);
    if (!m.struggling) return '';
    return `<div class="struggle">This level is hard right now. That is normal. Going back one level for a few minutes often helps it click. <button class="btn sm ghost" data-act="levelDown" data-track="${q.track}">Go back a level</button></div>`;
  }
  function feedbackHTML() {
    const q = R.q;
    if (R.phase !== 'feedback') {
      const tip = typeof TIPS[q.track] === 'function' ? TIPS[q.track](q) : TIPS[q.track];
      const keysLine = q.layout === 'ladder' && q.kind === 'choice' && window.matchMedia('(hover: hover)').matches && q.options.every((o) => TL.MODE_SCALE[q.mode || 'major'].includes(o.id))
        ? '<p class="tip muted">Type a note’s number to answer. Space replays everything.</p>' : '';
      return `<div class="fb"><p class="eyebrow">How to listen</p><p class="tip">${esc(tip)}</p>${keysLine}${q.kind === 'sequence' ? '<p class="tip muted">Pick a slot to change it.<span class="kbd-only"> <kbd>⌫</kbd> deletes, <kbd>Enter</kbd> checks.</span></p>' : ''}</div>`;
    }
    if (q.kind === 'choice') {
      const ok = R.chosen === q.answer;
      return `<div class="fb ${ok ? 'good' : 'bad'}">
        <p class="verdict">${ok ? 'Correct' : 'Not quite'}</p>
        ${answerLabelHTML(q, q.answer)}
        ${q.explain ? `<p class="explain"><span class="lab">${esc(q.explainLabel || '')}</span>${esc(q.explain)}</p>` : ''}
        ${ok ? '' : `<p class="explain">You answered <strong>${esc(choiceName(q, R.chosen))}</strong>. Play both and compare.</p>`}
        <div class="row">
          <button class="btn sm" data-act="hear" data-what="correct">Hear ${esc(choiceName(q, q.answer))}</button>
          ${ok ? '' : `<button class="btn sm" data-act="hear" data-what="yours">Hear ${esc(choiceName(q, R.chosen))}</button>`}
          ${ok && R.rt ? `<span class="rt">answered in ${(R.rt / 1000).toFixed(1)} s</span>` : ''}
        </div>
        ${levelUpHTML()}
        ${ok ? '' : struggleHTML(q)}
        <div class="row"><button class="btn primary" data-act="next">${ok && S.settings.autoAdvance && !R.levelUpNow ? 'Next' : 'Continue'} <kbd>Enter</kbd></button></div>
      </div>`;
    }
    // sequence
    const right = R.results.reduce((a, b) => a + b, 0);
    const all = right === R.results.length;
    return `<div class="fb ${all ? 'good' : 'bad'}">
      <p class="verdict">${all ? 'All correct' : `${right} of ${R.results.length} right`}</p>
      ${q.track === 'melody' ? contourSVG(q, R.input) : ''}
      ${q.explain ? `<p class="explain"><span class="lab">${esc(q.explainLabel || '')}</span>${esc(q.explain)}</p>` : ''}
      <div class="row">
        <button class="btn sm" data-act="hear" data-what="correct">Hear it again</button>
        ${all ? '' : '<button class="btn sm" data-act="hear" data-what="yours">Hear what you wrote</button>'}
      </div>
      ${levelUpHTML()}
      ${all ? '' : struggleHTML(q)}
      <div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>
    </div>`;
  }
  function choiceName(q, id) {
    if (q.track === 'degrees') return degText(id).main;
    if (q.track === 'intervals') return TL.IV[id].name;
    const o = q.options.find((x) => x.id === id);
    return o ? o.label : id;
  }

  // ----- sequence -----
  function slotsHTML() {
    const q = R.q;
    const fb = R.phase === 'feedback';
    const isDeg = q.track === 'melody';
    const cell = (id, i, given) => {
      const hue = id ? (isDeg ? DEG[id].hue : rnHue(id)) : 230;
      const label = id ? (isDeg ? degText(id).main : id) : '?';
      let cls = 'slot' + (id ? ' filled' : '') + (isDeg ? '' : ' rn') + (given ? ' given' : '');
      let fix = '';
      if (fb && !given) {
        const ok = R.results[i - q.given.length] === 1;
        cls += ok ? ' is-correct' : ' is-wrong';
        if (!ok) { const corr = q.answer[i - q.given.length]; fix = `<span class="fix">${esc(isDeg ? degText(corr).main : corr)}</span>`; }
      } else if (!given && R.cursor === i - q.given.length && !fb) cls += ' active';
      const attrs = given || fb ? '' : `data-act="slot" data-slot="${i - q.given.length}"`;
      return `<${given || fb ? 'span' : 'button'} class="${cls}" data-i="${i}" ${attrs} ${id ? `data-deg="${isDeg ? id : ''}" style="--h:${hue}"` : ''}>${esc(label)}${fix}</${given || fb ? 'span' : 'button'}>`;
    };
    const cells = [...q.given.map((id, i) => cell(id, i, true)), ...R.input.map((id, i) => cell(id, i + q.given.length, false))];
    return `<div class="slots" id="slots">${cells.join('')}</div>`;
  }
  function seqBodyHTML() {
    const q = R.q;
    const fb = R.phase === 'feedback';
    const opts = q.layout === 'ladder'
      ? ladderHTML(q.options, q.mode, 'pick', fb ? { dim: true } : {})
      : `<div class="choices">${q.options.map((o, i) => `<button class="choice" data-act="pick" data-id="${esc(o.id)}" style="box-shadow: inset 0 -3px 0 oklch(var(--mark-l) var(--mark-c) ${rnHue(o.id)})"><span class="lbl serif">${esc(o.label)}</span>${gridKey(i) ? `<kbd>${gridKey(i)}</kbd>` : ''}</button>`).join('')}</div>`;
    const filled = R.input.every(Boolean);
    return `<div class="slots-wrap${fb ? ' graded' : ''}" style="min-width:0">
      ${slotsHTML()}
      ${fb ? '' : `<div class="seq-actions"><button class="btn sm" data-act="seqBack">Delete <kbd>⌫</kbd></button><button class="btn sm primary" data-act="seqSubmit" ${filled ? '' : 'disabled'}>Check <kbd>Enter</kbd></button></div>`}
      <div style="margin-top:6px">${opts}</div>
    </div>`;
  }
  function renderSeq() {
    const el = $('#slots');
    if (el) el.outerHTML = slotsHTML();
    const btn = $('[data-act="seqSubmit"]');
    if (btn) btn.disabled = !R.input.every(Boolean);
  }
  function contourSVG(q, input) {
    const mel = q.melody;
    const ans = [mel[0]];
    let prev = mel[0];
    input.forEach((id) => { const s = nearestSemi(id, prev); ans.push(s); prev = s; });
    const all = [...mel, ...ans];
    const lo = Math.min(...all) - 1, hi = Math.max(...all) + 1;
    const top = 14, bot = 22;
    const W = 60 + mel.length * 54, H = Math.max(150, (hi - lo) * 15 + top + bot);
    const x = (i) => 46 + i * 54;
    const y = (s) => top + ((hi - s) / (hi - lo)) * (H - top - bot);
    const lines = [];
    for (let s = Math.ceil(lo); s <= hi; s++) {
      const d = TL.degBySemi(s);
      if (!d.diatonic && !mel.some((m) => m === s)) continue;
      lines.push(`<line x1="40" x2="${W - 8}" y1="${y(s)}" y2="${y(s)}" stroke="var(--line)" stroke-width="1"/><text x="34" y="${y(s) + 4}" text-anchor="end">${esc(degText(d.id).main)}</text>`);
    }
    const path = mel.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s)}`).join(' ');
    const dots = mel.map((s, i) => `<circle cx="${x(i)}" cy="${y(s)}" r="7" style="fill:oklch(var(--mark-l) var(--mark-c) ${TL.degBySemi(s).hue})" stroke="var(--surface)" stroke-width="2"/>`).join('');
    const wrong = ans.map((s, i) => (i > 0 && TL.mod12(s) !== TL.mod12(mel[i]) ? `<circle cx="${x(i)}" cy="${y(s)}" r="7" fill="none" stroke="var(--bad)" stroke-width="2" stroke-dasharray="3 2"/>` : '')).join('');
    return `<div class="tbl-wrap"><svg class="contour" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="Melody contour: the correct melody as colored dots, your wrong notes as dashed red circles">${lines.join('')}<path d="${path}" fill="none" stroke="var(--ink-2)" stroke-width="2"/>${wrong}${dots}</svg></div>
      <div class="legend"><span><i style="background:var(--ink-2)"></i>the melody</span><span><i style="background:transparent;border:2px dashed var(--bad)"></i>where you placed a wrong note</span></div>`;
  }

  // ----- sing -----
  // A row of note names; with semis, the names sit higher or lower to show the melody's shape.
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
    if (q.deg) { const d = degText(q.deg); target = `<p class="sing-target deg" style="--h:${DEG[q.deg].hue}">${esc(d.main)}${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</p>`; }
    else if (q.pattern) target = patternRow(q.pattern, q.patternSemis);
    let after = '';
    if (R.phase !== 'answering') {
      if (q.echoAnswer) after = `<p class="muted">It was:</p>${patternRow(q.echoAnswer, q.echoSemis)}`;
      if (q.bassAnswer) { const d = degText(q.bassAnswer); after = `<p class="muted">The bass was <strong>${esc(d.main)}</strong>.</p>`; }
    }
    const melodyLike = !!(q.pattern || q.echoAnswer);
    const heard = R.mic && R.mic.result && R.mic.state === 'heard' ? R.mic.result : null;
    const shown = heard && R.mic.shown;
    if (shown && R.phase !== 'answering') after = micResultHTML(q, heard);
    let controls;
    if (R.phase === 'answering' && R.mic && R.mic.state !== 'off') {
      controls = micPanelHTML(q);
    } else if (R.phase === 'answering') {
      controls = `<button class="btn primary lg" data-act="singReveal"${R.mainEnd == null ? ' disabled data-needs-main' : ''}>I sang it: play the answer <kbd>Enter</kbd></button>`;
    } else if (R.phase === 'revealed' && heard && !shown) {
      controls = `<p class="tip">${melodyLike ? 'Sing it again along with the answer. Same notes?' : 'Sing your note again along with the answer. Do they melt into one sound?'}</p>`;
    } else if (R.phase === 'revealed' && heard) {
      const sug = heard.v;
      const gb = (v, label, key) => `<button class="btn${v === sug ? ' primary' : ''}" data-act="singGrade" data-v="${v}">${label}${v === sug ? ' · the app’s grade' : v > sug ? ' · it misheard me' : ''} <kbd>${v === sug ? 'Enter' : key}</kbd></button>`;
      const replayed = q.echoAnswer && R.replays > 1;
      controls = `${replayed ? '<p class="tip">You replayed the melody, so this round is practice. It does not count for or against you.</p>' : R.mic.warmup ? '<p class="tip">A warm-up round with the microphone: it does not count yet.</p>' : ''}
        <div class="grade">
          ${gb(1, 'Matched', 1)}${gb(0.5, 'Close', 2)}${gb(0, 'Missed', 3)}
          <button class="btn ghost" data-act="replay" data-part="reveal">Hear it again</button>
        </div>
        <p class="muted" style="font-size:13.5px;max-width:60ch"><span class="kbd-only">Enter keeps the app’s grade. </span>If you know you were further off, choose a lower grade. If the app misheard you, choose what you sang: that round is not scored either way.</p>`;
    } else if (R.phase === 'revealed') {
      const replayed = q.echoAnswer && R.replays > 1;
      controls = `${replayed ? '<p class="tip">You replayed the melody, so this round is practice. It does not count for or against you.</p>' : ''}
        <p class="tip">${melodyLike ? 'Sing it again along with the answer. Same notes, at any height?' : 'Keep singing your note while the answer plays. Do they melt into one sound, or does your voice have to move?'}</p>
        <div class="grade">
          <button class="btn" data-act="singGrade" data-v="1">${melodyLike ? 'Matched: every note right' : 'Matched: one sound'} <kbd>1</kbd></button>
          <button class="btn" data-act="singGrade" data-v="0.5">${melodyLike ? 'Close: one note off, or slid' : 'Close: moved a little'} <kbd>2</kbd></button>
          <button class="btn" data-act="singGrade" data-v="0">${melodyLike ? 'Missed: two or more off' : 'Missed: a different note'} <kbd>3</kbd></button>
          <button class="btn ghost" data-act="replay" data-part="reveal">Hear it again</button>
        </div>
        <p class="muted" style="font-size:13.5px;max-width:60ch">Higher or lower is fine if it is the same note. Two notes that only sound nice together, like Sol against Do, are different notes. Not sure? Choose Close.</p>`;
    } else if (R.singMissed) {
      const twoMiss = q.level === 0 && !R.levelUpNow && (R.findDoMisses || 0) >= 2;
      controls = `<p class="tip">${esc(q.missTip)}</p>
        ${twoMiss ? '<p class="tip">Two misses in a row, so your next Find Do round plays Do for you to copy.</p>' : ''}
        <div class="row"><button class="btn" data-act="replay" data-part="model">${esc(q.missLabel)}</button>${heard && A.micOn ? '<button class="btn" data-act="singCopy">Copy it with the app</button>' : ''}</div>
        ${levelUpHTML()}${struggleHTML(q)}
        <div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>`;
    } else {
      controls = `${levelUpHTML()}<div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>`;
    }
    return `<div class="sing">${target}<p class="muted" style="max-width:60ch">${esc(q.subline)}</p>${after}${controls}</div>`;
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
    const skip = '<button class="btn ghost" data-act="micSkipSet">Check myself this set</button>';
    let h2, body, actions;
    if (g === 'ask') {
      h2 = 'Let the app hear you?';
      body = `<p class="lede" style="margin-top:0">In singing questions the app can listen through your microphone and suggest the grade. It is stricter than your own ear, so Missed is normal at first.</p>
        <p class="muted">The sound is analysed on this device as you sing; nothing is recorded or sent. Your browser shows a microphone light during singing sets, and it goes off when the set ends. You can change this in Settings.</p>`;
      actions = '<button class="btn primary lg" data-act="micYes">Use the microphone <kbd>Enter</kbd></button><button class="btn ghost" data-act="micNo">I’ll check myself</button>';
    } else if (g === 'start') {
      h2 = 'Ready to sing';
      body = '<p class="lede" style="margin-top:0">The app listens through your microphone during this set.</p>';
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
    return `<div class="between mic-gate"><p class="eyebrow">Singing set</p><h2>${h2}</h2>${body}<div class="row">${actions}</div></div>`;
  }
  // the line under the meter, from what the listener reports
  function micLine(q, st) {
    const m = R.mic;
    const hold = m.kind === 'hold';
    const along = q.practice && q.model && (q.copy || q.level === 0);
    if (R.mainEnd == null || A.playing()) {
      if (along) return 'Sing along, then sing it once more on your own when it stops.';
      if (R.mainEnd != null) return 'Listen. Sing when it stops.';
      return q.echoAnswer ? 'Listen to the chords, then the melody. Sing it back when it ends.' : 'Listen to the chords. Sing when they stop.';
    }
    if (m.state === 'quiet') return 'I can’t hear you yet. Sing out loud and closer to the microphone.';
    if (m.state === 'missed') {
      const again = m.nulls >= 1 ? ' Or press Done again to check yourself.' : '';
      if (hold) return (m.reason === 'short' ? 'That was short. Sing it again and hold it for a second or two.' : 'I didn’t hear a held note. Sing it out loud and hold it.') + again;
      return 'I didn’t catch the notes. Sing them again, a little louder.' + again;
    }
    if (!st || !st.heard) return hold ? (q.bassAnswer ? 'Sing or hum the lowest note and hold it. Stop when you are done.' : 'Sing it on its name and hold it. Stop when you are done.') : 'Sing the notes. Stop when you are done.';
    return hold && st.held >= 1 ? 'Holding a note. Stop when you are done.' : 'Hearing you…';
  }
  function micPanelHTML(q) {
    const m = R.mic;
    const self = '<button class="btn ghost" data-act="micSkipSet">Check myself instead</button>';
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
      <div class="row"><button class="btn primary" data-act="micDone"${R.mainEnd == null ? ' disabled data-needs-main' : ''}>Done <kbd>Enter</kbd></button>${self}</div>
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
  function micResultHTML(q, res) {
    const tg = singTarget(q);
    const v = res.v;
    const head = v === 1 ? 'Matched' : v === 0.5 ? 'Close' : 'Missed';
    let line = '';
    let marks = '';
    if (tg.kind === 'hold') {
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
        else if (want0 === 0 && (pc === 4 || pc === 7)) line = `You sang another note of the home chord${name ? ` (${name})` : ''}. Do is the one the chords come to rest on.`;
        else line = `${name ? `You sang ${name}.` : 'You sang a different note.'} ${want} is ${dir}.`;
        // the hummed steps tell a key-finding slip from a stepping one
        const first = notes[0];
        if (q.deg && want0 !== 0 && gi > 0 && first && TL.mod12(first.semi) !== 0) line += ` Your first note was ${knownName(first.semi) || 'not Do'}: find Do from the chords before you step.`;
      }
    } else {
      const steps = res.steps || [];
      const right = steps.filter((x) => x.ok).length;
      const way = (res.offset || 0) < 0 ? 'low' : 'high';
      if (res.reason === 'transposed') line = 'The tune was right, but it started on the wrong note. Find Do from the chords first.';
      else if (res.reason === 'offset') line = `Every note was in place, but the whole tune sat ${way} against the key, nearly between notes. Hum Do from the chords before you start.`;
      else if (res.reason === 'drift') line = `The tune was right, but it drifted ${res.drift < 0 ? 'lower' : 'higher'} as you went. Keep Do in your ear.`;
      else if (v === 1) line = `Every note right.${Math.abs(res.offset || 0) >= 25 ? ` The whole tune sat a little ${way}.` : ''}`;
      else line = `${right} of ${tg.semis.length} notes right${res.extra ? `, and ${res.extra === 1 ? 'one extra note' : res.extra + ' extra notes'}` : ''}.${res.reason === 'restart' ? ' You started again, so this counts as Close at most.' : ''}`;
      marks = `<div class="pattern mic-steps">${steps.map((x, i) => {
        const id = TL.degBySemi(x.want).id;
        // a note not met yet is described by direction instead of by name
        const dir = x.got == null ? '' : ((TL.mod12(x.got - x.want) + 6) % 12) - 6 > 0 ? 'you: higher' : 'you: lower';
        const got = x.ok ? '' : `<small>${x.got == null ? 'missing' : knownName(x.got) ? 'you: ' + esc(knownName(x.got)) : dir}</small>`;
        return `<span data-deg="${id}" data-i="${i}" class="${x.ok ? 'ok' : 'bad'}" style="--h:${DEG[id].hue}">${esc(degText(id).main)}${got}</span>`;
      }).join('')}</div>`;
    }
    const bias = R.mic && R.mic.bias ? `<p class="tip">Your held notes tend to sit a little ${R.mic.bias}. Breathe low and aim a touch ${R.mic.bias === 'low' ? 'higher' : 'lower'}.</p>` : '';
    return `<div class="mic-result v${String(v).replace('.', '')}">
      <p class="mic-verdict"><strong>${head}.</strong> ${esc(line)}</p>${bias}
      ${marks}${v === 1 && !res.reason?.match(/drift|slid|wobble/) ? '' : micTraceSVG(tg, res)}
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
      ready: `Your turn. Press Start. After ${n} get-ready clicks, start tapping on the very next click.`,
      countin: `Get ready. Count along: ${counting}. Start tapping on the next 1.`,
      tapping: 'Tap where each note starts.',
      result: R.rResult && R.rResult.pass ? 'In time. Well done.' : 'Not quite. See where the taps landed.',
    }[ph] || '';
    pad.disabled = !(ph === 'ready' || ph === 'countin' || ph === 'tapping');
    pad.classList.toggle('live', ph === 'tapping');
    pad.innerHTML = ph === 'ready' ? `Start<small>${n} get-ready clicks, then tap</small>` : 'Tap<small>or press Space</small>';
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
      const steadyLate = offs.length >= 3 && offs.every((x) => x > 0.04) && Math.max(...offs) - Math.min(...offs) < 0.08;
      panel.className = 'fb ' + (res.pass ? 'good' : 'bad');
      panel.innerHTML = `<p class="verdict">${res.pass ? 'Correct' : 'Not quite'}</p>
        <p class="explain">${esc(lines.join(' '))}</p>
        ${steadyLate ? '<p class="tip">Your taps land late by about the same amount every time. With Bluetooth headphones or a touch screen, that is usually the device’s delay. Open Preferences, Rhythm timing, and press Calibrate.</p>' : ''}
        ${rhythmSVG(q, res)}
        <div class="legend"><span><i style="background:var(--good)"></i>a note you tapped in time</span><span><i style="background:var(--bad)"></i>a note you missed</span><span><i style="background:var(--ink-2);height:3px"></i>your tap</span><span><i style="background:var(--bad);height:3px"></i>a tap off its note</span><span><i style="background:transparent;border:1.5px dashed var(--muted)"></i>rest</span></div>
        <p class="muted" style="font-size:12.5px">A block’s length shows how long the note lasts.</p>
        ${R.rScored && !res.pass ? '<p class="tip muted">Only your first attempt is scored. “Try again” is practice.</p>' : ''}
        ${levelUpHTML()}`;
    } else {
      panel.className = 'fb';
      const countWords = q.rhythm.meter === '6/8' ? 'Count 1 to 6 with the clicks.' : 'Count 1 2 3 4 with the clicks.';
      panel.innerHTML = `<p class="eyebrow">How to listen</p><p class="tip">${countWords} Tap once where each note starts. A long note still gets only one tap. Do not tap on a rest, which is a silence. You see the pattern after you try.</p>${rhythmSVG(q, null)}`;
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
      const counts = c.rhythm ? countLine(c.rhythm) : '';
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
      ? '<p class="lede" style="margin-top:0">Next: <strong>Mixed review</strong>. Questions from the tracks you have practiced, except Sing, shuffled.</p>'
      : `<p class="lede" style="margin-top:0">Next: <strong>${esc(b.role)}</strong>, ${esc(TRACK[b.track].name)}. Level ${levelFor(b) + 1} · ${esc(TRACK[b.track].levels[levelFor(b)].name)}.</p>
         <p class="muted">${esc((TRACK[b.track].taskFor && TRACK[b.track].taskFor(S.settings)) || TRACK[b.track].task)}</p>`;
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
    const tim = Object.entries(A.TIMBRES).map(([k, v]) => `<option value="${k}" ${k === exTimbre() ? 'selected' : ''}>${v}</option>`).join('');
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

  // ======================================================================
  // PROGRESS
  // ======================================================================
  let progTrack = 'degrees';
  function viewProgress() {
    const tot = S.totals();
    const acc7 = S.recentAccuracy(7);
    const lvRows = TRACKS.map((tr) => {
      const t = S.track(tr.id);
      const m = S.mastery(tr.id);
      return `<tr><td><span class="deg" style="--h:${tr.hue};display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--c);margin-right:8px"></span><button class="btn ghost sm" style="padding:0;min-height:0" data-act="go" data-view="track" data-track="${tr.id}">${esc(tr.name)}</button></td>
        <td class="r num">${t.level + 1} / ${tr.levels.length}</td><td>${esc(tr.levels[t.level].name)}</td>
        <td style="min-width:120px"><div class="meter deg" style="--h:${tr.hue}"><span style="width:${(t.complete ? 1 : m.pct) * 100}%"></span></div></td></tr>`;
    }).join('');
    const confs = S.topConfusions(6);
    const confHTML = confs.length ? `<ul class="conf-list">${confs.map((c) => {
      const drill = ['degrees', 'intervals', 'chords'].includes(c.track);
      return `<li><span>Heard <strong>${esc(itemName(c.track, c.asked))}</strong> as <strong>${esc(itemName(c.track, c.said))}</strong> <span class="muted">· ${c.n} times</span></span>${drill ? `<button class="btn sm" data-act="drillPair" data-track="${c.track}" data-a="${esc(c.asked)}" data-b="${esc(c.said)}">Drill this pair</button>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="empty">Nothing yet. When you mix two sounds up more than once, the pair shows here with a focused drill.</p>';
    return `<div>
      <div class="page-head"><p class="eyebrow">Your record</p><h1>Progress</h1></div>
      <div class="tiles">
        <div class="tile"><div class="v num">${S.streak()}</div><div class="l">day streak</div></div>
        <div class="tile"><div class="v num">${fmtDuration(tot.s).replace(/ min$/, '<small> min</small>')}</div><div class="l">practiced in total, over ${tot.days} day${tot.days === 1 ? '' : 's'}</div></div>
        <div class="tile"><div class="v num">${tot.q}</div><div class="l">questions answered</div></div>
        <div class="tile"><div class="v num">${acc7 == null ? '–' : pct(acc7)}</div><div class="l">accuracy, last 7 days</div></div>
      </div>
      <div class="chart-card" id="activity">
        <h3>Questions per day</h3>
        <p class="sub">The last five weeks. The dashed line is your daily goal (${S.settings.dailyGoal}).</p>
        ${activityChart()}
        <div class="legend" style="margin:6px 0 4px"><span><i style="background:var(--accent)"></i>goal met</span><span><i style="background:color-mix(in oklab, var(--accent) 45%, var(--surface))"></i>below goal</span></div>
        <div class="tooltip" id="tip" hidden></div>
      </div>
      <div class="grid-2">
        <section>
          <div class="section-title"><h2>Levels</h2></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Track</th><th class="r">Level</th><th>Now learning</th><th>Mastery</th></tr></thead><tbody>${lvRows}</tbody></table></div>
          <div class="section-title" style="margin-top:30px"><h2>Common mix-ups</h2></div>
          ${confHTML}
        </section>
        <section>
          <div class="section-title"><h2>Accuracy by item</h2></div>
          <div class="seg" role="group" aria-label="Track" style="margin-bottom:14px">${TRACKS.map((t) => `<button data-act="progTrack" data-track="${t.id}" aria-pressed="${progTrack === t.id}">${esc(t.short)}</button>`).join('')}</div>
          ${accBars(progTrack)}
          <p class="muted" style="font-size:12.5px;margin-top:10px">Recent accuracy, weighted toward your latest answers.</p>
        </section>
      </div>
    </div>`;
  }
  function accBars(trackId) {
    const rows = itemOrder(trackId).map((it) => ({ it, s: S.item(trackId, it) })).filter((x) => x.s.n > 0);
    if (!rows.length) return '<p class="empty">No answers in this track yet.</p>';
    return `<div class="accbars">${rows.map(({ it, s }) => `<div class="accbar deg" style="--h:${itemHue(trackId, it)}">
      <span class="nm"><i></i><span>${esc(itemName(trackId, it))}</span></span>
      <span class="track"><span style="width:${Math.max(2, s.e * 100)}%"></span></span>
      <span class="pc">${pct(s.e)} · ${s.n}</span></div>`).join('')}</div>`;
  }
  function activityChart() {
    const days = 35;
    const data = [];
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const k = TL.dayKey(d);
      const v = S.state.days[k];
      data.push({ k, date: new Date(d), q: S.dayQ(v), acc: v && v.q ? v.c / v.q : null, s: v ? v.s : 0 });
      d.setDate(d.getDate() + 1);
    }
    const goal = S.settings.dailyGoal;
    const top = Math.max(goal * 1.25, ...data.map((x) => x.q), 10);
    const step = top > 80 ? 40 : top > 40 ? 20 : 10;
    const max = Math.ceil(top / step) * step;
    const W = 700, H = 200, L = 34, Rp = 6, T = 10, B = 24;
    const iw = W - L - Rp, ih = H - T - B, bw = iw / days;
    const y = (v) => T + ih - (v / max) * ih;
    const out = [];
    for (let v = 0; v <= max; v += step) out.push(`<line class="grid" x1="${L}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
    data.forEach((p, i) => {
      const x0 = L + i * bw + 1, w = bw - 2;
      if (p.q > 0) {
        const yt = y(p.q), yb = y(0), r = Math.min(3, w / 2, yb - yt);
        out.push(`<path class="bar ${p.q >= goal ? '' : 'under'}" d="M${x0},${yb} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x0 + w - r} Q${x0 + w},${yt} ${x0 + w},${yt + r} V${yb} Z"/>`);
      }
      if (i % 7 === 0 || i === days - 1) out.push(`<text x="${x0 + w / 2}" y="${H - 6}" text-anchor="middle">${p.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`);
      out.push(`<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" data-i="${i}" data-tip="${esc(`${p.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${p.q} question${p.q === 1 ? '' : 's'}${p.acc != null ? ' · ' + pct(p.acc) : ''}${p.s ? ' · ' + Math.round(p.s / 60) + ' min' : ''}`)}"/>`);
    });
    out.push(`<line class="goal" x1="${L}" x2="${W - Rp}" y1="${y(goal)}" y2="${y(goal)}"/>`);
    return `<div class="tbl-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Questions answered per day over the last five weeks">${out.join('')}</svg></div>`;
  }

  // ======================================================================
  // METHOD
  // ======================================================================
  function viewMethod() {
    const P = [
      ['Hear in a key', 'Questions that ask you to name or sing a note start with four chords that set the key (a cadence). You name each note by its place in the key (Do, Re, Mi) rather than as an isolated distance. After each answer the note walks home to Do, so you feel where it pulls.', 'Functional ear training (Alain Benbassat); movable-do solfège as used in the Kodály approach.'],
      ['Sound before symbol', 'You meet each new sound by listening and singing before you are tested on its name. Names attach to sounds you already know, not the other way round.', 'Edwin Gordon’s Music Learning Theory; Kodály.'],
      ['One new thing at a time', 'You start with Do and Sol, which sound very different, and add a single note when the current set is solid. Coarse distinctions come first, fine ones later.', 'Perceptual learning; Gary Karpinski, Aural Skills Acquisition (2000).'],
      ['Mastery before moving on', 'A level opens when 18 of your last 20 answers are right (16 points of 20 for singing, where Close counts half and practice rounds are not counted), each new item has been answered correctly a few times, and those answers come from at least two different days, so a night’s sleep has confirmed them. You can always skip ahead if a level is too easy.', 'Mastery learning.'],
      ['Mistakes become contrasts', 'When you confuse two sounds you hear both side by side. The missed item comes back a few questions later, and pairs you often mix up get their own drill on the Progress page.', 'Discrimination training; immediate, informative feedback.'],
      ['Spacing and mixing', 'Items you know come back at growing intervals (1, 2, 4, 8, 16 days). Each session mixes skills. Mixing feels harder at the time and produces more durable learning.', 'Spacing effect (Cepeda et al., 2006); interleaving (Rohrer & Taylor, 2007); “desirable difficulties” (Bjork, 1994).'],
      ['Sing it', 'Singing ties hearing to an internal image of the sound. This is audiation: hearing music in your head, which is what you need to write away from an instrument.', 'Gordon; Kodály.'],
      ['An honest check', 'Beginners cannot yet hear their own pitch errors, so the app can listen through the microphone. It waits until you finish, without a live pitch display, so you sing from the inner ear rather than chase a needle. Then the answer plays while you sing along, and only after that does it show what it heard. A note counts as right when the nearest semitone is the target. You can always lower the grade; raising it means the app misheard, so that round does not count.', 'Singing-accuracy research (Pfordresher and colleagues); feedback after, not during, the attempt (Guadagnoli and Kohl).'],
      ['Vary what doesn’t matter', 'Keys change, registers widen and instruments can rotate, so you learn how a sound behaves in the key rather than memorizing a particular pitch or timbre.', 'Variability of practice.'],
    ];
    return `<div>
      <div class="page-head"><p class="eyebrow">How Tone Ladder teaches</p><h1>The method</h1><p class="lede">The course is built for a composer starting with little ear training. It follows the approaches with the strongest track record in aural-skills teaching, and it schedules practice the way learning research recommends.</p></div>
      <div class="principles">${P.map(([h, p, s]) => `<div class="principle"><h3>${esc(h)}</h3><p>${esc(p)}</p><p class="src">${esc(s)}</p></div>`).join('')}</div>
      <div class="prose" style="margin-top:30px">
        <h2>The tracks, and the order they open</h2>
        <ol>
          <li><strong>Scale Degrees</strong>, every day. Hearing each note by its place in the key is the foundation the other skills sit on.</li>
          <li><strong>Intervals</strong> and <strong>Chord Qualities</strong> from day one. They give you names for distances and colors.</li>
          <li><strong>Melodic Dictation</strong> opens when you reach Scale Degrees level 3. By then Do, Mi and Sol are solid, and you are meeting Re.</li>
          <li><strong>Harmony</strong> opens at Scale Degrees level 4 and Chord Qualities level 2. Hearing a bass line as scale degrees is what makes Roman numerals hearable.</li>
          <li><strong>Rhythm</strong> and <strong>Sing</strong> run alongside everything. Each Sing level waits until Scale Degrees has taught its notes.</li>
        </ol>
        <h2>How to practice</h2>
        <ul>
          <li><strong>Ten to fifteen minutes a day.</strong> The Today plan is sized for that. Short daily sessions beat long occasional ones.</li>
          <li><strong>Sing out loud</strong>, or hum. If you can sing a note, you can hear it.</li>
          <li><strong>Don’t rush.</strong> Accuracy first. Response time is tracked but never required; speed follows accuracy.</li>
          <li><strong>Expect about 80% right.</strong> Questions are pitched at the edge of what you can hear. Scores in the 70s and 80s mean the training is working.</li>
          <li><strong>Take it to your own music.</strong> Once a week, sing the bass line of a piece you love in scale degrees, or work out a melody in Explore. Before writing a melody down, sing it in solfège first.</li>
        </ul>
        <h2>Further reading</h2>
        <ul class="refs">
          <li>Gary S. Karpinski, <em>Aural Skills Acquisition</em> (Oxford University Press, 2000).</li>
          <li>Edwin E. Gordon, <em>Learning Sequences in Music: A Contemporary Music Learning Theory</em> (GIA Publications).</li>
          <li>Lois Choksy, <em>The Kodály Method</em> (Prentice Hall).</li>
          <li>Alain Benbassat, notes on functional ear training (author of the Functional Ear Trainer app).</li>
          <li>N. J. Cepeda et al., “Distributed practice in verbal recall tasks,” <em>Psychological Bulletin</em> (2006).</li>
          <li>D. Rohrer &amp; K. Taylor, “The shuffling of mathematics problems improves learning,” <em>Instructional Science</em> (2007).</li>
        </ul>
      </div>
    </div>`;
  }

  // ======================================================================
  // PREFERENCES
  // ======================================================================
  let resetArmed = false;
  const MOVE = { copied: null, pasting: false, error: '', warn: '', pasted: '' };
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
  function micPrefNote() {
    if (window.isSecureContext === false) return 'The microphone needs a secure (https) page, so you check your own singing here.';
    if (!A.micSupported()) return 'This browser cannot use a microphone, so you check your own singing.';
    if (!micAvailable()) return 'The microphone is not available in this copy of Tone Ladder. It works at noaware.io/tone-ladder/.';
    if (MIC.prefErr) return (MIC_PREF_ERR[MIC.prefErr] || MIC_PREF_ERR.other)();
    if (MIC.perm === 'denied') return `The browser blocks the microphone for this site. ${micUnblockHint()}`;
    return 'In Sing questions the microphone listens and suggests the grade. The sound is analysed on this device and never recorded or sent.';
  }
  // Play a pure A through the speakers and listen for it: the speaker and the mic must agree on pitch.
  async function micTest() {
    const say = (t) => { const el = $('#micTestOut'); if (el) el.textContent = t; };
    if (R) return;
    const run = ++MIC.test;
    const mine = () => run === MIC.test && !R;
    const wasOpen = A.micOn;
    try { await A.micOpen(); } catch (e) { if (mine() && !(e && e.tlClosed)) say('The microphone could not start.'); return; }
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
    if (!wasOpen) A.micClose();
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
          ${row('Instrument', 'Varying the instrument helps you hear each note’s place in the key, not the sound of one instrument.', sel('timbre', [...Object.entries(A.TIMBRES), ['vary', 'Vary by question']]))}
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
          ${row('Daily goal', 'Sets the length of the Today plan.', sel('dailyGoal', [[15, '15 questions · about 6 min'], [30, '30 questions · about 12 min'], [50, '50 questions · about 20 min']]))}
          ${row('Auto-advance', 'Move on after a correct answer once the answer has finished playing.', chk('autoAdvance', 'On'))}
          ${row('Dictation playback', 'Hear each note or chord as you enter it. Easier, but less training of your inner ear.', chk('dictationSound', 'On'))}
          ${row('Singing range', 'Where the answer note plays in singing questions.', sel('voice', CUR.VOICE_LABELS))}
          ${row('Check my singing', micPrefNote(), micAvailable() ? `<select id="pref-mic" data-change="micPref">${micPref() ? '' : '<option value="" selected disabled>Not chosen: asks at the next singing set</option>'}<option value="on" ${micPref() === 'on' ? 'selected' : ''}>With the microphone</option><option value="off" ${micPref() === 'off' ? 'selected' : ''}>Myself</option></select>${MIC.prefErr === 'dismissed' ? ' <button class="btn ghost" data-act="micAsk">Ask again</button>' : ''}` : '<span class="muted" style="font-size:13px">Myself</span>')}
          ${micAvailable() && micPref() === 'on' ? '<div class="row"><button class="btn ghost" data-act="micTest">Test the microphone</button><span class="muted" id="micTestOut" style="font-size:13px"></span></div>' : ''}
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
            <span>Copy your progress here, then paste it into Tone Ladder in another browser or on another device, or between noaware.io and the claude.ai version.</span>
            <div class="row"><button class="btn" data-act="exportProgress">Copy my progress</button><button class="btn" data-act="importOpen">Paste progress…</button></div>
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

  // ======================================================================
  // ROUTING & RENDER
  // ======================================================================
  function go(view, params = {}) {
    if (R && view !== 'session') endRunner();
    if (view !== 'explore') { A.droneStop(0.3); }
    app.view = view;
    app.params = params;
    resetArmed = false;
    Object.assign(MOVE, { copied: null, pasting: false, error: '', warn: '', pasted: '' });
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    document.body.classList.toggle('in-session', app.view === 'session');
    $$('#nav button').forEach((b) => {
      const v = b.dataset.view;
      if ((app.view === v) || (app.view === 'track' && v === 'today')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const v = $('#view');
    if (app.view === 'session') { if (R) renderSession(); else { app.view = 'today'; v.innerHTML = viewToday(); } return; }
    const views = { today: viewToday, track: viewTrack, explore: viewExplore, progress: viewProgress, method: viewMethod, prefs: viewPrefs };
    const newer = S.blocked ? `<section class="welcome" style="grid-template-columns:1fr;margin-top:12px"><div>
        <p class="eyebrow">Update needed</p>
        <h2>Your progress was saved by a newer version of Tone Ladder</h2>
        <p>This page is out of date, so it will not save anything until it is reloaded. Reload to get the new version; your progress is safe.</p>
        <div class="row" style="margin-top:16px"><button class="btn primary" data-act="reload">Reload</button></div>
      </div></section>` : '';
    v.innerHTML = newer + (views[app.view] || viewToday)();
  }

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
    startDaily: () => {
      const saved = savedPlan();
      if (planLeft(saved)) { startSession(saved.blocks, { daily: true, day: saved.day }); return; }
      startSession(buildDailyPlan(), { daily: true, day: TL.dayKey() });
    },
    practice: (d) => startSession([{ track: d.track, count: FREE_COUNT[d.track], role: 'Practice' }]),
    practiceLevel: (d) => {
      // a higher open level becomes the current one; a lower one is review and leaves mastery alone
      const L = +d.level;
      if (L > S.track(d.track).level) S.setLevel(d.track, L);
      const cur = S.track(d.track).level;
      startSession([{ track: d.track, count: FREE_COUNT[d.track], role: L < cur ? 'Review' : 'Practice', level: L < cur ? L : null }]);
    },
    reintro: (d) => { const t = S.track(d.track); if (S.introSeen(d.track, t.level)) t.intro[t.level] = false; startSession([{ track: d.track, count: FREE_COUNT[d.track], role: 'Practice' }]); },
    skipAhead: (d) => {
      if (S.blocked) { toast('Reload the page first: your progress was saved by a newer version.'); return; }
      S.skipAhead(d.track); toast('Moved ahead one level.'); render();
    },
    soundCheck,
    selfTest: async () => {
      const out = $('#selfTestOut');
      try {
        const r = await A.renderTest('pure', 69);
        if (!r) { out.textContent = 'Offline rendering is not supported here.'; return; }
        out.textContent = r.peak > 0.01 && Math.abs(r.hz - 440) < 8 ? `Working: A4 measured at ${Math.round(r.hz)} Hz.` : `Unexpected output (peak ${r.peak.toFixed(3)}, ${Math.round(r.hz)} Hz).`;
      } catch (e) { out.textContent = 'Test failed: ' + e.message; }
    },
    exitSession,
    answer: (d) => answerChoice(d.id),
    pick: (d) => seqPick(d.id),
    slot: (d) => seqSelect(+d.slot),
    seqBack,
    seqSubmit,
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
    dismissNew: () => { S.state.seen.v2 = true; S.touch(); render(); },
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
    singReveal,
    singGrade: (d) => singGrade(+d.v),
    micYes: () => micGo(),
    micNo: () => { setMicPref('off'); toast('You can turn the microphone on later in Settings.', 2200); if (R && R.phase === 'mic') nextQuestion(); },
    micDone: () => micFinish(true),
    micSkipSet,
    micTap: () => { A.ensure(); A.wake(); setTimeout(() => { if (R && R.phase === 'mic' && R.micGate === 'tap') { if (A.running) nextQuestion(); else renderStage(); } }, 200); },
    micContinue: () => { if (R && R.phase === 'mic') nextQuestion(); },
    micResume,
    singCopy,
    micTest,
    micAsk: () => micPrefAsk(),
    rListen: () => { if (R && R.q && R.q.kind === 'tap' && R.rPhase !== 'countin' && R.rPhase !== 'tapping') rhythmListen(); },
    rGo: () => rhythmGo(),
    weakRound: () => {
      const weak = Object.values(R.itemsSession).filter((s) => s.n >= 2 && s.c / s.n < 0.75);
      const byTrack = {};
      weak.forEach((s) => (byTrack[s.track] = (byTrack[s.track] || 0) + 1));
      const tid = Object.entries(byTrack).sort((a, b) => b[1] - a[1])[0][0];
      endRunner();
      startSession([{ track: tid, count: Math.round(FREE_COUNT[tid] * 0.6), role: 'Weak spots' }]);
    },
    drillPair: (d) => startSession([{ track: d.track, count: 12, role: 'Pair drill', pool: [d.a, d.b] }]),
    progTrack: (d) => { progTrack = d.track; render(); },
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
    exportProgress: () => {
      const text = S.exportText();
      const fallback = () => { if (app.view !== 'prefs') go('prefs'); MOVE.copied = text; render(); const t = $('#exportText'); if (t) { t.focus(); t.select(); } };
      try {
        navigator.clipboard.writeText(text).then(() => { MOVE.copied = null; setDeviceInfo({ backupAt: Date.now() }); toast('Progress copied. Keep it somewhere safe, or paste it into another Tone Ladder under Preferences.', 3600); render(); }, fallback);
      } catch (e) { fallback(); }
    },
    reload: () => location.reload(),
    backupLater: () => { setDeviceInfo({ snoozeUntil: Date.now() + 14 * 86400000 }); render(); },
    importOpen: () => { Object.assign(MOVE, { pasting: true, error: '', warn: '', pasted: '' }); render(); const t = $('#importText'); if (t) t.focus(); },
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
  });
  function flashPad(sel) { const p = $(sel); if (p) { p.classList.add('hit'); setTimeout(() => p.classList.remove('hit'), 90); } }
  document.addEventListener('change', (e) => {
    const el = e.target;
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
    if (e.target.dataset.pref === 'volume') { S.settings.volume = +e.target.value; applyAudio(); }
  });
  // activity chart tooltip
  document.addEventListener('mousemove', (e) => {
    const tip = $('#tip');
    if (!tip) return;
    const hit = e.target.closest && e.target.closest('rect.hit');
    if (!hit) { tip.hidden = true; return; }
    const card = $('#activity').getBoundingClientRect();
    const r = hit.getBoundingClientRect();
    tip.textContent = hit.dataset.tip;
    tip.hidden = false;
    tip.style.left = (r.left + r.width / 2 - card.left) + 'px';
    tip.style.top = (e.clientY - card.top - 8) + 'px';
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (CAL.active && (e.code === 'Space')) { e.preventDefault(); if (!e.repeat) { CAL.taps.push(A.heardTime(safeTs(e.timeStamp))); flashPad('#calPad'); } return; }
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
      else if (q.kind === 'sequence' && R.phase === 'answering') seqSubmit();
      else if (q.kind === 'sing' && R.phase === 'answering') { if (R.mic && R.mic.state === 'paused') micResume(); else if (R.mic && R.mic.state !== 'off') micFinish(true); else singReveal(); }
      else if (q.kind === 'sing' && R.phase === 'revealed' && R.mic && R.mic.state === 'heard' && R.mic.shown) singGrade(R.mic.result.v);
      return;
    }
    if (k === 'Backspace' && q.kind === 'sequence') { e.preventDefault(); seqBack(); return; }
    const m = e.code.match(/^(?:Digit|Numpad)(\d)$/);
    if (!m) return;
    const digit = m[1];
    if (q.kind === 'sing') { if (R.phase === 'revealed') { const v = { 1: 1, 2: 0.5, 3: 0 }[digit]; if (v != null) singGrade(v); } return; }
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
      if (R && R.phase === 'mic' && R.micGate === 'opening') { MIC.gate++; R.micGate = 'start'; renderStage(); }
    }
  });

  // ---------- boot ----------
  S.onChange(() => {
    if (app.view !== 'session') { render(); return; }
    if (S.blocked && R && R.phase !== 'summary') finishSession(true);
  });
  const h = (location.hash || '').replace('#', '');
  if (['explore', 'progress', 'method', 'prefs'].includes(h)) app.view = h;
  applyAudio();
  render();
  S.init().then(() => { applyAudio(); if (app.view !== 'session') render(); });
  window.__toneLadder = { app, get runner() { return R; }, ACT };
})();
