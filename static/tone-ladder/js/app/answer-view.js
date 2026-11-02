/* Tone Ladder — answer inputs (ladder, piano, staff), choice and sequence bodies, feedback, the answer on a staff. */
import { $, DEG, S, TL, TRACK, degText, esc, nearestSemi, rnHue } from './base.js';
import { R } from './state.js';
import { singBack } from './mic.js';
import { TIPS } from './session-view.js';
import { micResultHTML } from './sing-view.js';

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
  // A piano of the question's key, from a Sol below Do up to High Do, its keys as they are on the
  // instrument and named in the key. Only the level's notes answer; the others are drawn dim.
  function pianoHTML(options, mode, act, state, tonic) {
    const ids = new Set(options.map((o) => o.id));
    const lo = tonic - (window.innerWidth < 520 ? 0 : 5), hi = tonic + 12; // the Sol below Do is context, dropped where keys would get too narrow to aim at
    const isBlack = (m) => [1, 3, 6, 8, 10].includes(TL.mod12(m));
    // a black key sits between two white ones, so the drawing runs out to a white key at each end
    let first = lo, last = hi;
    while (isBlack(first)) first--;
    while (isBlack(last)) last++;
    const whites = [];
    for (let m = first; m <= last; m++) if (!isBlack(m)) whites.push(m);
    const W = 100 / whites.length;
    const hints = keyHints(options, mode);
    const keyOf = (id) => { for (const [k, v] of Object.entries(hints)) if (v === id) return k.startsWith('S') ? '⇧' + k.slice(1) : k; return ''; };
    const cls = (id) => (state.correct === id ? ' is-correct' : '') + (state.wrong === id ? ' is-wrong' : '') + (state.dim ? ' dim' : '');
    const keys = [];
    for (let m = first; m <= last; m++) {
      const semi = m - tonic, d = TL.degBySemi(semi), id = d.id, on = ids.has(id) && m >= lo && m <= hi, black = isBlack(m);
      const label = semi === 12 ? (S.settings.labels === 'numbers' ? '1' : 'Do') : degText(id).main;
      const sub = semi === 12 ? (S.settings.labels === 'both' ? '1' : '') : degText(id).sub || '';
      const left = black ? (whites.indexOf(m - 1) + 1) * W - W * 0.3 : whites.indexOf(m) * W;
      const hint = on && semi >= 0 && semi < 12 ? keyOf(id) : ''; // the hint once, on the main octave
      const k = hint !== sub ? hint : ''; // and not when the number under the name already says it
      keys.push(`<button class="pkey ${black ? 'black' : 'white'}${on ? '' : ' off'}${on ? cls(id) : ''}" data-act="${act}" data-id="${id}" data-semi="${semi}" style="left:${left.toFixed(2)}%; width:${(black ? W * 0.6 : W).toFixed(2)}%; --h:${d.hue}"${on ? '' : ' disabled'} aria-label="${esc((semi === 12 ? 'High ' : '') + d.sol + ' ' + d.num)}">${k ? `<kbd>${k}</kbd>` : ''}${semi === 0 || semi === 12 ? '<i class="do"></i>' : ''}<span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`);
    }
    return `<div class="piano" role="group" aria-label="Piano keys, named in the key">${keys.join('')}</div>`;
  }
  // The staff as a control: the mode's degrees on their lines and spaces, Do to High Do, with
  // buttons over them. The altered twins (Fi for Fa, Te for Ti) come up on a toggle, only where
  // the question offers them; the accidental is drawn, so the spelling is seen, not supplied.
  function staffHTML(options, mode, act, state, tonic) {
    const hints = keyHints(options, mode);
    const ids = new Set(options.map((o) => o.id));
    // each slot is a scale degree's column: its main note is the one the question offers (the
    // scale note, or its chromatic twin when only that is asked), its twin the other
    const slots = TL.MODE_SCALE[mode || 'major'].map((id) => {
      const n = DEG[id].num.replace(/[♭♯]/g, '');
      const main = ids.has(id) || !hints[n] ? id : hints[n], twin = hints['S' + n] && hints['S' + n] !== main ? hints['S' + n] : null;
      return { main, twin };
    });
    const twins = slots.some((s) => s.twin);
    // the feedback shows the set that holds the right answer; while answering, the toggle decides
    const alt = state.correct ? slots.some((s) => s.twin === state.correct) : !!(R && R.staffAlt);
    const positions = slots.map((s) => { const use = alt && s.twin ? s.twin : s.main, hid = alt && s.twin ? s.main : s.twin; return { id: use, semi: DEG[use].semi, high: false, hid }; });
    positions.push({ id: '1', semi: 12, high: true });
    const key = { tonic, mode: mode || 'major' };
    const px = Math.min(520, Math.max(300, window.innerWidth - 32)); // the drawing scales to the screen, so its names stay readable
    const svg = TL.Notation.staff({ key, clef: 'treble', grid: true, width: px, notes: positions.map((p) => ({ midi: tonic + p.semi, dur: 1 })), lyrics: positions.map((p) => degText(p.id).main) });
    const box = TL.Notation.gridBox(key, px);
    const cls = (id) => (state.correct === id ? ' is-correct' : '') + (state.wrong === id ? ' is-wrong' : '') + (state.dim ? ' dim' : '');
    const btns = positions.map((p) => {
      const on = ids.has(p.id), wrongTwin = state.wrong && p.hid === state.wrong; // your pick was this column's other note
      return `<button class="spos${on ? '' : ' off'}${on ? cls(p.id) : ''}${wrongTwin ? ' is-wrong-twin' : ''}" data-act="${act}" data-id="${p.id}" data-semi="${p.semi}"${p.hid ? ` data-twin-semi="${DEG[p.hid].semi}"` : ''}${on ? '' : ' disabled'} aria-label="${esc((p.high ? 'High ' : '') + DEG[p.id].sol + ' ' + DEG[p.id].num)}"></button>`;
    }).join('');
    return `<div class="staff-in" role="group" aria-label="Notes on a staff, in the key"><div class="staff-svg">${svg}<div class="staff-hit" style="left:${(box.left * 100).toFixed(2)}%;right:${((1 - box.right) * 100).toFixed(2)}%">${btns}</div></div>${twins && !state.correct ? `<div class="row"><button class="btn sm ghost${alt ? ' on' : ''}" data-act="staffAlt" aria-pressed="${alt}">${alt ? 'Back to the scale' : 'Altered notes'}</button></div>` : ''}</div>`;
  }
  // the ladder, or the piano or the staff when chosen and the question has a key
  function notesHTML(q, act, state) {
    if (q.tonic != null && S.settings.input === 'staff' && TL.Notation) return staffHTML(q.options, q.mode, act, state, q.tonic);
    return S.settings.input === 'piano' && q.tonic != null ? pianoHTML(q.options, q.mode, act, state, q.tonic) : ladderHTML(q.options, q.mode, act, state);
  }
  function choiceBodyHTML() {
    const q = R.q;
    const fb = R.phase === 'feedback';
    const state = fb ? { correct: q.answer, wrong: R.chosen !== q.answer ? R.chosen : null, dim: true } : {};
    if (q.layout === 'ladder') return `<div>${notesHTML(q, 'answer', state)}</div>`;
    return `<div class="choices">${q.options.map((o, i) => {
      const c = state.correct === o.id ? ' is-correct' : state.wrong === o.id ? ' is-wrong' : '';
      return `<button class="choice${c}" data-act="answer" data-id="${esc(o.id)}"><span class="lbl${o.serif ? ' serif' : ''}">${esc(o.label)}</span>${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}${gridKey(i) ? `<kbd>${gridKey(i)}</kbd>` : ''}</button>`;
    }).join('')}</div>`;
  }
  function answerLabelHTML(q, id) {
    if (q.track === 'degrees' && DEG[id]) {
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
        ${scoreHTML(q)}
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
      ${R.mic && R.mic.state === 'heard' && singBack(q) ? `<div class="sing echo"><p class="eyebrow">Your echo</p>${micResultHTML(q, R.mic.result)}</div>` : ''}
      ${q.track === 'melody' ? contourSVG(q, R.input) : ''}
      ${scoreHTML(q, R.results.map((r, i) => (r ? -1 : i + (q.given || []).length)).filter((i) => i >= 0))}
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
    if (q.track === 'degrees' && DEG[id]) return degText(id).main;
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
      ? notesHTML(q, 'pick', fb ? { dim: true } : {})
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
  // ---------- the answer on a staff ----------
  // Drawn from the sounds the question played (its events carry the notes and their degrees), so
  // the staff shows what sounded, in the key: a dictation's melody, a bass line under its
  // numerals, the note of a degree question, the chord of a quality question. Names underneath.
  function scoreHTML(q, missed) {
    if (S.settings.notation === 'off' || !TL.Notation || !q || q.kind === 'tap') return '';
    const P = (q.audio && q.audio.parts) || {};
    let evs = P.asked || P.model || P.target || P.prog || (q.audio && q.audio.main) || [];
    evs = evs.filter((e) => e.notes && e.notes.length && !e.perc && e.role !== 'context' && e.role !== 'resolution');
    const slotted = evs.filter((e) => e.slot != null);
    if (slotted.length) evs = slotted; // a progression: the chords that were asked about, not the key-setting ones
    if (!evs.length) return '';
    const tonic = q.tonic != null ? q.tonic : Math.min(...evs.flatMap((e) => e.notes)); // an interval has no key: its lower note stands for Do
    const key = { tonic, mode: q.mode || 'major' };
    const base = evs.reduce((m, e) => Math.min(m, e.dur || 0.5), Infinity) || 0.5; // the shortest value is a quarter
    const snap = (v) => [0.5, 1, 1.5, 2, 3, 4].reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    const harmony = q.track === 'harmony' && (Array.isArray(q.answer) || Array.isArray(q.seqLabels));
    const notes = evs.map((e) => (harmony ? { midi: Math.min(...e.notes), dur: snap((e.dur || 0.5) / base) } : e.notes.length > 1 ? { midis: e.notes.slice(), dur: snap((e.dur || 0.5) / base) } : { midi: e.notes[0], dur: snap((e.dur || 0.5) / base) }));
    let lyrics = harmony ? notes.map((n) => degText(TL.degBySemi(n.midi - tonic).id).main) : evs.map((e) => (e.deg && DEG[e.deg] ? degText(e.deg).main : ''));
    if (!lyrics.some(Boolean) && notes.length === 1 && DEG[q.answer]) lyrics = [degText(q.answer).main]; // a degree question's one note
    const chords = harmony ? (q.seqLabels || q.answer).map((t, i) => ({ at: i, text: String(t) })) : null;
    // no key: a chord is spelled from its root by chord tone, an interval by its number
    if (q.track === 'chords' && q.root != null && TL.CHORD_TYPES[q.answer]) notes.forEach((n) => { n.letters = TL.Notation.chordLetters(q.root, q.answer, n.midis || [n.midi]); });
    if (q.track === 'intervals' && TL.IV[q.answer]) {
      const all = notes.flatMap((n) => n.midis || [n.midi]), Ls = TL.Notation.intervalLetters(q.answer, all);
      const letterOf = new Map(all.map((m, i) => [m, Ls[i]]));
      notes.forEach((n) => { n.letters = (n.midis || [n.midi]).map((m) => letterOf.get(m)); });
    }
    try {
      return `<div class="score" aria-label="The answer on a staff">${TL.Notation.staff({ key, sig: q.tonic != null, notes, lyrics, chords, width: Math.min(520, Math.max(300, window.innerWidth - 32)), highlight: missed || [] })}</div>`;
    } catch (e) { return ''; }
  }
  const rhythmStaff = (r) => (S.settings.notation !== 'off' && TL.Notation && r ? `<div class="score">${TL.Notation.rhythm({ rhythm: r, width: Math.min(520, Math.max(300, window.innerWidth - 32)) })}</div>` : '');
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

export { choiceBodyHTML, feedbackHTML, keyHints, ladderHTML, levelUpHTML, notesHTML, renderSeq, rhythmStaff, seqBodyHTML, struggleHTML };
