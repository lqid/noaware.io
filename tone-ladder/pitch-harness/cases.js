'use strict';
// Test scenes for microphone grading, with the grade a fair listener would give (see README.md).
const { rng } = require('./synth');

const VOICE = { low: 45, mid: 50, high: 57 };
function voiceTonic(tonic, voice) { const lo = VOICE[voice]; let t = tonic; while (t >= lo + 12) t -= 12; while (t < lo) t += 12; return t; }
function rangeBase(vt, semis, voice) {
  const lo = VOICE[voice] - 2, hi = VOICE[voice] + 19;
  const mn = Math.min(...semis), mx = Math.max(...semis);
  const out = (b) => Math.max(0, lo - (mn + b)) + Math.max(0, mx + b - hi);
  let best = vt;
  for (const b of [vt - 12, vt + 12]) if (out(b) < out(best)) best = b;
  return best;
}
const SYL = { 0: 'd', 2: 'r', 4: 'm', 5: 'f', 7: 's', 9: 'l', 11: 't' };
const VOW = { 0: 'o', 2: 'e', 4: 'i', 5: 'a', 7: 'o', 9: 'a', 11: 'i' };
const mod12 = (x) => ((x % 12) + 12) % 12;

function maker(seed, profile) {
  const r = rng(seed);
  const U = (a, b) => a + (b - a) * r();
  const I = (a, b) => Math.floor(U(a, b + 1));
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const sign = () => (r() < 0.5 ? -1 : 1);
  const hold = profile === 'holdout';

  function singer(voice) {
    const female = voice === 'high' || (voice === 'mid' && r() < 0.25);
    const breathy = r() < 0.3;
    return { female, breath: breathy ? U(0.25, 0.6) : U(0, 0.15), jitter: U(0.002, 0.008), shimmer: U(0.02, 0.09), tilt: breathy ? U(1.3, 1.8) : U(0.8, 1.3), wander: U(3, 12) };
  }
  function room() {
    const noise = { whiteDb: U(-72, -52) };
    if (r() < (hold ? 0.45 : 0.3)) noise.fanDb = U(-58, -42);
    if (r() < (hold ? 0.35 : 0.25)) noise.humDb = U(-62, -48);
    const room = r() < 0.6 ? { roomWet: U(-18, -8), rt60: U(0.3, 0.8) } : {};
    return { micHp: pick([70, 100, 140, 180, 220]), speakerHp: pick([180, 250, 320]), voiceDb: U(-34, -14), leakDb: U(-12, 4), noise, ...room, sr: r() < (hold ? 0.5 : 0.3) ? 44100 : 48000 };
  }
  // the four chords that start every question (I IV V7 I), as the app plays them
  function cadence(tonic, t0 = 0.15) {
    const timbre = pick(['piano', 'piano', 'organ', 'strings']);
    const ch = [[-12, 4, 7, 12], [-7, 5, 9, 12], [-5, 5, 7, 11], [-12, 4, 7, 12]];
    return ch.map((c, i) => ({ t0: t0 + i * 0.62, dur: i === 3 ? 1.05 : 0.59, midis: c.map((x) => tonic + x), timbre, amp: 0.9 }));
  }
  const appEnd = (tones) => Math.max(...tones.map((tn) => tn.t0 + tn.dur + (tn.timbre === 'organ' ? 0.12 : 0.25)));
  const vowelFor = (semi, style) => (style === 'hum' ? 'm' : style === 'la' ? 'a' : VOW[mod12(semi)] || pick(['a', 'o']));
  const singNote = (t0, dur, midi, extra = {}) => ({ t0, dur, midi, vowel: 'a', amp: U(0.65, 1), attack: U(0.03, 0.07), release: U(0.05, 0.1), ...(midi < 52 && r() < 0.25 ? { fry: U(0.06, 0.16) } : {}), ...extra });

  function base(kind) {
    const voice = pick(['low', 'mid', 'mid', 'high']);
    const tonic = 60 + I(-6, 5);
    const vt = voiceTonic(tonic, voice);
    return { kind, voice, tonic, vt, singer: singer(voice), ...room() };
  }

  // ---------- hold ----------
  function holdCase(group, o = {}) {
    const c = base('hold');
    const item = o.semi ?? pick([0, 0, 2, 4, 5, 7, 9, 11]);
    const near = item > 7 ? item - 12 : item; // La and Ti are sung below Do
    const bm = rangeBase(c.vt, [near], c.voice);
    const app = cadence(c.tonic);
    if (o.practiceDo) app.push({ t0: appEnd(app) + 0.05, dur: 2.4, midis: [c.vt], timbre: 'organ', amp: 0.8 });
    if (o.leakDb != null) c.leakDb = o.leakDb;
    let t = appEnd(app) + U(0.25, 0.9);
    const notes = [];
    if (o.doFirst) {
      // hums Do for a while, stops to think, then sings the note
      const d = U(1.0, 1.4);
      notes.push(singNote(t, d, bm + (near >= 0 ? 0 : 0) + U(-0.15, 0.15), { vowel: 'm', amp: U(0.3, 0.45) }));
      t += d + U(0.8, 1.0);
    }
    if (o.steps) {
      const path = near >= 0 ? [0, 2, 4, 5, 7].filter((x) => x < near) : [0, -1, -3].filter((x) => x > near);
      for (const s of path) {
        const d = U(0.35, 0.55);
        notes.push(singNote(t, d, bm + s + U(-0.2, 0.2), { vowel: 'm', amp: U(0.25, 0.45) }));
        t += d + U(0, 0.08);
      }
    }
    const sungSemi = o.wrongBy ? near + o.wrongBy : near;
    const oct = o.octave ? sign() * 12 : 0;
    // a note one semitone off is pushed away from the target, so a 'wrong' note is never inside the 80-cent Close band
    const off = Math.abs(o.wrongBy || 0) === 1 ? Math.sign(o.wrongBy) * Math.abs(o.off ?? 0) : o.off ?? 0;
    const dur = o.dur ?? U(1.2, 2.6);
    const n = singNote(t, dur, bm + sungSemi + oct + off / 100, { vowel: o.hum ? 'm' : pick(['a', 'o', 'u', hold ? 'e' : 'a', 'i']) });
    if (o.vibrato) n.vibrato = o.vibrato;
    if (o.scoop) n.scoop = o.scoop;
    if (o.wobble) n.wobble = o.wobble;
    if (o.amp) n.amp = o.amp;
    if (o.lowMale) { c.micHp = U(170, 230); }
    if (o.noisy) { c.voiceDb = U(-36, -30); c.noise = { whiteDb: U(-56, -50), fanDb: U(-46, -40), humDb: U(-54, -48) }; }
    const silent = o.silent;
    if (!silent) notes.push(n);
    if (o.walkHome && !silent) {
      // after holding the note, walks back home to Do, more quietly
      let tt = n.t0 + n.dur + U(0.05, 0.2);
      const path = near > 0 ? [0, 2, 4, 5, 7].filter((x) => x < near).reverse() : [0, -1, -3].filter((x) => x > near).reverse();
      for (const x of path.slice(-2)) { const d = U(0.35, 0.5); notes.push(singNote(tt, d, bm + x + U(-0.15, 0.15), { vowel: 'm', amp: U(0.25, 0.4) })); tt += d + U(0, 0.06); }
    }
    const last = notes[notes.length - 1];
    const singEnd = silent ? null : last.t0 + last.dur;
    const shortNote = !silent && o.expect == null; // a note too short to grade: the listener finishes with nothing
    return {
      ...c, group, target: [item], doMidi: c.vt, notes, app,
      dur: (singEnd ?? t) + 4.2,
      expect: o.expect,
      singEnd,
      earliestDone: singEnd == null ? null : singEnd + (shortNote ? 2.0 : 1.2),
      latestDone: singEnd == null ? null : singEnd + (shortNote ? 3.9 : 2.7),
      noDone: silent,
    };
  }

  // ---------- sequences ----------
  function melody(type) {
    const L = type === 'read3' ? { pool: [0, 2, 4, 5, 7], n: 3, leap: 4, starts: [0], ends: [0, 4, 7] }
      : type === 'read5' ? { pool: [-5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12], n: 5, leap: 7, starts: [0], ends: [0, 4, 7, 12] }
        : type === 'echo4' ? { pool: [-1, 0, 2, 4, 5, 7], n: 4, leap: 4, starts: [0, 4], ends: [0] }
          : { pool: [-5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12], n: 6, leap: 7, starts: [0, 4], ends: [0] };
    for (let k = 0; k < 500; k++) {
      const m = [pick(L.starts)];
      let ok = true;
      for (let i = 1; i < L.n; i++) {
        const cands = L.pool.filter((s) => s !== m[i - 1] && Math.abs(s - m[i - 1]) <= L.leap && (Math.abs(s - m[i - 1]) <= 2 || r() < 0.45));
        if (!cands.length) { ok = false; break; }
        m.push(pick(cands));
      }
      if (ok && L.ends.includes(m[m.length - 1])) return m;
    }
    return L.starts.concat(L.pool.slice(0, L.n - 1));
  }
  function seqCase(group, o = {}) {
    const c = base('sequence');
    const type = o.type || pick(['read3', 'read5', 'echo4', 'echo6']);
    const mel = melody(type);
    const echo = type.startsWith('echo');
    const app = cadence(c.tonic);
    if (echo) {
      const t1 = appEnd(app) + 0.05;
      mel.forEach((s, i) => app.push({ t0: t1 + i * 0.6, dur: i === mel.length - 1 ? 1.0 : 0.55, midis: [c.tonic + s], timbre: 'piano', amp: 0.9 }));
    }
    if (o.leakDb != null) c.leakDb = o.leakDb;
    if (o.noisy) { c.voiceDb = U(-36, -30); c.noise = { whiteDb: U(-56, -50), fanDb: U(-46, -40), humDb: U(-54, -48) }; }
    const style = o.style || pick(['solfege', 'solfege', 'la', 'legato', hold ? 'hum' : 'solfege']);
    // what is actually sung, as semitones from Do (before octave and offset)
    const errMax = o.offset || o.drift ? 7 : 22;
    let sung = mel.map((s) => ({ s, err: Math.max(-errMax, Math.min(errMax, (r() - 0.5) * 2 * U(4, 16))) }));
    const bad = (i, by) => { const w = mel[i] + by; return mod12(w) !== mod12(mel[i]) && (i === 0 || mod12(w) !== mod12(mel[i - 1])) && (i === mel.length - 1 || mod12(w) !== mod12(mel[i + 1])); };
    const corrupt = (i) => { for (const by of [1, -1, 2, -2, 3].sort(() => r() - 0.5)) if (bad(i, by)) { sung[i].s = mel[i] + by; return true; } return false; };
    if (o.wrong) {
      const idx = [...mel.keys()].sort(() => r() - 0.5);
      let done = 0, prev = -9;
      for (const i of idx) { if (done >= o.wrong) break; if (Math.abs(i - prev) < 2 && o.wrong > 1) continue; if (corrupt(i)) { done++; prev = i; } }
      if (done < o.wrong) return null;
    }
    if (o.missing) { const i = I(1, mel.length - 1); sung.splice(i, 1); }
    if (o.transposed) { const k = pick([2, 4, 5, -3, -2]); sung = sung.map((x) => ({ ...x, s: x.s - k })); }
    let restartAt = -1;
    if (o.restart) { restartAt = 2; sung = [...sung.slice(0, 2).map((x) => ({ ...x, again: false })), ...sung.map((x, i) => (i === 0 ? { ...x, restart: true } : x))]; }
    if (o.partial) sung = sung.slice(0, 2);
    let extraAt = -1;
    if (o.extra) { extraAt = I(1, sung.length - 1); sung.splice(extraAt, 0, { s: sung[extraAt - 1].s, err: 0, again: true }); }
    const bm = rangeBase(c.vt, mel, c.voice) + (o.octave ? sign() * 12 : 0);
    const offset = o.offset || 0;
    const drift = o.drift || 0;
    let t = appEnd(app) + U(0.35, 1.0);
    const notes = [];
    sung.forEach((x, i) => {
      const d = (type.startsWith('read') ? U(0.42, 0.8) : U(0.38, 0.62)) * (x.again ? 0.8 : 1);
      if (x.restart) t += U(0.5, 0.8);
      if (o.pauseLast && i === sung.length - 1) t += U(1.0, 1.4);
      const cents = offset + drift * (sung.length > 1 ? i / (sung.length - 1) : 0) + x.err;
      const midi = bm + x.s + cents / 100;
      const n = singNote(t, d, midi, { vowel: vowelFor(x.s, style) });
      if (o.vibrato) n.vibrato = [U(25, 50), U(4.8, 6.3)];
      if (style === 'legato' && i > 0 && !x.again) {
        const prev = notes[notes.length - 1];
        n.t0 = prev.t0 + prev.dur; prev.release = 0.002; n.attack = 0.002;
        n.scoop = [(prev.midi - midi) * 100, U(0.04, 0.09)];
      } else {
        const on = style === 'la' ? 'l' : style === 'hum' ? 'm' : style === 'solfege' ? SYL[mod12(x.s)] : null;
        n.onset = on;
        if (i > 0) n.t0 += U(0.03, 0.1) + (x.again ? U(0.25, 0.4) : 0) + (on === 's' || on === 'f' || on === 't' ? 0.08 : 0);
        if (r() < 0.3) n.scoop = [-U(40, 120), U(0.05, 0.12)];
      }
      notes.push(n);
      t = n.t0 + n.dur;
    });
    const singEnd = notes.length ? notes[notes.length - 1].t0 + notes[notes.length - 1].dur : null;
    // all the notes sung: finish after 2 s of quiet; fewer: after 3 s
    const all = sung.length >= mel.length;
    return {
      ...c, group: o.group || group, type, style, target: mel, sung: sung.map((x) => x.s), doMidi: c.vt, notes: o.silent ? [] : notes, app,
      dur: (o.silent ? t : singEnd) + 4.4,
      expect: o.expect,
      singEnd: o.silent ? null : singEnd,
      earliestDone: o.silent ? null : singEnd + (all ? 1.6 : 2.5),
      latestDone: o.silent ? null : singEnd + (all ? 3.0 : 3.9),
      noDone: !!o.silent,
    };
  }

  const cases = [];
  const add = (n, f) => { for (let i = 0; i < n; i++) { const x = f(i); if (x) cases.push(x); } };
  const k = hold ? 1 : 1;
  // hold
  add(14 * k, (i) => holdCase('hold-ok', { off: pick([0, 10, -10, 20, -20, 30, -30]), expect: 1 }));
  add(10 * k, () => holdCase('hold-close', { off: sign() * pick([58, 64, 70]), expect: 0.5 }));
  add(6 * k, () => holdCase('hold-near', { off: sign() * U(38, 43), expect: 1 }));
  add(6 * k, () => holdCase('hold-walk-home', { semi: pick([2, 4, 5, 7, 9, 11]), walkHome: true, off: U(-25, 25), expect: 1 }));
  add(6 * k, () => holdCase('hold-do-first', { semi: pick([2, 4, 5, 7]), doFirst: true, off: U(-25, 25), expect: 1 }));
  add(6 * k, () => holdCase('hold-do-first-wrong', { semi: pick([4, 5, 7, 9]), doFirst: true, wrongBy: pick([1, -1, 2, -2]), off: U(-20, 20), expect: 0 }));
  add(12 * k, () => holdCase('hold-wrong', { wrongBy: pick([1, -1, 2, -2, 3, 4, 5, 7, -5]), off: U(-25, 25), expect: 0 }));
  add(10 * k, () => holdCase('hold-steps', { semi: pick([2, 4, 5, 7, 9, 11]), steps: true, off: U(-25, 25), expect: 1 }));
  add(6 * k, () => holdCase('hold-steps-wrong', { semi: pick([4, 5, 7, 9]), steps: true, wrongBy: pick([1, -1, 2, -2]), off: U(-20, 20), expect: 0 }));
  add(8 * k, () => holdCase('hold-vibrato', { vibrato: [U(35, 65), U(4.8, 6.5)], off: U(-20, 20), expect: 1 }));
  add(8 * k, () => holdCase('hold-scoop', { scoop: [-U(80, 200), U(0.1, 0.18)], off: U(-20, 20), expect: 1 }));
  add(6 * k, () => holdCase('hold-slide', { scoop: [-U(250, 400), U(0.5, 0.75)], off: U(-15, 15), dur: U(1.6, 2.6), expect: 0.5 }));
  add(5 * k, () => holdCase('hold-wobble', { wobble: [U(85, 110), U(0.9, 1.4)], off: 0, dur: U(1.8, 2.6), expect: 0.5 }));
  add(8 * k, () => holdCase('hold-octave', { octave: true, off: U(-25, 25), expect: 1 }));
  add(6 * k, () => holdCase('hold-low-hp', { lowMale: true, off: U(-20, 20), expect: 1 }));
  add(6 * k, () => holdCase('hold-quiet-hum', { hum: true, amp: U(0.22, 0.35), off: U(-20, 20), expect: 1 }));
  add(4 * k, () => holdCase('hold-long', { dur: U(3.6, 5), off: U(-20, 20), expect: 1 }));
  add(6 * k, () => holdCase('hold-noisy', { noisy: true, off: U(-20, 20), expect: 1 }));
  add(5 * k, () => holdCase('hold-short', { dur: U(0.16, 0.24), off: 0, expect: null }));
  add(6 * k, () => holdCase('silent', { silent: true, expect: null }));
  add(8 * k, () => holdCase('leak-silent', { semi: 0, practiceDo: true, silent: true, leakDb: U(-2, 8), expect: null }));
  add(6 * k, () => holdCase('leak-sing', { semi: 0, practiceDo: true, leakDb: U(-4, 6), off: U(-20, 20), expect: 1 }));
  add(6 * k, () => holdCase('leak-wrong', { semi: 0, practiceDo: true, leakDb: U(-4, 6), wrongBy: pick([2, 4, 5, 7, -3]), off: U(-15, 15), expect: 0 }));
  // sequences
  add(18 * k, () => seqCase('seq-ok', { expect: 1 }));
  add(12 * k, () => seqCase('seq-one-off', { wrong: 1, expect: 0.5 }));
  add(10 * k, () => seqCase('seq-two-off', { wrong: 2, type: pick(['read5', 'echo4', 'echo6']), expect: 0 }));
  add(8 * k, () => seqCase('seq-missing', { missing: true, type: pick(['read5', 'echo4', 'echo6']), expect: 0.5 }));
  add(8 * k, () => seqCase('seq-extra', { extra: true, expect: 0.5 }));
  add(6 * k, () => seqCase('seq-offset-small', { offset: sign() * U(18, 28), expect: 1 }));
  add(6 * k, () => seqCase('seq-offset-big', { offset: sign() * U(36, 42), expect: 1 }));
  add(6 * k, () => seqCase('seq-drift-big', { drift: sign() * U(80, 95), type: pick(['read5', 'echo6']), expect: 0.5 }));
  add(6 * k, () => seqCase('seq-transposed', { transposed: true, type: pick(['read5', 'echo4', 'echo6']), expect: 0 }));
  add(6 * k, () => seqCase('seq-restart', { restart: true, type: pick(['read5', 'echo4', 'echo6']), expect: 0.5 }));
  add(6 * k, () => seqCase('seq-pause-last', { pauseLast: true, expect: 1 }));
  add(6 * k, () => seqCase('seq-drift', { drift: sign() * U(25, 35), expect: 1 }));
  add(6 * k, () => seqCase('seq-octave', { octave: true, expect: 1 }));
  add(6 * k, () => seqCase('seq-vibrato', { vibrato: true, expect: 1 }));
  add(6 * k, () => seqCase('seq-legato', { style: 'legato', expect: 1 }));
  add(5 * k, () => seqCase('seq-partial', { partial: true, type: pick(['read5', 'echo6']), expect: 0 }));
  add(6 * k, () => seqCase('seq-leak-silent', { type: pick(['echo4', 'echo6']), silent: true, leakDb: U(0, 8), expect: null }));
  add(6 * k, () => seqCase('seq-leak-sing', { type: pick(['echo4', 'echo6']), leakDb: U(-4, 6), expect: 1 }));
  add(6 * k, () => seqCase('seq-noisy', { noisy: true, expect: 1 }));
  // other sample rates: a call-quality Bluetooth route, and studio interfaces
  for (const sr of [16000, 24000, 96000]) {
    add(3 * k, () => { const c = holdCase(`rate-${sr / 1000}k-hold`, { off: U(-25, 25), expect: 1 }); c.sr = sr; return c; });
    add(3 * k, () => { const c = seqCase(`rate-${sr / 1000}k-seq`, { expect: 1 }); if (c) c.sr = sr; return c; });
  }
  cases.forEach((c, i) => { c.name = `${c.group}-${i}`; c.seed = seed * 1000 + i; });
  return cases;
}

