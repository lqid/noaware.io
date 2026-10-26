'use strict';
// Synthetic singers, app sound leaking through speakers, and microphones, for testing pitch.js.
// Everything is deterministic from a seed.

const TAU = Math.PI * 2;
const TN = 4096;
const TABLE = (() => { const t = new Float32Array(TN + 1); for (let i = 0; i <= TN; i++) t[i] = Math.sin((i / TN) * TAU); return t; })();
function sinCyc(p) { // p in cycles
  p -= Math.floor(p);
  const x = p * TN, i = x | 0, f = x - i;
  return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * f;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dbAmp = (db) => Math.pow(10, db / 20);

// Formants [F, bandwidth] (adult male); women ×1.15.
const VOWELS = {
  a: [[730, 90], [1090, 110], [2440, 170], [3400, 250], [4200, 300]],
  e: [[530, 70], [1840, 100], [2480, 160], [3500, 250], [4300, 300]],
  i: [[270, 60], [2290, 100], [3010, 150], [3500, 200], [4400, 300]],
  o: [[570, 80], [840, 90], [2410, 160], [3300, 250], [4200, 300]],
  u: [[300, 60], [870, 90], [2240, 150], [3300, 200], [4200, 300]],
  m: [[260, 70], [1250, 350], [2300, 350], [3300, 400], [4300, 400]],
};
function formantGain(f, fm) {
  let g = 1;
  for (const [F, B] of fm) {
    const b2 = (B / 2) * (B / 2);
    g *= (F * F + b2) / Math.sqrt(((f - F) * (f - F) + b2) * ((f + F) * (f + F) + b2));
  }
  return g;
}

// RBJ biquad, in place.
function biquad(x, sr, type, f0, q = 0.707) {
  const w = TAU * f0 / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  else if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; } // band-pass
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

// ---------- the singer ----------
// note: { t0, dur, midi (fractional), vowel, amp, attack, release,
//         scoop: [cents, sec]  (starts `cents` away and arrives over `sec`),
//         vibrato: [cents, hz], drift: cents across the note, wobble: [cents, hz],
//         onset: 'd'|'r'|'m'|'f'|'s'|'l'|'t'|null }
// singer: { female, breath (0..1), jitter (fraction), shimmer (fraction), tilt (exponent), tune (prob. of F1 tracking f0) }
function renderVoice(out, sr, notesIn, singer, r) {
  const len = out.length;
  const notes = [];
  const bursts = [];
  for (const n of notesIn) {
    const on = n.onset;
    if (on === 'd' || on === 'r' || on === 'l' || on === 'm') {
      // voiced consonant: a short, quieter murmur at the note's pitch just before the vowel
      const cd = on === 'm' ? 0.08 : on === 'd' ? 0.035 : 0.055;
      notes.push({ t0: n.t0 - cd, dur: cd + 0.012, midi: n.midi + (n.scoop ? n.scoop[0] / 100 : 0), vowel: on === 'r' ? 'u' : 'm', amp: n.amp * (on === 'd' ? 0.25 : 0.4), attack: 0.01, release: 0.01, cons: true });
    } else if (on === 'f' || on === 's' || on === 't') {
      bursts.push({ t0: n.t0 - (on === 's' ? 0.09 : on === 'f' ? 0.07 : 0.03), dur: on === 's' ? 0.085 : on === 'f' ? 0.065 : 0.025, kind: on, amp: n.amp * (on === 's' ? 0.35 : on === 'f' ? 0.15 : 0.4) });
    }
    notes.push(n);
  }
  const cents = new Float64Array(len).fill(NaN);
  const env = new Float32Array(len);
  const owner = new Int32Array(len).fill(-1);
  notes.forEach((n, ni) => {
    const s0 = Math.max(0, Math.round(n.t0 * sr)), s1 = Math.min(len, Math.round((n.t0 + n.dur) * sr));
    const att = n.attack ?? 0.04, rel = n.release ?? 0.07;
    const vph = r() * TAU, wph = r() * TAU;
    const wander = n.cons ? 0 : (singer.wander ?? 0);
    let rw = 0;
    for (let s = s0; s < s1; s++) {
      const t = s / sr - n.t0;
      if (wander && (s - s0) % 64 === 0) rw = 0.992 * rw + gauss(r) * wander * 0.126;
      let c = n.midi * 100 + rw;
      if (n.scoop) { const [sc, st] = n.scoop; if (t < st) { const u = 1 - t / st; c += sc * u * u; } }
      if (n.vibrato) c += n.vibrato[0] * Math.sin(TAU * n.vibrato[1] * t + vph) * Math.min(1, t / 0.35);
      if (n.drift) c += n.drift * (t / n.dur);
      if (n.wobble) c += n.wobble[0] * Math.sin(TAU * n.wobble[1] * t + wph);
      const e = n.amp * Math.max(0, Math.min(1, t / att, (n.dur - t) / rel));
      if (e >= env[s]) { env[s] = e; cents[s] = c; owner[s] = ni; }
    }
  });
  const B = 128;
  let phase = 0, jit = 0, shim = 0;
  const amps = new Float64Array(80);
  const tilt = singer.tilt ?? 1.0;
  const fScale = singer.female ? 1.15 : 1.0;
  for (let b0 = 0; b0 < len; b0 += B) {
    const b1 = Math.min(len, b0 + B);
    let rep = -1;
    for (let s = b0; s < b1; s++) if (owner[s] >= 0) { rep = s; break; }
    if (rep < 0) continue;
    const n = notes[owner[rep]];
    const f0 = midiHz(cents[rep] / 100);
    const fm = VOWELS[n.vowel || 'a'].map(([F, Bw]) => [F * fScale, Bw]);
    if (!n.cons && f0 > fm[0][0] * 0.95 && (n.tuned ?? true)) fm[0] = [f0 * 1.05, fm[0][1]]; // F1 follows a high f0
    jit = 0.85 * jit + 0.15 * gauss(r) * (singer.jitter ?? 0.004) * 2.5;
    shim = 0.7 * shim + 0.3 * gauss(r) * (singer.shimmer ?? 0.05);
    const K = Math.max(1, Math.min(79, Math.floor(Math.min(5200, sr / 2 - 400) / f0)));
    let pw = 0;
    for (let k = 1; k <= K; k++) { amps[k] = Math.pow(k, -tilt) * formantGain(k * f0, fm); pw += amps[k] * amps[k]; }
    const norm = 1 / Math.sqrt(pw / 2);
    for (let s = b0; s < b1; s++) {
      if (owner[s] < 0) continue;
      const f = midiHz(cents[s] / 100) * (1 + jit);
      phase += f / sr;
      let v = 0;
      for (let k = 1; k <= K; k++) v += amps[k] * sinCyc(k * phase);
      const on = notes[owner[s]];
      if (on.fry && s / sr - on.t0 < on.fry) v *= Math.floor(phase) % 2 ? 0.4 : 1;
      out[s] += v * norm * env[s] * (1 + shim);
    }
  }
  // breath: aspiration noise riding on the voice
  if (singer.breath) {
    const nz = new Float32Array(len);
    for (let s = 0; s < len; s++) nz[s] = env[s] > 0 ? gauss(r) * env[s] * singer.breath * 0.35 : 0;
    biquad(nz, sr, 'hp', 900);
    for (let s = 0; s < len; s++) out[s] += nz[s];
  }
  for (const bu of bursts) {
    const s0 = Math.max(0, Math.round(bu.t0 * sr)), s1 = Math.min(len, Math.round((bu.t0 + bu.dur) * sr));
    const nz = new Float32Array(s1 - s0);
    for (let i = 0; i < nz.length; i++) { const u = i / nz.length; nz[i] = gauss(r) * bu.amp * Math.sin(Math.PI * Math.min(1, u * 1.3)); }
    biquad(nz, sr, 'hp', bu.kind === 's' ? 3800 : bu.kind === 'f' ? 1500 : 2000);
    for (let i = 0; i < nz.length; i++) out[s0 + i] += nz[i];
  }
  return out;
}

// ---------- the app's own sound, heard through the speakers ----------
const APP_PARTIALS = {
  organ: [1, 0.72, 0.42, 0.33, 0, 0.18, 0, 0.13],
  piano: [1, 0.62, 0.42, 0.3, 0.2, 0.14, 0.1, 0.075, 0.055, 0.04, 0.03, 0.022],
  strings: [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12],
};
// tone: { t0, dur, midis: [..], timbre, amp }. Returns the time the app stops "playing" (release end).
function renderApp(out, sr, tones, r) {
  const len = out.length;
  for (const tn of tones) {
    const parts = APP_PARTIALS[tn.timbre] || APP_PARTIALS.piano;
    const rel = tn.timbre === 'organ' ? 0.12 : 0.25;
    const end = tn.t0 + tn.dur + rel;
    const tailEnd = end + 1.7;
    const s0 = Math.max(0, Math.round(tn.t0 * sr)), s1 = Math.min(len, Math.round(tailEnd * sr));
    for (const m of tn.midis) {
      const f0 = midiHz(m);
      const ph = parts.map(() => r());
      const det = [0, 1].map(() => (r() - 0.5) * 0.004); // the reverb tail smears the pitch slightly
      const tph = det.map(() => r());
      const a = tn.amp / Math.sqrt(tn.midis.length);
      for (let s = s0; s < s1; s++) {
        const t = s / sr - tn.t0;
        let dry;
        if (t < 0) continue;
        if (tn.timbre === 'piano') dry = Math.min(1, t / 0.005) * Math.exp(-t / 1.4) * (t < tn.dur ? 1 : Math.max(0, 1 - (t - tn.dur) / rel));
        else dry = Math.min(1, t / 0.02) * (t < tn.dur ? 1 : Math.max(0, 1 - (t - tn.dur) / rel));
        // wet: builds while the note sounds, then decays like the convolver's impulse
        const u = t - tn.dur;
        const wet = 0.2 * (u < 0 ? Math.min(1, t / 0.25) * (tn.timbre === 'piano' ? Math.exp(-t / 1.4) : 1) : (tn.timbre === 'piano' ? Math.exp(-tn.dur / 1.4) : 1) * Math.pow(Math.max(0, 1 - u / 2), 2.8));
        let v = 0;
        for (let k = 0; k < parts.length; k++) {
          const fk = f0 * (k + 1);
          if (!parts[k] || fk > sr / 2 - 500) continue;
          if (dry > 0) v += parts[k] * dry * sinCyc(fk * t + ph[k]);
          if (wet > 0.0005) for (let d = 0; d < 2; d++) v += parts[k] * wet * 0.707 * sinCyc(fk * (1 + det[d]) * t + tph[d] + k * 0.37);
        }
        out[s] += v * a;
      }
    }
  }
  return out;
}
const appWindows = (tones) => tones.map((tn) => [tn.t0, tn.t0 + tn.dur + (tn.timbre === 'organ' ? 0.12 : 0.25)]);

// ---------- the scene: singer + speakers → room → mic ----------
// scene: { sr, dur, seed, singer, notes, app: [tones], leakDb (app level vs. singing, dB), speakerHp,
//          micHp, voiceDb (singing level, dBFS rms at amp 1), noise: { whiteDb, fanDb, humDb } }
function renderScene(sc) {
  const r = rng(sc.seed);
  const sr = sc.sr;
  const len = Math.round(sc.dur * sr);
  const voice = new Float32Array(len);
  renderVoice(voice, sr, sc.notes || [], sc.singer || {}, r);
  if (sc.roomWet) {
    const rt = sc.rt60 || 0.5, wet = new Float32Array(len);
    for (const ms of [29.7, 37.1, 41.1, 43.7]) {
      const D = Math.round(ms * sr / 1000), gfb = Math.pow(10, (-3 * ms / 1000) / rt);
      const buf = new Float32Array(D); let k = 0;
      for (let i = 0; i < len; i++) { const y = buf[k]; buf[k] = voice[i] + y * gfb; k = (k + 1) % D; wet[i] += y * 0.25; }
    }
    for (const ms of [5.0, 1.7]) {
      const D = Math.round(ms * sr / 1000), ga = 0.7; const buf = new Float32Array(D); let k = 0;
      for (let i = 0; i < len; i++) { const b = buf[k]; const x = wet[i]; const y = -ga * x + b; buf[k] = x + ga * y; k = (k + 1) % D; wet[i] = y; }
    }
    const w = dbAmp(sc.roomWet);
    for (let i = 0; i < len; i++) voice[i] += wet[i] * w;
  }
  const g = dbAmp(sc.voiceDb ?? -22);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = voice[i] * g;
  if (sc.app && sc.app.length) {
    const app = new Float32Array(len);
    renderApp(app, sr, sc.app, r);
    biquad(app, sr, 'hp', sc.speakerHp ?? 220);
    const ga = g * dbAmp(sc.leakDb ?? 0);
    for (let i = 0; i < len; i++) out[i] += app[i] * ga;
  }
  biquad(out, sr, 'hp', sc.micHp ?? 90);
  const nz = sc.noise || {};
  if (nz.whiteDb != null) { const a = dbAmp(nz.whiteDb); for (let i = 0; i < len; i++) out[i] += gauss(r) * a; }
  if (nz.fanDb != null) {
    const f = new Float32Array(len);
    for (let i = 0; i < len; i++) f[i] = gauss(r);
    biquad(f, sr, 'lp', 400); biquad(f, sr, 'lp', 400);
    let p = 0; for (let i = 0; i < len; i++) p += f[i] * f[i];
    const a = dbAmp(nz.fanDb) / Math.sqrt(p / len || 1);
    for (let i = 0; i < len; i++) out[i] += f[i] * a;
  }
  if (sc.hissDb != null) {
    // consonant hiss and breath with no tone in it
    const h = new Float32Array(len), br = new Float32Array(len);
    for (let i = 0; i < len; i++) { const t = i / sr; const gate = 0.5 + 0.5 * Math.sin(TAU * 3 * t); h[i] = gauss(r) * gate; br[i] = gauss(r) * (1 - gate); }
    biquad(h, sr, 'hp', 3000); biquad(br, sr, 'hp', 800);
    const a = dbAmp(sc.hissDb);
    for (let i = 0; i < len; i++) out[i] += (h[i] + 0.6 * br[i]) * a;
  }
  if (nz.humDb != null) {
    const a = dbAmp(nz.humDb), hz = nz.humHz || 50;
    for (let i = 0; i < len; i++) { const t = i / sr; out[i] += a * (Math.sin(TAU * hz * t) + 0.5 * Math.sin(TAU * 2 * hz * t + 1) + 0.3 * Math.sin(TAU * 3 * hz * t + 2)); }
  }
  for (let i = 0; i < len; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

module.exports = { rng, gauss, midiHz, dbAmp, VOWELS, renderScene, renderVoice, renderApp, appWindows, biquad };
