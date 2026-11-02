/* Tone Ladder — shared names, formatting, the DOM helpers, sound settings, wake lock, item names, device info. */

  const TL = window.TL;
  const S = TL.Store, A = TL.Audio, CUR = TL.Curriculum;
  const { TRACKS, TRACK } = CUR;
  // the tracks that are sung and listened to (the microphone stays open for their sets)
  const sungTrack = (id) => id === 'sing' || id === 'sight';
  const isFindDo = (q) => q.track === 'sing' && q.level === 0;
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
    A.configure({ volume: s.volume, timbre: s.timbre === 'vary' ? 'piano' : s.timbre, speed: s.speed, samples: !micCopy() });
    if (s.timbre === 'vary' && !micCopy()) Object.keys(A.SAMPLED).forEach((n) => A.loadSamples(n)); // the pool wants them all
  }

  // The instruments to offer: the synthesized ones, the recorded sets this copy has, and the
  // chosen one even when its set is not here, worded so the select tells the truth.
  function timbreOptions(chosen) {
    const opts = Object.entries(A.TIMBRES).map(([k, v]) => [k, v + (A.SAMPLED[k] && A.sampled(k) === 'loading' ? ' (loading…)' : '')]);
    const rec = A.SAMPLED[chosen];
    if (rec && !A.TIMBRES[chosen]) { const st = A.sampled(chosen); opts.push([chosen, rec.label + (st === 'loading' || st === 'unknown' ? ' (loading…)' : st === 'failed' ? ' (could not be loaded)' : ' (not on this copy)')]); }
    return opts;
  }
  const VARY = ['piano', 'epiano', 'strings', 'organ'];
  const varyPool = () => [...VARY, ...Object.keys(A.SAMPLED).filter((n) => A.sampled(n) === 'ready')];
  const pickTimbre = () => (S.settings.timbre === 'vary' ? TL.pick(varyPool()) : S.settings.timbre);
  function safeAudio() {
    try { A.ensure(); applyAudio(); return true; } catch (e) { toast(e.message || 'Audio is not available in this browser.'); return false; }
  }
  let wake = null;
  async function requestWake() { try { wake = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) { wake = null; } }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* ignore */ } wake = null; }

  // ---------- item description helpers ----------
  const DIR_ARROW = { a: '↑', d: '↓', h: 'together' };
  function levelItemsText(trackId, lv) {
    switch (trackId) {
      case 'degrees': return lv.type === 'mode' ? 'Major · minor · Dorian · Mixolydian · Lydian · Phrygian' : lv.items.map((i) => degText(i).main).join(' · ') + (lv.wide ? ' · two octaves' : '') + (lv.mode && lv.mode !== 'major' ? ' · ' + TL.MODE_NAMES[lv.mode] : '');
      case 'intervals': {
        const ids = [...new Set(lv.items.map((x) => x.slice(0, -1)))].sort((a, b) => TL.IV[a].semi - TL.IV[b].semi);
        const dirs = [...new Set(lv.items.map((x) => x.slice(-1)))].map((d) => DIR_ARROW[d]).join(' ');
        return ids.map((x) => TL.IV[x].short).join(' · ') + ' · ' + dirs;
      }
      case 'chords': return lv.items.map((x) => TL.CHORD_TYPES[x].name).join(' · ') + (lv.inversions ? ' · inversions' : '');
      case 'harmony': return lv.type === 'modulate' ? 'Stays home · to V · to IV · to vi' : lv.pool.join(' · ') + (lv.mode === 'minor' ? ' · minor' : '');
      case 'melody': return `${lv.length} notes · ` + lv.items.map((i) => degText(i).main).join(' ');
      case 'rhythm': return lv.cells.map((c) => TL.RCELLS[c].label).join(' · ') + (lv.meter ? ' · ' + lv.meter : '');
      case 'dictation': {
        const m = [].concat(lv.meter); // one meter, or one of several per question
        return `${m.length > 1 ? m.slice(0, -1).join(', ') + ' or ' + m[m.length - 1] : m[0]} · ${lv.bars} bars · ` + lv.cells.map((c) => TL.RCELLS[c].label).join(' · ');
      }
      case 'sight': return lv.summary;
      case 'sing': return { degree: lv.mode === 'minor' ? 'Sing notes of a minor key' : 'Sing notes of the key', read: `Sing ${lv.length}-note patterns`, echo: `Echo ${lv.length}-note melodies`, bass: 'Sing the lowest note of a chord', resolve: 'Sing a leaning note, then where it goes', tone: 'Sing a chord’s third, fifth or seventh', bassline: `Sing the bass line of ${lv.length} chords`, interval: 'Sing an interval above or below a given note' }[lv.type] + (lv.type === 'degree' ? ': ' + lv.items.map((i) => degText(i).main).join(' · ') : '');
      default: return '';
    }
  }
  // Full Dictation's items are notes of the key (degree ids) and rhythm figures (anything else)
  function itemName(trackId, it) {
    if ((trackId === 'degrees' || trackId === 'melody' || trackId === 'dictation') && DEG[it]) return degText(it).main + (degText(it).sub ? ' ' + degText(it).sub : '');
    if (trackId === 'intervals') return TL.IV[it.slice(0, -1)].name + ' ' + DIR_ARROW[it.slice(-1)];
    return TRACK[trackId].itemLabel(it);
  }
  function itemHue(trackId, it) {
    if ((trackId === 'degrees' || trackId === 'melody' || trackId === 'dictation') && DEG[it]) return DEG[it].hue;
    if (trackId === 'sing' && DEG[it]) return DEG[it].hue;
    if (trackId === 'harmony') return rnHue(it);
    return TRACK[trackId].hue;
  }

  function flash(el, ms) {
    if (!el) return;
    el.classList.add('lit');
    setTimeout(() => el.classList.remove('lit'), Math.max(160, ms - 30));
  }

  // The claude.ai copy has no microphone access. Other frames are found out on the first try.
  const micCopy = () => !!document.querySelector('meta[name="tl-copy"][content="artifact"]');

  const DEVICE_KEY = 'tone-ladder-v1-device';
  function deviceInfo() { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {}; } catch (e) { return {}; } }
  function setDeviceInfo(patch) { try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...deviceInfo(), ...patch })); } catch (e) { /* blocked */ } }

export { $, $$, A, CUR, DEG, S, TL, TRACK, TRACKS, applyAudio, avg, degText, deviceInfo, esc, flash, fmtDuration, fmtNum, isFindDo, itemHue, itemName, levelItemsText, micCopy, nearestSemi, pct, pickTimbre, releaseWake, requestWake, rnHue, safeAudio, setDeviceInfo, sungTrack, timbreOptions, toast, tonicForPc };
