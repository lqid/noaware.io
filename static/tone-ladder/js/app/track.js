/* Tone Ladder — a track's page: its levels and accuracy. */
import { DEG, S, TRACK, esc, fmtNum, itemHue, itemName, levelItemsText, pct, toast } from './base.js';
import { app } from './state.js';
import { FREE_COUNT } from './plan.js';
import { render } from './router.js';
import { startSession } from './session.js';
import { gateText, toGoText } from './today.js';

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
    // scale degrees in scale order; anything else a track lists (the modes) after them, as listed
    if (trackId === 'degrees' || trackId === 'melody') seen.sort((a, b) => (DEG[a] ? DEG[a].semi : 99) - (DEG[b] ? DEG[b].semi : 99));
    return seen;
  }

  // this screen's part of the action table (data-act), merged in main.js
  const trackActions = {
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
  };

export { itemOrder, trackActions, viewTrack };
