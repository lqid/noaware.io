/* Tone Ladder — Progress. */
import { DEG, S, TL, TRACK, TRACKS, esc, fmtDuration, itemHue, itemName, micCopy, pct, sungTrack } from './base.js';
import { render } from './router.js';
import { startSession } from './session.js';
import { itemOrder } from './track.js';

  // ======================================================================
  // PROGRESS
  // ======================================================================
  let progTrack = null; // the track picked for week by week and item by item; until one is, the one most practised lately
  function viewProgress() {
    const shown = progTrack || busiestTrack();
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
      const drill = ['degrees', 'intervals', 'chords'].includes(c.track) && (c.track !== 'degrees' || (DEG[c.asked] && DEG[c.said]));
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
        <div class="tooltip" hidden></div>
      </div>
      <section class="weeks">
        <div class="section-title"><h2>Week by week</h2></div>
        <p class="muted" style="font-size:13.5px;margin:-6px 0 12px">One track at a time. Each dot is seven days; the last is the seven days up to today.</p>
        <div class="seg" role="group" aria-label="Track" style="margin-bottom:14px">${TRACKS.map((t) => `<button data-act="progTrack" data-track="${t.id}" aria-pressed="${shown === t.id}">${esc(t.short)}</button>`).join('')}</div>
        ${weekCharts(shown)}
        <div class="by-item">
          <h3>Accuracy by item</h3>
          ${accBars(shown)}
          <p class="muted" style="font-size:12.5px;margin-top:10px">Recent accuracy, weighted toward your latest answers.${sungTrack(shown) ? ' With the microphone, each note also shows how far off it was the last day you sang it, in cents (hundredths of a semitone; 50 is halfway to the next note), with the value from a week or more before in brackets; “low” or “high” means your voice has tended that way on it lately.' : ''}</p>
          ${shown === 'sing' && S.state.guess && S.state.guess.n ? `<p class="muted" style="font-size:12.5px">Your call first: your own grade agreed with the app’s ${S.state.guess.a} of ${S.state.guess.n} times.</p>` : ''}
        </div>
      </section>
      <div class="grid-2">
        <section>
          <div class="section-title"><h2>Levels</h2></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Track</th><th class="r">Level</th><th>Now learning</th><th>Mastery</th></tr></thead><tbody>${lvRows}</tbody></table></div>
        </section>
        <section>
          <div class="section-title"><h2>Common mix-ups</h2></div>
          ${confHTML}
        </section>
      </div>
    </div>`;
  }
  // the track with the most answers in the last two weeks, or the first track
  function busiestTrack() {
    const n = {};
    const d = new Date();
    for (let i = 0; i < 14; i++) {
      const day = S.state.days[TL.dayKey(d)];
      if (day) for (const [id, a] of Object.entries(day.t)) n[id] = (n[id] || 0) + a[0];
      d.setDate(d.getDate() - 1);
    }
    let best = TRACKS[0].id;
    for (const t of TRACKS) if ((n[t.id] || 0) > (n[best] || 0)) best = t.id;
    return best;
  }
  function accBars(trackId) {
    const rows = itemOrder(trackId).map((it) => ({ it, s: S.item(trackId, it) })).filter((x) => x.s.n > 0);
    if (!rows.length) return '<p class="empty">No answers in this track yet.</p>';
    // sung items carry their intonation: how far off in the latest session and a week or more before it, and which way the voice leans
    const tune = (it) => {
      const t = sungTrack(trackId) ? S.pitchTrend(trackId, it) : null;
      if (!t) return '';
      return ` · <span title="cents off: hundredths of a semitone; 50 is halfway to the next note">${t.now} cents${t.before != null ? ` <span class="muted">(was ${t.before})</span>` : ''}${t.lean ? `<span class="muted">, ${t.lean}</span>` : ''}</span>`;
    };
    return `<div class="accbars">${rows.map(({ it, s }) => `<div class="accbar deg" style="--h:${itemHue(trackId, it)}">
      <span class="nm"><i></i><span>${esc(itemName(trackId, it))}</span></span>
      <span class="track"><span style="width:${Math.max(2, s.e * 100)}%"></span></span>
      <span class="pc">${pct(s.e)} · ${s.n}${tune(it)}</span></div>`).join('')}</div>`;
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
      out.push(`<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" data-act="chartTip" data-tip="${esc(`${p.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${p.q} question${p.q === 1 ? '' : 's'}${p.acc != null ? ' · ' + pct(p.acc) : ''}${p.s ? ' · ' + Math.round(p.s / 60) + ' min' : ''}`)}"/>`);
    });
    out.push(`<line class="goal" x1="${L}" x2="${W - Rp}" y1="${y(goal)}" y2="${y(goal)}"/>`);
    return `<div class="tbl-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Questions answered per day over the last five weeks">${out.join('')}</svg></div>`;
  }

  // ---------- week by week ----------
  // One track's last twelve weeks: accuracy for every track, the time to a right answer for the
  // tracks answered by choosing, intonation for the sung ones. A week is a dot once it has enough
  // answers (S.WEEK_MIN); the line breaks at a new level, since a new level is harder (finishing the
  // track is marked too, but the last level stays in review, so the line goes on).
  const WEEKS = 12;
  const timedTrack = (id) => !sungTrack(id) && id !== 'melody' && id !== 'rhythm';
  const keyDate = (k) => new Date(k + 'T12:00:00');
  const shortDate = (k) => keyDate(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const secs = (v) => (Math.round(v * 10) / 10).toFixed(1); // rounded as the comparisons round it
  const MEASURES = {
    acc: {
      title: 'Accuracy', min: 'q', count: 'q', noun: 'answer',
      value: (w) => w.acc, scale: () => ({ top: 1, grid: [0, 0.25, 0.5, 0.75, 1], label: (v) => (v * 2 % 1 === 0 ? pct(v) : '') }),
      show: (v) => pct(v), tipValue: (v) => pct(v) + ' right',
      sub: (id) => (sungTrack(id)
        ? 'Your grades each week: Matched counts in full, Close counts half. L marks a new level, and a dip after one is normal. Practice rounds don’t count.'
        : 'How many of your answers were right, each week. L marks a new level. A new level is harder, so a dip after one is normal. Practice rounds don’t count.'),
      now: (w) => `${pct(w.acc)} right, of ${plural(w.q, 'answer')}`,
      // up or down: 5 percentage points or more, as shown
      cmp: (a, b) => { const d = Math.round(a * 100) - Math.round(b * 100); return Math.abs(d) < 5 ? 0 : Math.sign(d); }, words: ['Down from', 'Up from'],
      harder: 'a new level is harder',
      empty: (id) => `A week shows here once it has ${S.WEEK_MIN.q} answers in ${TRACK[id].name}.`,
    },
    sec: {
      title: 'Answer speed', min: 'rt', count: 'rn', noun: 'right answer',
      value: (w) => w.sec,
      scale: (vals) => {
        let top = Math.max(4, Math.ceil(Math.max(0, ...vals)));
        const step = top <= 4 ? 1 : top <= 8 ? 2 : 4;
        top = Math.ceil(top / step) * step;
        const grid = [];
        for (let v = 0; v <= top; v += step) grid.push(v);
        return { top, grid, label: (v) => v + ' s' };
      },
      show: secs, tipValue: (v) => secs(v) + ' s',
      sub: (id, wk) => `Seconds from the end of the sound to a right answer. Lower is quicker. Replays count as thinking time, so compare weeks, not days.${id === 'harmony' ? ' In a progression, the time is per chord.' : ''}${wk.timedFrom && wk.timedFrom > wk.weeks[0].from ? ` Times are kept from ${shortDate(wk.timedFrom)}.` : ''}`,
      now: (w) => `${secs(w.sec)} seconds to a right answer, over ${plural(w.rn, 'answer')}`,
      // quicker or slower: at least a tenth and at least 0.3 s, as shown
      cmp: (a, b) => { const d = Math.round(b * 10) - Math.round(a * 10); return Math.abs(d) < Math.max(3, Math.round(b * 10) / 10) ? 0 : Math.sign(d); }, words: ['Slower than', 'Quicker than'],
      harder: 'a new level often slows you down at first',
      empty: (id, wk) => `Answer times are kept ${wk.timedFrom ? 'from ' + shortDate(wk.timedFrom) : 'from now on'}. A week shows here once it has ${S.WEEK_MIN.rt} right answers.`,
    },
    cl: {
      title: 'Intonation', min: 'cl', count: 'pn', noun: 'sung answer',
      value: (w) => w.cents, scale: () => ({ top: 50, grid: [0, 10, 20, 30, 40, 50], label: (v) => String(v) }),
      show: (v) => String(Math.round(v)), tipValue: (v) => Math.round(v) + ' cents off',
      sub: () => 'How far your sung notes were from the target, in cents: hundredths of a semitone, so 50 is halfway to the next note. Lower is closer. Only answers the microphone checked count, and practice rounds don’t.',
      now: (w) => `${Math.round(w.cents)} cents off on average, over ${plural(w.pn, 'sung answer')}`,
      // closer or further off: at least 4 cents, as shown
      cmp: (a, b) => { const d = Math.round(b) - Math.round(a); return Math.abs(d) < 4 ? 0 : Math.sign(d); }, words: ['Further off than', 'Closer than'],
      harder: 'a new level is harder',
      empty: () => (micCopy()
        ? 'This copy can’t use the microphone. Sing on noaware.io to see your intonation here.'
        : `Intonation is measured when the microphone checks your singing. In Preferences, set Microphone to With the microphone. A week shows here once it has ${S.WEEK_MIN.cl} sung answers.`),
    },
  };
  const measuresFor = (id) => ['acc', timedTrack(id) ? 'sec' : null, sungTrack(id) ? 'cl' : null].filter(Boolean);
  // the level-ups as day positions on the chart (0 is the first day shown), with their labels
  const upDay = (u) => WEEKS * 7 - 1 - u.back;
  const upText = (u) => (u.done ? 'finished the track' : `up to level ${u.level}`);
  function weekCharts(id) {
    const wk = S.weekly(id, WEEKS);
    if (!wk.weeks.some((w) => w.q || w.rn || w.pn)) return `<p class="empty">No answers in ${esc(TRACK[id].name)} in the last ${WEEKS} weeks.</p>`;
    const ms = measuresFor(id);
    return `<div class="trends">${ms.map((m) => trendCard(id, m, wk)).join('')}</div>${weekTable(id, ms, wk)}`;
  }
  function trendCard(id, key, wk) {
    const m = MEASURES[key];
    const pts = wk.weeks.map((w, i) => ({ i, v: m.value(w) })).filter((p) => p.v != null);
    const body = pts.length ? trendSVG(id, key, wk, pts) + `<p class="trend">${esc(trendText(key, wk, pts))}</p>` : `<p class="empty">${esc(m.empty(id, wk))}</p>`;
    return `<div class="chart-card deg" style="--h:${TRACK[id].hue}">
      <h3>${m.title}</h3><p class="sub">${esc(m.sub(id, wk))}</p>
      ${body}
      <div class="tooltip" hidden></div>
    </div>`;
  }
  // what the newest week with enough answers says, against the one before it with enough
  function trendText(key, wk, pts) {
    const m = MEASURES[key];
    const last = pts[pts.length - 1], wl = wk.weeks[last.i];
    const name = (i) => (i === WEEKS - 1 ? 'Last 7 days' : `The 7 days to ${shortDate(wk.weeks[i].to)}`);
    const lean = key === 'cl' && wl.lean ? ` Your voice tended ${wl.lean}.` : '';
    if (pts.length === 1) return `${name(last.i)}: ${m.now(wl)}. A line joins the weeks once a second week has enough answers.${lean}`;
    const prev = pts[pts.length - 2];
    const before = prev.i === last.i - 1 ? 'the 7 days before' : `the 7 days to ${shortDate(wk.weeks[prev.i].to)}`;
    const head = `${name(last.i)}: ${m.now(wl)}.`;
    const c = m.cmp(last.v, prev.v);
    // "Up from 76% the 7 days before"; "Quicker than the 7 days before (3.1)"
    const word = m.words[c > 0 ? 1 : 0];
    const change = c === 0 ? `About the same as ${before} (${m.show(prev.v)}).` : `${key === 'acc' ? `${word} ${m.show(prev.v)} ${before}` : `${word} ${before} (${m.show(prev.v)})`}.`;
    // a new level between the two weeks: a step back is the level, not you, so it is not called one;
    // finishing the track is not a new level (the last one stays in review)
    const ups = wk.ups.filter((u) => upDay(u) > prev.i * 7 && upDay(u) <= last.i * 7 + 6);
    const when = (u) => { const day = new Date(); day.setDate(day.getDate() - u.back); return shortDate(TL.dayKey(day)); };
    const moved = (u) => (u.done ? `You finished the track on ${when(u)}` : `You moved up to level ${u.level} on ${when(u)}`);
    const up = ups.filter((u) => !u.done).pop();
    if (c < 0 && up) return `${head} ${before[0].toUpperCase() + before.slice(1)}: ${m.tipValue(prev.v)}. ${moved(up)}, and ${m.harder}.${lean}`;
    if (ups.length) return `${head} ${change} ${moved(ups[ups.length - 1])}.${lean}`;
    return `${head} ${change}${lean}`;
  }
  function trendSVG(id, key, wk, pts) {
    const m = MEASURES[key];
    const W = 400, H = 180, L = 44, Rp = 12, T = 18, B = 26;
    const iw = W - L - Rp, ih = H - T - B, sw = iw / WEEKS;
    const sc = m.scale(pts.map((p) => p.v));
    const y = (v) => T + ih - (Math.min(v, sc.top) / sc.top) * ih;
    const xw = (i) => L + (i + 0.5) * sw;
    const xd = (j) => L + (j + 0.5) * (iw / (WEEKS * 7));
    const out = [];
    for (const v of sc.grid) out.push(`<line class="grid" x1="${L}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}"/>${sc.label(v) ? `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${sc.label(v)}</text>` : ''}`);
    // new levels: a dashed line on the day, one label for marks within a week of each other
    const ups = wk.ups.map((u) => ({ ...u, j: upDay(u) })).sort((a, b) => a.j - b.j);
    const groups = [];
    for (const u of ups) {
      const g = groups[groups.length - 1];
      if (g && u.j - g[g.length - 1].j <= 6) g.push(u); else groups.push([u]);
    }
    for (const u of ups) out.push(`<line class="lvl${u.done ? ' done' : ''}" x1="${xd(u.j)}" x2="${xd(u.j)}" y1="${T}" y2="${T + ih}"/>`);
    for (const g of groups) {
      const tag = (u) => (u.done ? 'Done' : 'L' + u.level);
      const text = g.length === 1 ? tag(g[0]) : g.every((u) => !u.done) ? `L${g[0].level}–${g[g.length - 1].level}` : `${tag(g[0])}–${tag(g[g.length - 1])}`;
      out.push(`<text class="lvl-t" x="${Math.max(L + 8, Math.min(W - Rp - 8, (xd(g[0].j) + xd(g[g.length - 1].j)) / 2))}" y="${T - 6}" text-anchor="middle">${text}</text>`);
    }
    // the line: solid between neighbouring weeks, dashed across weeks without enough answers, broken at a new level
    // (a week's dot sits on its fourth day: a new level on that day breaks the line to its left)
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (ups.some((u) => !u.done && u.j > 7 * a.i + 3 && u.j <= 7 * b.i + 3)) continue;
      out.push(`<path class="${b.i - a.i === 1 ? 'line' : 'gap'}" d="M${xw(a.i)},${y(a.v)} L${xw(b.i)},${y(b.v)}"/>`);
    }
    for (const p of pts) out.push(`<circle class="dot" cx="${xw(p.i)}" cy="${y(p.v)}" r="3.5"/>`);
    // dates under the first, fifth and ninth weeks (the day each ends), and today under the last
    for (const i of [0, 4, 8]) out.push(`<text x="${xw(i)}" y="${H - 6}" text-anchor="middle">${shortDate(wk.weeks[i].to)}</text>`);
    out.push(`<text x="${xw(WEEKS - 1)}" y="${H - 6}" text-anchor="middle">Today</text>`);
    // one target per week, for hover and tap
    wk.weeks.forEach((w, i) => {
      const n = w[m.count], v = m.value(w);
      const parts = [i === WEEKS - 1 ? 'Last 7 days' : `7 days to ${shortDate(w.to)}`];
      if (v != null) parts.push(m.tipValue(v), plural(n, m.noun));
      else parts.push(n ? `${plural(n, m.noun)}, too few to show` : `no ${m.noun}s`);
      if (key === 'cl' && v != null && w.lean) parts.push('tended ' + w.lean);
      for (const u of ups) if (Math.floor(u.j / 7) === i) parts.push(upText(u));
      out.push(`<rect class="hit" x="${L + i * sw}" y="${T}" width="${sw}" height="${ih}" data-act="chartTip" data-tip="${esc(parts.join(' · '))}"/>`);
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${m.title} in ${TRACK[id].name}, week by week over ${WEEKS} weeks. The numbers are in the table below.`)}">${out.join('')}</svg>`;
  }
  // the same numbers as a table, newest week first
  function weekTable(id, ms, wk) {
    const ups = wk.ups.map((u) => ({ ...u, j: upDay(u) }));
    const cell = (v, n, show) => (v != null ? show(v) : n ? 'too few' : '–');
    const rows = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const w = wk.weeks[i];
      const lv = ups.filter((u) => Math.floor(u.j / 7) === i).map((u) => {
        const day = new Date(); day.setDate(day.getDate() - u.back);
        return u.done ? 'Finished' : `Level ${u.level}, ${shortDate(TL.dayKey(day))}`;
      });
      if (!w.q && !w.rn && !w.pn && !lv.length) continue;
      rows.push(`<tr><td>${i === WEEKS - 1 ? 'Today' : esc(shortDate(w.to))}</td><td class="r num">${w.q}</td><td class="r num">${cell(w.acc, w.q, pct)}</td>${ms.includes('sec') ? `<td class="r num">${cell(w.sec, w.rn, secs)}</td>` : ''}${ms.includes('cl') ? `<td class="r num">${cell(w.cents, w.pn, (v) => Math.round(v) + (w.lean ? ', ' + w.lean : ''))}</td>` : ''}<td>${esc(lv.join('; '))}</td></tr>`);
    }
    return `<details class="chart-data"><summary>The numbers, week by week</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>7 days to</th><th class="r">Answers</th><th class="r">Right</th>${ms.includes('sec') ? '<th class="r">Seconds</th>' : ''}${ms.includes('cl') ? '<th class="r">Cents off</th>' : ''}<th>New level</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
  }
  // a week's numbers over its chart: on hover, and on a tap where there is no hover
  function showTip(hit, clientY) {
    const card = hit.closest && hit.closest('.chart-card');
    if (!card) return;
    const tip = card.querySelector('.tooltip');
    if (!tip) return;
    document.querySelectorAll('.chart-card .tooltip').forEach((t) => { if (t !== tip) t.hidden = true; });
    const c = card.getBoundingClientRect(), r = hit.getBoundingClientRect();
    tip.textContent = hit.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = Math.max(w / 2 + 4, Math.min(c.width - w / 2 - 4, r.left + r.width / 2 - c.left)) + 'px';
    tip.style.top = ((Number.isFinite(clientY) ? clientY : r.top + r.height / 2) - c.top - 8) + 'px';
  }
  function hideTips() { document.querySelectorAll('.chart-card .tooltip').forEach((t) => { t.hidden = true; }); }

  // this screen's part of the action table (data-act), merged in main.js
  const progressActions = {
    chartTip: (d, el, e) => showTip(el, e && e.clientY),
    drillPair: (d) => startSession([{ track: d.track, count: 12, role: 'Pair drill', pool: [d.a, d.b] }]),
    progTrack: (d) => { progTrack = d.track; render(); },
  };

export { hideTips, progressActions, showTip, viewProgress };
