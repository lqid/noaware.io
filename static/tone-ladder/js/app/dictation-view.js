/* Tone Ladder — Full Dictation on screen: the staff as written, the bars of figures, the palette, the named notes, the feedback. */
import { $, DEG, S, TL, degText, esc } from './base.js';
import { R } from './state.js';
import { levelUpHTML, notesHTML, struggleHTML } from './answer-view.js';
import { TIPS } from './session-view.js';

  // ======================================================================
  // FULL DICTATION: THE VIEW
  // ======================================================================
  // The entry is drawn from TL.Dict: the staff as it stands (unnamed notes as slashes, empty beats as
  // dashed boxes), one row of figure chips per bar, the palette, and the written notes as slots to
  // name. Until the melody has been heard once, every control waits for it (data-needs-main).
  const dictWait = () => (R.mainEnd == null ? ' disabled data-needs-main' : '');
  // a note's name in a sentence or a label; with numbers only it says "degree 5", or "Note 2, 5"
  // would not tell the note's place from its name
  const degName = (id) => (S.settings.labels === 'numbers' ? 'degree ' : '') + degText(id).main;

  // "Bar 2: 2 beats left.": the cursor's bar while it has room, else the first bar that has
  function dictBarStatus(q, e, at = 0) {
    if (TL.Dict.full(q, e)) return 'Every bar is full.';
    let bar = Math.floor(at / q.barTicks);
    if (!TL.Dict.barLeft(q, e, bar)) bar = Math.floor(TL.Dict.blanks(q, e)[0] / q.barTicks);
    const n = TL.Dict.barLeft(q, e, bar);
    return `Bar ${bar + 1}: ${n} beat${n === 1 ? '' : 's'} left.`;
  }
  function dictNameStatus(q, e) {
    const n = TL.Dict.unnamed(q, e).length;
    if (n) return n === 1 ? '1 note needs a name.' : `${n} notes need names.`;
    return TL.Dict.full(q, e) ? 'Ready to check.' : 'Fill every bar first.';
  }

  // ----- the staff -----
  // The entry as staff notes: a named note where it is drawn (with a grade, a right name at the
  // melody's own octave), an unnamed one as a slash, a rest, an empty beat as a dashed box.
  function dictWritten(q, e, g) {
    const at = TL.Dict.pitches(q, e, g);
    return TL.Dict.items(q, e).map((x) => {
      const dur = x.len / 12;
      if (x.kind === 'blank') return { blank: true, dur, tick: x.tick };
      if (x.kind === 'rest') return { rest: true, dur, tick: x.tick };
      if (!x.name) return { slash: true, dur, tick: x.tick };
      return { midi: q.tonic + q.oct + at[x.w], dur, letter: TL.Dict.letter(q, x.name), tick: x.tick };
    });
  }
  // A staff in the question's key and time, sized to its beats. Below 520px four bars are two
  // systems of two, the time signature on the first only. hl: indexes of notes drawn red; lyrics:
  // one per note.
  function dictStaffSVG(q, notes, lyrics = [], hl = []) {
    const beats = (q.bars * q.barTicks) / 12;
    const px = Math.min(1000, 140 + beats * 56, Math.max(300, window.innerWidth - 32));
    const cut = window.innerWidth < 520 && q.bars > 2 ? 2 * q.barTicks : Infinity;
    const systems = [notes.filter((n) => n.tick < cut), notes.filter((n) => n.tick >= cut)].filter((p) => p.length);
    const draw = (width) => {
      let from = 0;
      return systems.map((p, s) => {
        const to = from + p.length;
        const svg = TL.Notation.staff({ key: q.staff.key, clef: 'treble', time: s ? undefined : q.meter, bars: q.staff.bars, beat: q.beat, beam: true, notes: p, width, lyrics: lyrics.slice(from, to), highlight: hl.filter((i) => i >= from && i < to).map((i) => i - from) });
        from = to;
        return svg;
      });
    };
    let svgs = draw(px);
    // Each system's viewBox is as wide as its notes need, px / 0.8 at least, and is shrunk to the
    // column. Two of different widths are drawn again at the wider one's, so both shrink alike;
    // otherwise the second, without the time signature, would draw a larger staff.
    const units = svgs.map((s) => +(/viewBox="0 0 ([\d.]+)/.exec(s) || [0, 0])[1]);
    if (svgs.length > 1 && Math.max(...units) > Math.min(...units)) svgs = draw(Math.ceil(0.8 * Math.max(...units)));
    return svgs.join('');
  }
  // While answering, the staff as written; after Check, what was written with its wrong names and
  // extra notes red, and the melody under it, named, its wrong names red and wrong lengths ruled.
  // It carries .sight-staff, so its notes light as it plays; the written staff never does, since
  // a note lit while answering would give the melody away.
  function dictStavesHTML(q, d, g) {
    try {
      const written = dictWritten(q, d.entry, g);
      if (!g) return `<div class="score dict-staff" id="dictStaff" role="img" aria-label="What you have written">${dictStaffSVG(q, written)}</div>`;
      const items = TL.Dict.items(q, d.entry);
      const red = items.map((x, i) => (x.kind === 'note' && (g.written[x.w].extra || !g.written[x.w].nameOk) ? i : -1)).filter((i) => i >= 0);
      let k = 0;
      const mel = q.staff.notes.map((n) => (n.rest ? { ...n, under: false, ok: true } : { ...n, under: !g.notes[k].lenOk, ok: !g.notes[k].graded || g.notes[k].nameOk, id: g.notes[k++].id }));
      const lyrics = mel.map((n) => (n.rest ? '' : degText(n.id).main));
      const wrong = mel.map((n, i) => (n.ok ? -1 : i)).filter((i) => i >= 0);
      return `<div class="dict-staves" id="dictStaff">
        <p class="eyebrow">What you wrote</p>
        <div class="score dict-staff" role="img" aria-label="What you wrote, with wrong names and extra notes in red">${dictStaffSVG(q, written, [], red)}</div>
        <p class="eyebrow">The melody</p>
        <div class="score dict-staff sight-staff" role="img" aria-label="${esc('The melody: ' + mel.filter((n) => !n.rest).map((n) => degText(n.id).main).join(', '))}">${dictStaffSVG(q, mel, lyrics, wrong)}</div>
      </div>`;
    } catch (e) { return '<div id="dictStaff"></div>'; } // the rows and slots still say it all
  }

  // ----- the rhythm: bars of figure chips, and the palette -----
  // A figure on its own, centred, for a chip or a palette button: cropped to the band a figure is
  // drawn in (stems, beams and rests stay between 12 and 66 of the line's 78), so it fills its box.
  const dictFigSVG = (q, id) => TL.Notation.rhythm({ rhythm: { ticks: TL.RCELLS[id].ticks, meter: q.meter, barTicks: q.barTicks, beat: q.beat }, bare: true, width: 60 })
    .replace(/viewBox="0 0 ([\d.]+) 78" width="(\d+)" height="[\d.]+"/, (m, w, px) => `viewBox="0 10 ${w} 58" width="${px}" height="${Math.round((58 * px) / w)}"`);
  // One row per bar: a chip per written figure, as wide as its beats, and a dashed chip per empty
  // beat; the chip at the cursor is outlined. After Check they are not buttons, and a figure the
  // melody does not have there is marked.
  function dictBarsHTML(q, d, graded) {
    const items = TL.Dict.items(q, d.entry);
    const rows = [];
    for (let b = 0; b < q.bars; b++) {
      const chips = items.filter((x) => x.tick === x.start && Math.floor(x.start / q.barTicks) === b).map((x) => {
        const blank = x.kind === 'blank', beats = (blank ? q.beat : TL.cellLen(x.fig)) / q.beat;
        const label = `Bar ${b + 1}, beat ${TL.Dict.where(q, x.start).beat}: ${blank ? 'empty' : TL.RCELLS[x.fig].label}`;
        const wrong = graded && !blank && !q.figs.some((f) => f.start === x.start && f.id === x.fig);
        const cls = 'dchip' + (blank ? ' blank' : '') + (!graded && x.start === d.at ? ' at' : '') + (wrong ? ' is-wrong' : '');
        const svg = blank ? '' : dictFigSVG(q, x.fig);
        if (graded) return `<span class="${cls}" style="flex:${beats}" role="img" aria-label="${esc(label + (wrong ? ', not what the melody has' : ''))}">${svg}</span>`;
        return `<button class="${cls}" data-act="dAt" data-tick="${x.start}" style="flex:${beats}" aria-label="${esc(label)}"${x.start === d.at ? ' aria-current="true"' : ''}${dictWait()}>${svg}</button>`;
      });
      rows.push(`<div class="dict-bar"><span class="dict-n" aria-hidden="true">${b + 1}</span>${chips.join('')}</div>`);
    }
    return `<div class="dict-bars">${rows.join('')}</div>`;
  }
  // the level's figures for this meter, keys 1-9; one that cannot go at the cursor says why when tapped
  function dictPaletteHTML(q, d) {
    return `<div class="dict-palette" role="group" aria-label="Figures">${q.palette.map((id, i) => {
      const no = TL.Dict.refuse(q, id, d.at);
      return `<button class="dfig" data-act="dFig" data-id="${id}" aria-label="${esc(TL.RCELLS[id].label)}" title="${esc(TL.RCELLS[id].label)}"${no ? ' aria-disabled="true"' : ''}${dictWait()}>${dictFigSVG(q, id)}${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`;
    }).join('')}</div>`;
  }

  // ----- the notes: the written notes as slots, a thin rule between bars -----
  // What a slot says to a screen reader, which sees neither its place nor its colour: "Note 3,
  // bar 1, beat 3: Mi" ("after beat 3" off the beat); graded, the name against the melody's.
  function dictSlotLabel(q, x, j, locked, w) {
    const at = TL.Dict.where(q, x.tick), name = x.name ? degName(x.name) : 'no name yet';
    const head = `Note ${j + 1}, bar ${at.bar}, ${at.part ? 'after ' : ''}beat ${at.beat}: `;
    if (locked) return `${head}${name}, given`;
    if (!w) return head + name;
    if (!w.nameOk && w.pair != null) return `${head}you wrote ${name}, the melody has ${degName(q.notes[w.pair].id)}${w.extra ? ', an extra note' : ''}`;
    return head + name + (w.extra ? ', an extra note' : w.nameOk ? ', right' : ', wrong');
  }
  function dictSlotsHTML(q, d, g) {
    const on = TL.Dict.onsets(q, d.entry);
    let bar = 0;
    return `<div class="slots dict-slots" id="dictSlots">${on.map((x, j) => {
      const b = Math.floor(x.tick / q.barTicks), rule = j && b !== bar ? '<i class="dict-rule" aria-hidden="true"></i>' : '';
      bar = b;
      const locked = TL.Dict.locked(q, x.tick), w = g && !locked ? g.written[j] : null;
      let cls = 'slot' + (x.name ? ' filled' : '') + (locked ? ' given' : ''), fix = '';
      if (w) {
        cls += w.nameOk && !w.extra ? ' is-correct' : ' is-wrong';
        if (!w.nameOk && w.pair != null) fix = `<span class="fix">${esc(degText(q.notes[w.pair].id).main)}</span>`;
      } else if (!g && j === d.ni) cls += ' active';
      const look = x.name ? ` data-deg="${x.name}" style="--h:${DEG[x.name].hue}"` : '';
      const text = esc(x.name ? degText(x.name).main : '?') + fix, label = ` aria-label="${esc(dictSlotLabel(q, x, j, locked, w))}"`;
      if (locked || g) return `${rule}<span class="${cls}" role="img"${label}${look}>${text}</span>`;
      return `${rule}<button class="${cls}" data-act="dSlot" data-n="${j}"${label}${j === d.ni ? ' aria-current="true"' : ''}${look}>${text}</button>`;
    }).join('')}</div>`;
  }

  // ----- the step switch, the step's controls, the actions -----
  function dictSwitchHTML(q, d) {
    const total = (q.bars * q.barTicks) / q.beat, covered = total - TL.Dict.blanks(q, d.entry).length;
    const on = TL.Dict.onsets(q, d.entry), named = on.filter((x) => x.name).length;
    return `<div class="seg dict-switch" id="dictSwitch" role="group" aria-label="Step">
      <button data-act="dStep" data-step="rhythm" aria-pressed="${d.step === 'rhythm'}"${dictWait()}>Rhythm · ${covered} of ${total} beats</button>
      <button data-act="dStep" data-step="notes" aria-pressed="${d.step === 'notes'}"${on.length ? dictWait() : ' disabled'}>Notes${on.length ? ` · ${named} of ${on.length}` : ''}</button>
    </div>`;
  }
  function dictPanelHTML(q, d) {
    if (d.step === 'rhythm') return `<div class="dict-panel" id="dictPanel">${dictBarsHTML(q, d)}<p class="dict-status">${esc(dictBarStatus(q, d.entry, d.at))}</p>${dictPaletteHTML(q, d)}</div>`;
    return `<div class="dict-panel" id="dictPanel">${dictSlotsHTML(q, d)}<p class="dict-status" id="dictStatus">${esc(dictNameStatus(q, d.entry))}</p><div>${notesHTML(q, 'dName', {})}</div></div>`;
  }
  function dictActionsHTML(q, d) {
    const done = TL.Dict.complete(q, d.entry);
    return `<div class="seq-actions" id="dictActions"><button class="btn sm" data-act="dBack"${dictWait()}>Delete <kbd>⌫</kbd></button>${S.settings.dictationSound ? `<button class="btn sm" data-act="dPlay"${dictWait()}>Play mine</button>` : ''}<button class="btn sm primary" data-act="dCheck"${done ? '' : ' disabled'}>Check <kbd>Enter</kbd></button></div>`;
  }
  function dictTipHTML(q) {
    const native = new Set(TL.MODE_SCALE[q.mode || 'major']);
    const alt = q.options.some((o) => !native.has(o.id)) ? ', <kbd>⇧</kbd> with it for an altered note' : '';
    const keys = window.matchMedia('(hover: hover)').matches
      ? `<p class="tip muted">In Rhythm, <kbd>1</kbd>–<kbd>${Math.min(9, q.palette.length)}</kbd> pick a figure. In Notes, type a note’s number to name it${alt}. <kbd>R</kbd> and <kbd>N</kbd> switch steps, <kbd>←</kbd> <kbd>→</kbd> move, <kbd>⌫</kbd> deletes, <kbd>Enter</kbd> checks, <kbd>Space</kbd> replays everything.</p>` : '';
    return `<div class="fb"><p class="eyebrow">How to listen</p><p class="tip">${esc(TIPS.dictation)}</p>${keys}</div>`;
  }

  // The question's body: the staff across the width; under it the switch, the step's controls and
  // the actions beside #fb (one column on a phone). After Check, both staves, the rows and slots
  // graded, and the feedback; the palette and the pitch control go.
  function dictHTML() {
    const q = R.q, d = R.dict;
    const g = R.phase === 'feedback' ? d.grade : null;
    const ctl = g ? dictBarsHTML(q, d, true) + dictSlotsHTML(q, d, g) : dictSwitchHTML(q, d) + dictPanelHTML(q, d) + dictActionsHTML(q, d);
    return `<div class="q-body wide dict">${dictStavesHTML(q, d, g)}<div class="q-body"><div class="dict-ctl">${ctl}</div><div id="fb">${g ? dictFeedbackHTML() : dictTipHTML(q)}</div></div></div>`;
  }
  // After an edit: everything but the pitch control, which keeps its buttons (and a note lit on
  // them), as renderSeq does; a button reached with the keyboard keeps the focus.
  function renderDict() {
    const q = R && R.q, d = R && R.dict;
    if (!q || q.kind !== 'dictation' || !d || R.phase !== 'answering') return;
    const ae = document.activeElement, ds = ae && ae.dataset && ae.dataset.act ? ae.dataset : null;
    const swap = (id, html) => { const el = $('#' + id); if (el) el.outerHTML = html; };
    swap('dictStaff', dictStavesHTML(q, d));
    swap('dictSwitch', dictSwitchHTML(q, d));
    if (d.step === 'rhythm') swap('dictPanel', dictPanelHTML(q, d));
    else { swap('dictSlots', dictSlotsHTML(q, d)); swap('dictStatus', `<p class="dict-status" id="dictStatus">${esc(dictNameStatus(q, d.entry))}</p>`); }
    swap('dictActions', dictActionsHTML(q, d));
    if (ds && !document.contains(ae)) {
      const el = $(`[data-act="${ds.act}"]${['id', 'tick', 'n', 'step'].filter((k) => ds[k] != null).map((k) => `[data-${k}="${ds[k]}"]`).join('')}`);
      if (el) el.focus();
    }
  }

  // ----- the feedback -----
  // a figure in words, with its article; a run of the same figure is counted ("two quarter notes")
  const FIG_PHRASE = {
    q: ['a quarter note', 'quarter notes'], h: ['a half note', 'half notes'], w: ['a whole note', 'whole notes'], dh: ['a dotted half note', 'dotted half notes'],
    qr: ['a quarter rest', 'quarter rests'], dq: ['a dotted quarter', 'dotted quarters'], dqr: ['a dotted quarter rest', 'dotted quarter rests'],
    ee: ['two eighth notes', 'eighth notes', 2], eee: ['three eighth notes', 'eighth notes', 3],
    dqe: ['a dotted quarter and an eighth'], qe: ['a quarter and an eighth'], eq: ['an eighth and a quarter'],
  };
  const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  // figures in time order: "a half note, then two eighth notes"
  function dictFigList(ids) {
    const runs = [];
    for (const id of ids) { const r = runs[runs.length - 1]; if (r && r.id === id) r.n++; else runs.push({ id, n: 1 }); }
    return runs.map(({ id, n }) => {
      const [one, many, per = 1] = FIG_PHRASE[id] || [TL.RCELLS[id].label];
      if (n === 1) return one;
      return many ? `${NUMBER_WORDS[n * per] || n * per} ${many}` : `${one}, ${n === 2 ? 'twice' : NUMBER_WORDS[n] + ' times'}`;
    }).join(', then ');
  }
  // What went wrong, in time order. A run of wrong figures is one sentence with what was written
  // over it, up to where the two line up again (a figure never crosses a bar line, so they do by the
  // next one); a note written where the melody rests says so. Then each wrong name and missing note.
  function dictSentences(q, e, g) {
    const out = [];
    const place = (tick) => { const w = TL.Dict.where(q, tick); return `Bar ${w.bar}, beat ${w.beat}`; };
    const sounds = (id) => TL.RCELLS[id].ticks.filter((t) => t > 0).length;
    for (let i = 0; i < g.figs.length; i++) {
      if (g.figs[i].ok) continue;
      const start = g.figs[i].start, mel = [g.figs[i].id];
      let end = Math.max(g.figs[i].end, ...g.figs[i].wrote.map((w) => w.end));
      while (i + 1 < g.figs.length && g.figs[i + 1].start < end) {
        i++;
        mel.push(g.figs[i].id);
        end = Math.max(end, g.figs[i].end, ...g.figs[i].wrote.map((w) => w.end));
      }
      const wrote = e.figs.filter((f) => f.start >= start && f.start < end).map((f) => f.id);
      const n = wrote.reduce((a, id) => a + sounds(id), 0);
      const rests = mel.every((id) => !sounds(id)) && wrote.every((id) => TL.RCELLS[id].ticks.every((t) => t > 0));
      out.push({ tick: start, text: rests ? `${place(start)}: you wrote ${n === 1 ? 'a note' : 'notes'} where the melody has none.` : `${place(start)}: ${dictFigList(mel)}. You wrote ${dictFigList(wrote)}.` });
    }
    g.notes.forEach((x, i) => {
      if (!x.graded || x.nameOk) return;
      const name = degName(x.id);
      out.push({ tick: x.tick, text: x.pair == null ? `Note ${i + 1}, ${name}, is missing from yours.` : `Note ${i + 1} was ${name}. You wrote ${degName(x.said)}.` });
    });
    return out.sort((a, b) => a.tick - b.tick).map((s) => s.text);
  }
  function dictFeedbackHTML() {
    const q = R.q, g = R.dict.grade;
    const said = dictSentences(q, R.dict.entry, g);
    const extra = g.extra ? ` · ${g.extra} extra note${g.extra === 1 ? '' : 's'}` : '';
    return `<div class="fb ${g.all ? 'good' : 'bad'}">
      <p class="verdict">${g.all ? 'All correct' : `${g.right} of ${q.notes.length} notes right`}</p>
      <p class="explain">Names ${g.names.right} of ${g.names.of} · lengths ${g.lengths.right} of ${g.lengths.of}${extra}.</p>
      ${said.slice(0, 3).map((s) => `<p class="explain">${esc(s)}</p>`).join('')}
      ${said.length > 3 ? `<p class="explain">And ${said.length - 3} more on the staves.</p>` : ''}
      ${q.practice ? '<p class="tip">A practice round: it counts toward today, not toward the next level.</p>' : ''}
      <div class="row">
        <button class="btn sm" data-act="hear" data-what="correct">Hear it again</button>
        ${g.all ? '' : '<button class="btn sm" data-act="dPlay">Hear what you wrote</button>'}
      </div>
      ${levelUpHTML()}
      ${g.all ? '' : struggleHTML(q)}
      <div class="row"><button class="btn primary" data-act="next">Continue <kbd>Enter</kbd></button></div>
    </div>`;
  }

export { dictBarStatus, dictFeedbackHTML, dictHTML, dictNameStatus, renderDict };