// Single frames with a known pitch (or none), for raw detector accuracy.
function detectFrames(seed, profile) {
  const r = rng(seed + 77);
  const U = (a, b) => a + (b - a) * r();
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const out = [];
  const vowels = profile === 'holdout' ? ['a', 'e', 'i', 'o', 'u', 'm'] : ['a', 'i', 'u', 'm', 'o'];
  for (let m = 38; m <= 86; m += 2) {
    for (const v of vowels) {
      const f0 = 440 * Math.pow(2, (m + U(-0.5, 0.5) - 69) / 12);
      out.push({
        kind: 'voiced', midi: Math.log2(f0 / 440) * 12 + 69, hz: f0,
        scene: {
          sr: r() < 0.5 ? 44100 : 48000, dur: 0.6, voiceDb: U(-32, -14), micHp: pick([70, 120, 180, 220]),
          singer: { female: f0 > 200 && r() < 0.7, breath: U(0, 0.5), jitter: U(0.002, 0.007), shimmer: U(0.02, 0.08), tilt: U(0.8, 1.7) },
          notes: [{ t0: 0.02, dur: 0.56, midi: Math.log2(f0 / 440) * 12 + 69, vowel: v, amp: 1, vibrato: r() < 0.4 ? [U(10, 40), U(5, 6)] : null }],
          noise: { whiteDb: U(-70, -50), ...(r() < 0.3 ? { fanDb: U(-56, -46) } : {}), ...(r() < 0.25 ? { humDb: U(-60, -50) } : {}) },
        },
        at: [0.22, 0.34, 0.46],
      });
    }
  }
  const quiet = [
    { whiteDb: -70 }, { whiteDb: -55 }, { whiteDb: -48 }, { fanDb: -45, whiteDb: -65 }, { humDb: -46, whiteDb: -66 }, { humDb: -52, humHz: 60, whiteDb: -66 }, { fanDb: -50, humDb: -54, whiteDb: -60 },
  ];
  for (const nz of quiet) for (let k = 0; k < 4; k++) out.push({ kind: 'unvoiced', scene: { sr: 48000, dur: 0.6, noise: nz, micHp: pick([70, 140]) }, at: [0.2, 0.35, 0.5] });
  // consonant noise and breath with no tone
  for (let k = 0; k < 8; k++) out.push({ kind: 'unvoiced', scene: { sr: 48000, dur: 0.6, notes: [], noise: { whiteDb: -66 }, hissDb: -34 - 3 * k, micHp: 100 }, at: [0.2, 0.35, 0.5] });
  return out;
}

const SEEDS = { dev: [4242, 'dev'], holdout: [90210, 'holdout'], final: [777, 'holdout'] };
module.exports = { cases: (set) => maker(...(SEEDS[set] || SEEDS.dev)), detectFrames: (set) => detectFrames(...(SEEDS[set] || SEEDS.dev)), voiceTonic, rangeBase };
