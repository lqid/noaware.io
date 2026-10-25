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
  function reviewable() {
    return TRACKS.map((t) => t.id).filter((id) => id !== 'sing' && S.isUnlocked(id) && S.track(id).intro[S.track(id).level] && S.track(id).last);
  }
  const planMinutes = (plan) => Math.max(3, Math.round(plan.reduce((a, b) => a + b.count * (SEC_PER[b.track] || 15), 0) / 60));

  // ======================================================================
  // TODAY
  // ======================================================================
  function ladderFigure() {
    const t = S.track('degrees');
    const levels = TRACK.degrees.levels;
    const learned = new Set();
    levels.slice(0, t.level).forEach((lv) => lv.items.forEach((i) => learned.add(i)));
    const cur = levels[t.level];
    cur.items.forEach((i) => { if (!cur.introduce.includes(i) || t.complete) learned.add(i); });
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
      ${unlocked ? `<div class="meter" role="img" aria-label="Mastery ${pct(m.pct)}"><span style="width:${(t.complete ? 1 : m.pct) * 100}%"></span></div><p class="meta">${meta}</p>`
        : `<p class="meta">Opens when you reach ${esc(S.prereqText(tr.id))}.</p>`}
      <div class="actions">
        ${unlocked ? `<button class="btn sm primary" data-act="practice" data-track="${tr.id}">Practice</button>` : ''}
        <button class="btn sm ghost" data-act="go" data-view="track" data-track="${tr.id}">Levels</button>
      </div>
    </article>`;
  }

  function planRow(b) {
    if (b.track === 'mix') return `<li><div class="what"><div class="role">${esc(b.role)}</div><div class="tname">Tracks you have practiced, shuffled</div></div><span class="cnt">${b.count} q</span></li>`;
    const tr = TRACK[b.track];
    const t = S.track(b.track);
    return `<li><div class="what"><div class="role">${esc(b.role)}</div><div><span class="tname">${esc(tr.name)}</span> <span class="lv">· ${esc(tr.levels[t.level].name)}</span></div></div><span class="cnt">${b.count} q</span></li>`;
  }

  function viewToday() {
    const plan = buildDailyPlan();
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
    const whyRows = [...new Set(plan.map((b) => b.role))].filter((r) => WHY[r]).map((r) => `<div><strong>${esc(r)}</strong><p>${esc(WHY[r])}</p></div>`).join('');
    return `<div class="today">
      ${S.state.onboarded ? '' : welcome}${whatsNew}
      <section class="hero">
        <div>
          <p class="eyebrow">${esc(date)}</p>
          <h1>${met ? 'Today’s goal is <em>met</em>' : 'Today’s <em>practice</em>'}</h1>
          <p class="lede">${met ? 'You can stop here, or run another set. Extra practice still counts toward your review schedule.' : `About ${planMinutes(plan)} minutes in ${plan.length} short sets. Sing along whenever you can.`}</p>
          <div class="hero-actions">
            <button class="btn primary lg" data-act="startDaily">${met ? 'Practice again' : dayQ ? 'Continue practice' : 'Start practice'}</button>
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
              ? `Level up at ${m.need} points from your last ${m.window} rounds (Matched counts 1, Close counts ½). Practice rounds are not counted.${S.nextNeeds(id) ? ' ' + esc(gateText(id, S.nextNeeds(id))) : ''}`
              : `Level up at ${m.need} right out of your last ${m.window}${(tr.levels[t.level].introduce || []).length ? ', with each new item answered correctly a few times' : ''}.`}</p>
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
    if (!safeAudio()) return;
    A.stop();
    R = {
      plan: plan.map((b) => ({ ...b, done: 0, score: 0, sn: 0 })), bi: -1, phase: null, q: null, qid: 0,
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
    if (R.bi >= R.plan.length) return finishSession();
    const b = block();
    R.retry = [];
    if (b.track === 'mix') { b.tracks = reviewable(); if (!b.tracks.length) return nextBlock(); }
    if (R.bi > 0 && R.plan.length > 1) { R.phase = 'between'; R.q = null; A.stop(); renderSession(); }
    else nextQuestion();
  }

  function introData(trackId, L, tonic) {
    const st = S.settings;
    return TRACK[trackId].intro(L, { tonic, hints: st.hints, voice: st.voice, context: st.context, cadenceEvery: st.cadenceEvery, keyMode: st.keyMode, labels: st.labels });
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
      if (!b.tracks.length) return nextBlock();
    }
    const trackId = b.track === 'mix' ? pickMixTrack(b) : b.track;
    const tr = TRACK[trackId];
    const t = S.track(trackId);
    const L = b.track === 'mix' ? t.level : levelFor(b);
    const lv = tr.levels[L];
    if (b.track !== 'mix' && !S.introSeen(trackId, L)) return showIntro(trackId, L);
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
    setListening(true);
    const h = A.play(evs, { timbre: q.timbre, lead, onEvent: (ev, i) => litEvent(q, ev, i, revealing) });
    if (part === 'main' && R.phase === 'answering') R.replays++;
    const id = q.id;
    h.done.then((ok) => {
      if (!R || !R.q || R.q.id !== id) return;
      setListening(false);
      if (part === 'main' && ok && R.mainEnd == null) {
        R.mainEnd = performance.now();
        $$('[data-needs-main]').forEach((el) => (el.disabled = false));
        setListening(false);
      }
    });
    return h;
  }
  function setListening(on) {
    const el = $('#listenState');
    if (!el) return;
    el.classList.toggle('idle', !on);
    const label = $('span:last-child', el);
    if (label) label.textContent = on ? 'Listening' : R && R.phase === 'answering' ? (R.q && R.q.kind === 'sing' ? 'Your turn: sing' : 'Your turn') : R && R.phase === 'revealed' ? 'Now grade it' : 'Ready';
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
    S.record({ track: q.track, level: scored ? q.level : -1, items: q.stats, results, rt, confusions, practice: !!q.practice });
    // the first answer ends onboarding; a newcomer never needs the 'updated' notice
    if (!S.state.onboarded) { S.state.onboarded = true; S.state.seen.v2 = true; }
    b.done++;
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
    if (!q || q.kind !== 'sing' || R.phase !== 'revealed') return;
    if (q.echoAnswer && R.replays > 1) q.practice = true; // the melody was replayed
    if (q.level === 0 && !q.practice) R.findDoMisses = v === 0 ? (R.findDoMisses || 0) + 1 : 0;
    commit(q, [v], 0, []);
    if (q.level === 0 && !q.practice && R.findDoMisses >= 2 && !R.levelUpNow) { S.state.findDoPracticeNext = true; S.touch(); }
    R.phase = 'feedback';
    if (v === 0 && q.model) { R.singMissed = true; renderStage(); setListening(false); return; }
    if (R.levelUpNow) { renderStage(); setListening(false); return; }
    toast(`Saved: ${GRADE_NAME[v]}${q.practice ? ' (practice)' : ''}`, 1100);
    const id = q.id;
    setTimeout(() => { if (R && R.q && R.q.id === id) nextQuestion(); }, 450);
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
    A.stop();
    A.droneStop(0.5);
    releaseWake();
    R.phase = 'summary';
    R.early = early;
    S.setBusy(false);
    R.q = null;
    S.save(true);
    renderSession();
  }
  function endRunner() {
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
      <div class="s-title">${R.phase === 'summary' ? '<strong>Session complete</strong>' : `<span class="s-role">${esc(role)}${b && b.track === 'mix' ? ' · shuffled' : ''}</span><strong>${tr ? esc(tr.name) : 'Everything so far'}</strong>${tr ? `<span class="s-level">Level ${L + 1} · ${esc(tr.levels[L].name)}</span>` : ''}`}</div>
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
    const listen = `<span class="listen-state" id="listenState"><i class="pulse"></i><span>Listening</span></span>`;
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
    if (!u) return '';
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
    let controls;
    if (R.phase === 'answering') {
      controls = `<button class="btn primary lg" data-act="singReveal"${R.mainEnd == null ? ' disabled data-needs-main' : ''}>I sang it: play the answer <kbd>Enter</kbd></button>`;
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
        <div class="row"><button class="btn" data-act="replay" data-part="model">${esc(q.missLabel)}</button></div>
        ${levelUpHTML()}${struggleHTML(q)}
        <div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>`;
    } else {
      controls = `${levelUpHTML()}<div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>`;
    }
    return `<div class="sing">${target}<p class="muted" style="max-width:60ch">${esc(q.subline)}</p>${after}${controls}</div>`;
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
    const prev = R.plan[R.bi - 1];
    const b = block();
    const prevName = prev.track === 'mix' ? 'Mixed review' : TRACK[prev.track].name;
    const prevScore = prev.done === 0 ? 'skipped' : prev.sn ? pct(prev.score / prev.sn) : 'practice rounds only';
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
    const blocks = R.plan.filter((b) => b.done > 0).map((b) => `<li><span>${esc(b.role)}${b.track === 'mix' ? '' : ' · ' + esc(TRACK[b.track].name)}</span><span class="sc">${b.done} q · ${b.sn ? pct(b.score / b.sn) : 'practice'}</span></li>`).join('');
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
      <p class="muted">${!R.sn ? 'Practice rounds are not scored. Your progress is saved.' : acc < 0.7 ? 'Lower scores mean the questions are working at the edge of what you can hear. That is where learning happens.' : 'Progress is saved. Missed items will come back sooner in your next sessions.'}</p>
      <div class="row"><button class="btn primary lg" data-act="go" data-view="today">Done</button>${weak.length ? '<button class="btn lg" data-act="weakRound">Drill the weak spots</button>' : ''}</div>
    </div>`;
  }

  // ======================================================================
  // EXPLORE
  // ======================================================================
  const EX = { pc: 0, mode: 'major', timbre: null, prev: null, trail: [], dir: 'a', resolve: true };
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
    if (EX.trail.length > 10) EX.trail.shift();
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
      ['Mastery before moving on', 'A level opens when 18 of your last 20 answers are right (16 points of 20 for singing, where Close counts half and practice rounds are not counted), and each new item has been answered correctly a few times. You can always skip ahead if a level is too easy.', 'Mastery learning.'],
      ['Mistakes become contrasts', 'When you confuse two sounds you hear both side by side. The missed item comes back a few questions later, and pairs you often mix up get their own drill on the Progress page.', 'Discrimination training; immediate, informative feedback.'],
      ['Spacing and mixing', 'Items you know come back at growing intervals (1, 2, 4, 8, 16 days). Each session mixes skills. Mixing feels harder at the time and produces more durable learning.', 'Spacing effect (Cepeda et al., 2006); interleaving (Rohrer & Taylor, 2007); “desirable difficulties” (Bjork, 1994).'],
      ['Sing it', 'Singing ties hearing to an internal image of the sound. This is audiation: hearing music in your head, which is what you need to write away from an instrument.', 'Gordon; Kodály.'],
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
    v.innerHTML = (views[app.view] || viewToday)();
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
    startDaily: () => startSession(buildDailyPlan(), { daily: true }),
    practice: (d) => startSession([{ track: d.track, count: FREE_COUNT[d.track], role: 'Practice' }]),
    practiceLevel: (d) => {
      // a higher open level becomes the current one; a lower one is review and leaves mastery alone
      const L = +d.level;
      if (L > S.track(d.track).level) S.setLevel(d.track, L);
      const cur = S.track(d.track).level;
      startSession([{ track: d.track, count: FREE_COUNT[d.track], role: L < cur ? 'Review' : 'Practice', level: L < cur ? L : null }]);
    },
    reintro: (d) => { const t = S.track(d.track); if (S.introSeen(d.track, t.level)) t.intro[t.level] = false; startSession([{ track: d.track, count: FREE_COUNT[d.track], role: 'Practice' }]); },
    skipAhead: (d) => { S.skipAhead(d.track); toast('Moved ahead one level.'); render(); },
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
        if (reshow && t.level === 0) { t.window = []; t.levelStats = {}; }
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
    skipBlock: () => { if (R && R.phase === 'between') { block().count = 0; nextBlock(); } },
    singReveal,
    singGrade: (d) => singGrade(+d.v),
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
    exMode: (d) => { EX.mode = d.mode; EX.prev = null; EX.trail = []; render(); },
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
      if (!safeAudio() || !EX.trail.length) return;
      const v = TL.voiceProgression(EX.trail, exTonic());
      A.play(v.map((notes, i) => ({ t: i * 1.0, notes, dur: i === v.length - 1 ? 1.6 : 0.94, vel: 0.62 })), { timbre: exTimbre() });
    },
    exResetTrail: () => { EX.trail = []; EX.prev = null; render(); },
    exportProgress: () => {
      const text = S.exportText();
      const fallback = () => { MOVE.copied = text; render(); const t = $('#exportText'); if (t) { t.focus(); t.select(); } };
      try {
        navigator.clipboard.writeText(text).then(() => { MOVE.copied = null; toast('Progress copied. Paste it into the other Tone Ladder, under Preferences.', 3600); render(); }, fallback);
      } catch (e) { fallback(); }
    },
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
      S.applyBackup(st);
      Object.assign(MOVE, { pasting: false, error: '', warn: '', pasted: '' });
      applyAudio();
      toast('Progress loaded.');
      render();
    },
    importUndo: () => {
      if (S.undoImport()) { applyAudio(); toast('Restored the progress from before the paste.'); }
      render();
    },
    resetArm: () => { resetArmed = true; render(); },
    resetCancel: () => { resetArmed = false; render(); },
    resetConfirm: () => { S.reset(); resetArmed = false; toast('Progress erased.'); render(); },
    calibrate,
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
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
    if (el.dataset.change === 'exKey') { EX.pc = +el.value; EX.prev = null; EX.trail = []; if (A.droneTonic != null) A.droneStart(exTonic()); render(); }
    if (el.dataset.change === 'exTimbre') { EX.timbre = el.value; }
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
    const q = R.q;
    const k = e.key;
    if (R.phase === 'intro') { if (k === 'Enter') { e.preventDefault(); ACT.startLevel(); } return; }
    if (R.phase === 'between') { if (k === 'Enter') { e.preventDefault(); ACT.continueBlock(); } return; }
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
      if (R.phase === 'feedback') nextQuestion();
      else if (q.kind === 'sequence' && R.phase === 'answering') seqSubmit();
      else if (q.kind === 'sing' && R.phase === 'answering') singReveal();
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
  });

  // ---------- boot ----------
  S.onChange(() => { if (app.view !== 'session') render(); });
  const h = (location.hash || '').replace('#', '');
  if (['explore', 'progress', 'method', 'prefs'].includes(h)) app.view = h;
  applyAudio();
  render();
  S.init().then(() => { applyAudio(); if (app.view !== 'session') render(); });
  window.__toneLadder = { app, get runner() { return R; }, ACT };
})();
