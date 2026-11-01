/* Tone Ladder — Progress. */
import { DEG, S, TL, TRACKS, esc, fmtDuration, itemHue, itemName, pct, sungTrack } from './base.js';
import { render } from './router.js';
import { startSession } from './session.js';
import { itemOrder } from './track.js';

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
          <p class="muted" style="font-size:12.5px;margin-top:10px">Recent accuracy, weighted toward your latest answers.${sungTrack(progTrack) ? ' With the microphone, each note also shows how far off it was the last day you sang it, in cents (hundredths of a semitone; 50 is halfway to the next note), with the value from a week or more before in brackets; “low” or “high” means your voice has tended that way on it lately.' : ''}</p>
          ${progTrack === 'sing' && S.state.guess && S.state.guess.n ? `<p class="muted" style="font-size:12.5px">Your call first: your own grade agreed with the app’s ${S.state.guess.a} of ${S.state.guess.n} times.</p>` : ''}
        </section>
      </div>
    </div>`;
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
      out.push(`<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" data-i="${i}" data-tip="${esc(`${p.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${p.q} question${p.q === 1 ? '' : 's'}${p.acc != null ? ' · ' + pct(p.acc) : ''}${p.s ? ' · ' + Math.round(p.s / 60) + ' min' : ''}`)}"/>`);
    });
    out.push(`<line class="goal" x1="${L}" x2="${W - Rp}" y1="${y(goal)}" y2="${y(goal)}"/>`);
    return `<div class="tbl-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Questions answered per day over the last five weeks">${out.join('')}</svg></div>`;
  }

  // this screen's part of the action table (data-act), merged in main.js
  const progressActions = {
    drillPair: (d) => startSession([{ track: d.track, count: 12, role: 'Pair drill', pool: [d.a, d.b] }]),
    progTrack: (d) => { progTrack = d.track; render(); },
  };

export { progressActions, viewProgress };
