/* Tone Ladder — hearing the learner sing, for the Sing track. Pure functions, no DOM or audio.
   detect(): one frame to one pitch by the McLeod pitch method: the normalized square difference
   function (NSDF), computed through an FFT autocorrelation, and its first key maximum that comes
   close to the highest one.
   listener(): one question's frames to notes and a grade, by the rules in tone-ladder/pitch-harness/README.md. A frame is
   voice when its pitch carries on from its neighbours and it stands over the room's steady level;
   the app's own sound and its reverb tail never are (a sound that holds still over the tail, once a
   late speaker would have stopped, is the learner singing along). Each run of singing is tracked
   through the detector's octave and twelfth slips, then split into notes at pitch changes
   (stability windows), unvoiced gaps and loudness dips, with glides, consonants and the room's echo
   trimmed off. The time windows follow the caller's timer, so a slow device that pushes every
   60-100 ms still works. A held answer grades the most prominent note (long and loud; pieces broken
   by a breath or cut by a wide vibrato count as one), so Do hummed first or the steps walked home
   afterwards do not count. A melody is judged as a teacher hears it: a common offset is forgiven
   (beyond about 60 cents it is Close, 'offset'), a steady drift, a transposed tune and a restart are
   named, talk or a laugh set off by a pause is left out, and otherwise wrong, missing and extra
   notes are counted. When notes are missing but loud sound without a followable pitch was there, a
   sequence gets no grade ('unclear') rather than a low one, and the app falls back to the learner's
   own grade. Nothing heard is stored or sent: a listener keeps only what it needs to grade one
   answer, and never the caller's frame buffer. */
(function (g) {
  const TL = g.TL || (g.TL = {});

  // Saved takes record this, so a take can be told apart from the grading it was made under.
  // Change it whenever the grading changes.
  const VERSION = '2026-10-27';

  // ---------- tuning ----------
  const F_LO = 62;            // Hz. Below E2 with room for a low voice; above 60 Hz mains hum, whose
                              // period then stays out of range.
  const F_HI = 1400;          // Hz. A5 with headroom, so a high note is never read an octave down.
  const WIN_SEC = 0.043;      // analysis window: three periods of the lowest note, at any sample rate
  const K_MPM = 0.9;          // take the first key maximum within this fraction of the highest
  const HP_HZ = 150;          // high-pass before the NSDF: fans, mains hum and rumble sit below it, and
                              // the period of a low voice survives in its harmonics
  const CLARITY_ON = 0.8;     // detect(): voiced at or above this clarity
  const RMS_MIN = 1e-4;       // -80 dBFS: below this nothing is voiced

  const GAP = 0.09;           // s without voice that splits a note, when the level drops in it too
  const RUN_GAP = { hold: 0.3, sequence: GAP }; // s without voice that ends a run of singing: in a
                              // held note in noise the voice drops out for a moment without stopping
  // The windows above, and the listener's, are tuned for the app's 20 ms timer. A slow or busy
  // device can call less often, so each one is at least HOP_SPAN timer hops: one frame may be
  // missing without the voice looking interrupted.
  const HOP_SPAN = 2.6;
  const CP_WIN = 0.2;         // s each side when comparing pitch before and after a frame: a full
                              // vibrato cycle, so vibrato does not look like a change of note
  const CP_CENTS = 50;        // a change of note: the medians either side differ by this much
  const DIP_DB = 6;           // a consonant or re-articulation: level dips this far below both sides
  const TRIM_CENTS = 50;      // glide frames at a note's edges, this far from its pitch, are trimmed
  const MIN_NOTE = 0.1;       // s. Shorter pieces are glides or consonants
  const SEQ_NOTE = 0.12;      // s. The shortest note that counts in a sequence
  const STACCATO = 0.15;      // s. ... or the shortest piece sung on its own, gaps either side

  // ---------- small helpers ----------
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mod = (x, m) => ((x % m) + m) % m;
  const circ = (c) => mod(c + 600, 1200) - 600; // distance between pitch classes, in cents
  function sorted(a, i0, i1) {
    const b = new Float64Array(i1 - i0);
    for (let i = i0; i < i1; i++) b[i - i0] = a[i];
    return b.sort();
  }
  function quant(s, q) { // s sorted
    if (!s.length) return NaN;
    const x = q * (s.length - 1), i = Math.floor(x), f = x - i;
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i];
  }
  const median = (a, i0 = 0, i1 = a.length) => quant(sorted(a, i0, i1), 0.5);
  function average(a, i0, i1) {
    let s = 0;
    for (let i = i0; i < i1; i++) s += a[i];
    return i1 > i0 ? s / (i1 - i0) : 0;
  }

  // ---------- FFT ----------
  // Radix-2 complex FFT on split arrays, and a real-input wrapper that packs n real samples into
  // n/2 complex ones. Two real transforms make one autocorrelation.
  const PLANS = {};
  function planFor(n) {
    if (PLANS[n]) return PLANS[n];
    const m = n >> 1, bits = Math.round(Math.log2(m));
    const rev = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      rev[i] = r;
    }
    const tc = new Float64Array(m >> 1), ts = new Float64Array(m >> 1);
    for (let i = 0; i < m >> 1; i++) { tc[i] = Math.cos((2 * Math.PI * i) / m); ts[i] = -Math.sin((2 * Math.PI * i) / m); }
    const wc = new Float64Array(m + 1), ws = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) { wc[k] = Math.cos((Math.PI * k) / m); ws[k] = -Math.sin((Math.PI * k) / m); }
    return (PLANS[n] = {
      n, m, rev, tc, ts, wc, ws,
      re: new Float64Array(m), im: new Float64Array(m),
      buf: new Float64Array(n), xr: new Float64Array(m + 1), xi: new Float64Array(m + 1),
      r: new Float64Array(m + 1), nsdf: new Float64Array(m + 1), sq: new Float64Array(n + 1),
    });
  }
  function cfft(P) {
    const { m, rev, tc, ts, re, im } = P;
    for (let i = 0; i < m; i++) {
      const j = rev[i];
      if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
    }
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1, step = m / size;
      for (let i = 0; i < m; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half, wr = tc[k], wi = ts[k];
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  // Spectrum bins 0..n/2 of the real sequence x (length n).
  function rfft(P, x, outRe, outIm) {
    const { m, re, im, wc, ws } = P;
    for (let i = 0; i < m; i++) { re[i] = x[2 * i]; im[i] = x[2 * i + 1]; }
    cfft(P);
    for (let k = 0; k <= m; k++) {
      const a = k === m ? 0 : k, b = k === 0 ? 0 : m - k;
      const er = (re[a] + re[b]) * 0.5, ei = (im[a] - im[b]) * 0.5;
      const or = (im[a] + im[b]) * 0.5, oi = (re[b] - re[a]) * 0.5;
      outRe[k] = er + wc[k] * or - ws[k] * oi;
      if (outIm) outIm[k] = ei + wc[k] * oi + ws[k] * or;
    }
  }
  // r[τ] = Σ x[j]·x[j+τ] for the zero-padded signal in P.buf, τ = 0..n/2.
  function autocorr(P) {
    const { n, m, buf, xr, xi, r } = P;
    rfft(P, buf, xr, xi);
    for (let k = 0; k <= m; k++) buf[k] = xr[k] * xr[k] + xi[k] * xi[k];
    for (let k = m + 1; k < n; k++) buf[k] = buf[n - k]; // the power spectrum is even
    rfft(P, buf, r, null);
    for (let k = 0; k <= m; k++) r[k] /= n;
  }

  // ---------- one frame ----------
  // Second-order Butterworth high-pass, in place on x[0..W). It is primed on the first few
  // milliseconds played backwards, so the frame's first sample does not set it ringing.
  function highpass(x, W, sr, f0) {
    const w = (2 * Math.PI * f0) / sr, cw = Math.cos(w), al = Math.sin(w) / Math.SQRT2;
    const a0 = 1 + al, b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, a1 = (-2 * cw) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = Math.min(W - 1, Math.round((2 * sr) / f0)); i >= 0; i--) {
      const v = x[i], y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
    }
    for (let i = 0; i < W; i++) {
      const v = x[i], y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
  // Returns the best pitch candidate even when it is weak; detect() and the listener decide
  // whether it is a voice. winSec: how much of the frame was analysed (the newest part); rms: the
  // frame's level, hp: its level above the high-pass (where a voice stands out of hum and rumble).
  function analyse(frame, sampleRate) {
    const sr0 = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    // 88.2 to 192 kHz: average 2-4 samples down to about 48 kHz, so the transform stays the size it is
    // at 48 kHz (the voice has nothing up there). Down to 8 kHz the 43 ms window simply holds fewer.
    const D = Math.max(1, Math.round(sr0 / 48000));
    const sr = sr0 / D;
    const len = frame && frame.length > 0 ? frame.length : 0; // a missing frame is silence
    const W = Math.min(Math.floor(len / D), Math.round(sr * WIN_SEC));
    const out = { hz: 0, clarity: 0, rms: 0, hp: 0, winSec: Math.max(0, W) / sr };
    if (W < 64) return out;
    // at least two periods in the window: with less, noise alone looks periodic at long lags
    const maxLag = Math.min(Math.ceil(sr / F_LO), Math.floor(W / 2));
    const minLag = Math.max(2, Math.floor(sr / F_HI));
    let n = 64;
    while (n < W + maxLag + 2) n <<= 1;
    const P = planFor(n), x = P.buf, sq = P.sq;
    // the newest W samples, DC removed (cheap mics and some interfaces carry an offset)
    const off = frame.length - W * D;
    let mean = 0;
    for (let i = 0; i < W; i++) {
      let v = 0;
      for (let d = 0; d < D; d++) {
        const s = frame[off + i * D + d];
        if (Number.isFinite(s)) v += s; // NaN or Infinity from a broken stream counts as silence
      }
      v /= D;
      x[i] = v; mean += v;
    }
    mean /= W;
    let ss = 0;
    for (let i = 0; i < W; i++) { x[i] -= mean; ss += x[i] * x[i]; }
    out.rms = Math.sqrt(ss / W);
    if (out.rms < 1e-7) return out;
    highpass(x, W, sr, HP_HZ);
    x.fill(0, W);
    sq[0] = 0;
    for (let i = 0; i < W; i++) sq[i + 1] = sq[i] + x[i] * x[i];
    out.hp = Math.sqrt(sq[W] / W);
    autocorr(P);
    const r = P.r, ns = P.nsdf;
    // NSDF: n(τ) = 2 r(τ) / m(τ), m(τ) = Σ x[j]² + x[j+τ]² over the overlap
    for (let t = 0; t <= maxLag; t++) {
      const mt = sq[W - t] + (sq[W] - sq[t]);
      ns[t] = mt > 0 ? (2 * r[t]) / mt : 0;
    }
    // key maxima: the top of each positive lobe after the lobe around lag 0
    let t = 1;
    while (t <= maxLag && ns[t] > 0) t++;
    let best = -1, bestV = 0, nmax = 0;
    const keys = [];
    while (t <= maxLag) {
      while (t <= maxLag && ns[t] <= 0) t++;
      if (t > maxLag) break;
      let k = t;
      while (t <= maxLag && ns[t] > 0) { if (ns[t] > ns[k]) k = t; t++; }
      if (k >= maxLag) break; // still rising at the end: a pitch below range, like mains hum
      if (k < minLag) continue;
      // parabolic interpolation of the peak
      const y0 = ns[k - 1], y1 = ns[k], y2 = ns[k + 1];
      const den = y0 - 2 * y1 + y2;
      const dx = den < 0 ? clamp((0.5 * (y0 - y2)) / den, -0.5, 0.5) : 0;
      const v = y1 - 0.25 * (y0 - y2) * dx;
      keys.push(k + dx, v);
      if (v > nmax) nmax = v;
    }
    for (let i = 0; i < keys.length; i += 2) {
      if (keys[i + 1] >= K_MPM * nmax) { best = keys[i]; bestV = keys[i + 1]; break; }
    }
    if (best < 0) return out;
    out.hz = sr / best;
    out.clarity = Math.min(1, bestV);
    return out;
  }

  function detect(frame, sampleRate) {
    const a = analyse(frame, sampleRate);
    const voiced = a.hz > 0 && a.clarity >= CLARITY_ON && a.rms >= RMS_MIN;
    return { hz: voiced ? a.hz : 0, clarity: a.clarity, rms: a.rms };
  }

  // ---------- detector slips ----------
  // A weak or noisy frame can lock onto two, three or four periods (read an octave, a twelfth or
  // two octaves too low) or onto half a period (an octave too high); a voice cracks by an octave.
  // READ lists how the true pitch may sit from the one detected, and what assuming it costs.
  const READ = [0, 1200, 1902, 2400, -1200];
  const READ_COST = [0, 0.6, 1.0, 1.2, 0.8];
  const SLIPS = [1200, -1200, 1902, 2400, -2400];
  // Fold c toward ref when one of the slips explains the difference; null when none does.
  function refold(c, ref, tol) {
    let best = c, bd = Math.abs(c - ref);
    for (const s of SLIPS) { const d = Math.abs(c + s - ref); if (d < bd) { bd = d; best = c + s; } }
    return bd <= tol ? best : null;
  }
  // Two frames that could be one note: equal pitch, or apart by a slip, or by the difference of
  // two slips (one frame read at two periods, the next at three). Only used to decide what is
  // voice, and the wide set only when one of the frames is clear: noise matches it too easily.
  const RELATED = [0, 1200, -1200, 2400, -2400, 1902, -1902, 702, -702, 498, -498];
  const related = (a, b, tol, wide) => RELATED.some((s, k) => (wide || k < 3) && Math.abs(a + s - b) <= tol);
  // The pitch through a run of singing: for every frame, the reading (detected pitch or one of its
  // slips) that keeps the track smooth, by a Viterbi path. A note heard partly at its period and
  // partly at two or three periods comes out as one pitch; a real leap costs one jump.
  function track(r, q) {
    const n = r.length, S = READ.length;
    const cost = new Float64Array(n * S), from = new Uint8Array(n * S);
    const jump = (d) => (d <= 40 ? 0 : d >= 150 ? 2.5 : (2.5 * (d - 40)) / 110);
    for (let k = 0; k < S; k++) cost[k] = READ_COST[k] * (0.3 + q[0]);
    for (let i = 1; i < n; i++) {
      for (let k = 0; k < S; k++) {
        const c = r[i] + READ[k];
        let best = Infinity, bk = 0;
        for (let p = 0; p < S; p++) {
          const v = cost[(i - 1) * S + p] + jump(Math.abs(c - r[i - 1] - READ[p]));
          if (v < best) { best = v; bk = p; }
        }
        cost[i * S + k] = best + READ_COST[k] * (0.3 + q[i]); // a clear frame is harder to overrule
        from[i * S + k] = bk;
      }
    }
    let k = 0;
    for (let x = 1; x < S; x++) if (cost[(n - 1) * S + x] < cost[(n - 1) * S + k]) k = x;
    const out = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { out[i] = r[i] + READ[k]; k = from[i * S + k]; }
    return out;
  }

  // ---------- notes from one run of singing ----------
  // t: window-centre times, r: cents as detected, q: clarity, e: level in dB, for the voiced frames
  // of one run; g: the level of the unvoiced frames just before each frame (NaN when none). Returns
  // notes { t0, t1 (the stable core), ta (where the piece starts), cents (median of the core),
  // level, lo, hi (core frames), src (the run's frames) }. The run's cleaned track goes to runs.
  function segmentRun(t, r, q, e, g, kind, runs) {
    const n = t.length;
    if (n < 3) return [];
    const d = new Float64Array(n - 1);
    for (let i = 1; i < n; i++) d[i - 1] = t[i] - t[i - 1];
    const hop = clamp(quant(d.sort(), 0.5), 0.005, 0.15);
    const gap = Math.max(GAP, HOP_SPAN * hop);
    const c = track(r, q);
    // a stray frame the track could not explain (a fifth slip, a consonant) takes the median of
    // the frames around it
    const cl = Float64Array.from(c);
    for (let i = 0, lo = 0, hi = 0; i < n; i++) {
      while (t[lo] < t[i] - 0.1) lo++;
      while (hi < n && t[hi] <= t[i] + 0.1) hi++;
      const ref = median(c, lo, hi);
      if (Math.abs(c[i] - ref) > 150 && hi - lo >= 5) cl[i] = ref;
    }
    // a single wild frame (a consonant, a crack) should not move anything
    const cm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) cm[i] = cl[i];
      else { const a = cl[i - 1], b = cl[i], x = cl[i + 1]; cm[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), x)); }
    }

    const bounds = [];
    // pitch changes: compare the median pitch of the CP_WIN before and after each frame, and of at
    // least three frames each side (a slow timer, or a missing frame, leaves fewer in the window)
    const Dv = new Float64Array(n), ML = new Float64Array(n), MR = new Float64Array(n);
    for (let i = 1, lo = 0, hi = 0; i < n; i++) {
      while (t[lo] < t[i] - CP_WIN) lo++;
      if (hi < i) hi = i;
      while (hi < n && t[hi] < t[i] + CP_WIN) hi++;
      const a = Math.min(lo, i - 3), b = Math.max(hi, i + 3);
      if (a < 0 || b > n) continue;
      ML[i] = median(cm, a, i); MR[i] = median(cm, i, b);
      Dv[i] = MR[i] - ML[i];
    }
    for (let i = 1; i < n;) {
      if (Math.abs(Dv[i]) < CP_CENTS) { i++; continue; }
      const s = Math.sign(Dv[i]);
      let j = i, k = i;
      while (j < n && Math.sign(Dv[j]) === s && Math.abs(Dv[j]) >= CP_CENTS) { if (Math.abs(Dv[j]) > Math.abs(Dv[k])) k = j; j++; }
      // the boundary: where the pitch crosses halfway between the two sides
      const mid = 0.5 * (ML[k] + MR[k]);
      let b = i;
      while (b < j && s * (cm[b] - mid) <= 0) b++;
      bounds.push({ i: b < j ? b : k, dip: 0 });
      i = j;
    }
    // loudness dips: consonants between notes, re-articulations of one pitch. A note often fades
    // before the next starts, so a smaller dip followed by a strong onset counts too. The level is
    // taken through a 3-frame median: a consonant lasts 60 ms or more, while a reverberant room
    // makes the level flicker for a single frame inside a note.
    const el = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) el[i] = e[i];
      else { const a = e[i - 1], b = e[i], x = e[i + 1]; el[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), x)); }
    }
    for (let k = 1; k < n - 1; k++) {
      if (!(el[k] <= el[k - 1] && el[k] < el[k + 1])) continue;
      let mL = -Infinity, mR = -Infinity;
      for (let j = k - 1; j >= 0 && t[j] >= t[k] - 0.25; j--) mL = Math.max(mL, el[j]);
      for (let j = k + 1; j < n && t[j] <= t[k] + 0.25; j++) mR = Math.max(mR, el[j]);
      const depth = Math.min(mL, mR) - el[k];
      if (depth >= DIP_DB) bounds.push({ i: k, dip: depth });
      else if (mL - el[k] >= 4 && mR - el[k] >= 8) bounds.push({ i: k, dip: DIP_DB });
    }
    // gaps without voice: a break when the level falls in the gap too (a dropout in noise keeps it)
    for (let k = 1; k < n; k++) {
      if (!(t[k] - t[k - 1] > gap && g[k] === g[k])) continue;
      let mL = -Infinity, mR = -Infinity;
      for (let j = k - 1; j >= 0 && t[j] >= t[k - 1] - 0.25; j--) mL = Math.max(mL, e[j]);
      for (let j = k; j < n && t[j] <= t[k] + 0.25; j++) mR = Math.max(mR, e[j]);
      const depth = Math.min(mL, mR) - g[k];
      if (depth >= 4) bounds.push({ i: k, dip: depth });
    }
    bounds.sort((a, b) => a.i - b.i);
    const B = [];
    for (const b of bounds) {
      const p = B[B.length - 1];
      if (p && t[b.i] - t[p.i] < Math.max(0.08, 1.2 * hop)) { p.dip = Math.max(p.dip, b.dip); continue; }
      if (b.i > 0) B.push({ ...b });
    }
    // pieces between boundaries, glides trimmed off their edges
    octaveOf(cm, r, q, n);
    let notes = [];
    const cuts = [0, ...B.map((b) => b.i), n];
    for (let k = 0; k + 1 < cuts.length; k++) {
      if (cuts[k + 1] - cuts[k] < 2) continue;
      const dip = k > 0 ? B[k - 1].dip : 0;
      let nt = core(t, cm, e, q, cuts[k], cuts[k + 1], hop);
      // a short note cut where its scoop arrives, neither part still for long enough: the two together,
      // when that holds still (a syllable of speech or a laugh keeps sliding)
      if (!nt && k + 2 < cuts.length && !B[k].dip && !core(t, cm, e, q, cuts[k + 1], cuts[k + 2], hop)) {
        nt = core(t, cm, e, q, cuts[k], cuts[k + 2], hop);
        if (nt && Math.abs(nt.move) >= GLIDE_CENTS) nt = null;
        if (nt) k++;
      }
      if (nt) { nt.dipBefore = dip; notes.push(nt); }
    }
    // Pieces at one pitch class are one note (the track may change octave mid-note where that is
    // cheaper), unless a loudness dip re-articulated it: in a sequence a repeated note counts, and
    // so does a leap of an octave. In a held note a breath or a vowel change only wavers the level.
    const keepDip = kind === 'sequence' ? DIP_DB : 10;
    for (let k = notes.length - 1; k > 0; k--) {
      const a = notes[k - 1], b = notes[k];
      if (Math.abs(circ(a.cents - b.cents)) < 45 && b.dipBefore < keepDip) {
        const o = 1200 * Math.round((b.cents - a.cents) / 1200);
        if (o) for (let i = b.s; i < b.f; i++) cm[i] -= o;
        const nt = core(t, cm, e, q, a.s, b.f, hop);
        if (nt) { nt.dipBefore = a.dipBefore; notes.splice(k - 1, 2, nt); }
        else if (o) for (let i = b.s; i < b.f; i++) cm[i] += o;
      }
    }
    notes = notes.filter((x, k) => !approach(x, notes[k - 1], notes[k + 1]));
    if (kind === 'hold') wobbleMerge(notes, cm, e, q, hop);
    const src = { t, c: cm, e };
    for (const nt of notes) nt.src = src;
    runs.push(src);
    return notes;
  }
  // The whole run moves by octaves to where its clearest frames heard it (for display: the pitch
  // class is the same in any octave).
  function octaveOf(cm, r, q, n) {
    const votes = {};
    for (let i = 0; i < n; i++) {
      const k = Math.round((cm[i] - r[i]) / 1200);
      if (Math.abs(cm[i] - r[i] - 1200 * k) < 50) votes[k] = (votes[k] || 0) + q[i] * q[i] * q[i] * q[i];
    }
    let best = 0, top = 0;
    for (const k in votes) if (votes[k] > top) { top = votes[k]; best = +k; }
    if (best) for (let i = 0; i < n; i++) cm[i] -= 1200 * best;
  }
  // The stable middle of frames [s, f): glide frames off the edges, then quiet edges: the onset
  // ramp, and the release with the room's echo of the voice, which can ring on at the note's pitch.
  function core(t, cm, e, q, s, f, hop) {
    let lo = s, hi = f - 1, med = median(cm, s, f);
    for (let pass = 0; pass < 2; pass++) {
      while (lo <= hi && Math.abs(cm[lo] - med) > TRIM_CENTS) lo++;
      while (hi >= lo && Math.abs(cm[hi] - med) > TRIM_CENTS) hi--;
      if (lo > hi) return null;
      med = median(cm, lo, hi + 1);
    }
    const peak = quant(sorted(e, lo, hi + 1), 0.9);
    while (lo < hi && e[lo] < peak - 12) lo++;
    while (hi > lo && e[hi] < peak - 7) hi--;
    if (t[hi] - t[lo] + hop < MIN_NOTE) return null;
    const mid = lo + Math.round(0.4 * (hi - lo));
    return {
      s, f, lo, hi, t0: t[lo] - hop / 2, t1: t[hi] + hop / 2, ta: t[s] - hop / 2, tf: t[f - 1] + hop / 2, hop,
      cents: median(cm, lo, hi + 1), level: median(e, lo, hi + 1), clarity: average(q, lo, hi + 1),
      move: slope(t, cm, lo, hi) * (t[hi] - t[lo]), // cents the core travels
      late: hi - mid >= 2 ? slope(t, cm, mid, hi) * (t[hi] - t[mid]) : 0, // ... in its last 60% (past a scoop)
      fade: slope(t, e, s, f - 1), whole: median(e, s, f), // dB/s and level over the whole piece
      rise: quant(sorted(e, s, f), 1) - 0.5 * (e[s] + e[Math.min(s + 1, f - 1)]), // dB above its start
    };
  }
  // least-squares slope of y over t[lo..hi]
  function slope(t, y, lo, hi) {
    let st = 0, sy = 0, stt = 0, sty = 0;
    const k = hi - lo + 1;
    for (let i = lo; i <= hi; i++) { st += t[i]; sy += y[i]; stt += t[i] * t[i]; sty += t[i] * y[i]; }
    const den = k * stt - st * st;
    return den > 1e-12 ? (k * sty - st * sy) / den : 0;
  }
  // A piece joined to a note can be part of it rather than a note: a consonant (short, quieter, at
  // the pitch the note is scooped from), a scoop (short, moving toward the note), or the note dying
  // away into the room (quieter and fading; a reverberant room can even ring at another harmonic).
  function approach(x, prev, next) {
    const short = x.t1 - x.t0 < 0.25;
    // dying away: it starts where the note left off and only falls (a new note rises out of a dip)
    const dying = prev && x.ta - prev.tf <= 0.06 && x.dipBefore < DIP_DB && x.rise <= 3;
    if (dying && x.level <= prev.level - 8 && (short || x.fade <= -25)) return true;
    if (dying && x.whole <= prev.level && x.fade <= -20 && harmonic(x.cents, prev.cents)) return true;
    if (!short) return false;
    if (next && next.ta - x.tf <= 0.06) {
      const d = next.cents - x.cents;
      if (x.level <= next.level - 6 || (Math.abs(d) <= 200 && x.level <= next.level - 4)) return true;
      // (a scoop runs into its note; one sung on its own first, a dip between them, was a note)
      if (next.dipBefore < DIP_DB && Math.abs(d) <= 300 && x.move * Math.sign(d) >= Math.max(20, 0.25 * Math.abs(d))) return true;
    }
    // (a short quieter piece just after a note is the note's end, unless it rose out of a dip: a
    // staccato note sung right after it)
    if (prev && x.ta - prev.tf <= 0.06 && x.dipBefore < DIP_DB && x.level <= prev.level - 5 && Math.abs(x.cents - prev.cents) <= 300) return true;
    return false;
  }
  // b sits at a or at one of its harmonics or subharmonics (2 to 8 times), as a room's ringing can
  const HARM = [0, 1200, 1902, 2400, 2786, 3102, 3369, 3600];
  const harmonic = (b, a) => HARM.some((h) => Math.abs(Math.abs(b - a) - h) <= 50);
  // A slow wobble around one note is cut into pieces that zig-zag up and down; steps toward a note
  // go one way. Three or more zig-zagging pieces at one loudness are one wobbly note.
  function wobbleMerge(notes, cm, e, q0, hop) {
    for (let q = 0; q + 2 < notes.length; q++) {
      let j = q + 1;
      while (j < notes.length) {
        const a = notes[j - 1], b = notes[j];
        const dd = b.cents - a.cents;
        const prevD = j - 1 > q ? a.cents - notes[j - 2].cents : -dd;
        if (b.ta - a.t1 > 0.3 || Math.abs(b.level - notes[q].level) > 5 || Math.abs(dd) > 260 || Math.sign(dd) === Math.sign(prevD)) break;
        j++;
      }
      if (j - q >= 3) {
        const a = notes[q], b = notes[j - 1];
        const lo = a.lo, hi = b.hi;
        notes.splice(q, j - q, { s: a.s, f: b.f, lo, hi, t0: a.t0, t1: b.t1, ta: a.ta, tf: b.tf, cents: median(cm, lo, hi + 1), level: median(e, lo, hi + 1), clarity: average(q0, lo, hi + 1), hop, dipBefore: a.dipBefore, move: 0, wobbly: true });
      }
    }
  }

  // ---------- the listener ----------
  const CAP = 6000;           // frames kept: two minutes at the app's 20 ms timer
  const TAIL_SEC = 2.2;       // the app's reverb tail, with margin
  const TAIL_GAIN = 0.35;     // tail level just after playback, relative to the leak during it
  const K_SAME = 2.2;         // in the tail, a voice at a pitch the app just played must be this much louder
  const K_DIFF = 1.3;         // ... and at another pitch
  // A sound in the tail that holds one pitch and one level, well over the tail and once a late
  // (Bluetooth) speaker has stopped, is a voice: the learner sang along with the app's last note or
  // started before it ended, and was measured with it. A tail dies away; it never holds still.
  const STEADY_LAT = 0.4;     // s after the app stops that a late speaker may still be sounding it
  const STEADY_SEC = 0.45;    // s the sound then holds still
  const STEADY_DB = 2.5;      // dB between the levels of its first, middle and last third
  const STEADY_RANGE = 5;     // dB between its quietest and loudest frame
  const STEADY_OVER = 6;      // dB it stands over the tail as modelled from the playback
  const STEADY_CENTS = 60;    // cents its pitch class stays within
  // No frame is a voice on its own: a noise burst can look periodic for one frame. A frame is a
  // voice when its pitch carries on from a voiced neighbour (a clear frame may do so across a slip),
  // or agrees with the frame before and one of the two is clear, or three weak frames in a row
  // agree (a voice too quiet or noisy to be clear, once the room's noise level is known).
  const STRONG = 0.72;        // a clear frame
  const WEAK = 0.45;          // a weak one, still worth a look
  const LINK = 0.07;          // s between frames for them to be neighbours
  const BACK = 0.1;           // s back to look for a voiced frame to carry on from
  // The room's level, from every frame, the app's sound included: it falls to a quieter frame at
  // once and rises 1 dB/s. A steady buzz or fan whine that is there all along sits at it, so it is
  // never voice, even when it is periodic; a voice stands above it, and the breaths and consonants
  // between its notes keep it down. Measured on the whole frame and above the high-pass, since mains
  // hum and rumble can bury a voice in one and a fan in the other.
  const ROOM_RISE = 1;        // dB/s
  const ROOM_SNR = 1.25;      // a voice is at least this much louder than the room, in one band
  const UNCLEAR_SEC = 0.3;    // s of loud sound without a pitch, per missing note, to give no grade

  // ---------- grading (tone-ladder/pitch-harness/README.md) ----------
  const HOLD_MIN = 0.3;       // s. The shortest note that may be the graded one of a held answer
  const HOLD_FULL = 2.5;      // s. Held longer, a note grows no more prominent
  const NEAR_TIE = 0.9;       // a later note this close to the most prominent one is the answer
  const BREATH = 0.4;         // s: a held note broken by a breath this long is still one note
  const VIB_JOIN = 100;       // cents: pieces of a wide vibrato, cut at its turns, this far apart
  const QUAL = 0.9;           // s of stable core in a note held for 1.0 s (onset and release trimmed)
  const MATCH = 50;           // cents: closer, the nearest semitone is the target
  const CLOSE = 80;           // cents: up to here, near it
  const WOBBLE = 110;         // cents (10th to 90th percentile) swung by the smoothed middle of a
                              // note: a slow swing of about ±80 or more (the percentiles of one or
                              // two cycles, smoothed, read a little under the full swing)
  const WOB_WIN = 0.09;       // s each side of the smoothing: vibrato (4-7 Hz) averages out, a slow
                              // swing (about 1 Hz) keeps 90% of its width
  const HALF = 75;            // cents: a melody's note off by MATCH to this counts half an error
  const DRIFT = 55;           // cents end to start: a steady slide beyond this is graded down (50,
                              // and a margin for how well a few notes show it)
  const DRIFT_LOO = 40;       // cents the slide must still show without any one note (steadiness)
  const DRIFT_MID = 0.4;      // ... and the share of it the notes between the ends show
  const DRIFT_FIT = 30;       // cents: a note this far off the slide is a wrong note, not drift
  const DRIFT_STEP = 40;      // cents a note at most, for the intervals to be right
  const RESTART_GAP = 0.3;    // s of pause after one note for the note to be a false start
  const HEAD_GAP = 0.5;       // s of pause after talk before the melody, for the talk to be left out
  const HEAD_NOTE = 0.25;     // s: talk may pass through the melody's first note for less than this
  const TAIL_GAP = 0.3;       // s of pause after the melody, for what follows to be left out
  const REF_HOLD = 0.9;       // s: the first note hummed this long on its own is finding the key
  const GLIDE_CENTS = 40;     // a piece whose stable middle still slides this far,
  const GLIDE_RATE = 120;     // ... at this many cents a second, and still this far
  const GLIDE_LATE = 20;      // ... in its last 60%, is speech or a laugh
  const OFF_MATCH = 60;       // cents of common offset a melody may sit at and match (MATCH, and a
                              // margin for how well a few notes show it); to CLOSE it is Close
  const LATE_SEC = 0.12;      // s after the app stops: sooner, a note started before it did
  const TRACE_SPAN = 20;      // s of singing the trace covers at most (400 points, 0.05 s apart)
  // when the singing has finished: s without voice after...
  const DONE_HOLD = 1.5;      // ... a held note of graded quality
  const DONE_REF = 2.2;       // ... when the answer is not Do and every such note is at Do: it may be
                              // the learner finding the key before the answer (a Do question keeps
                              // DONE_HOLD whatever is sung, so its wait gives nothing away)
  const DONE_SHORT = 2.5;     // ... a voice but no note long enough (the app asks again)
  const DONE_ALL = 2.0;       // ... every note of a melody
  const DONE_SOME = 3.0;      // ... fewer notes

  function listener(opts) {
    const o = opts || {};
    const sr = Number.isFinite(o.sampleRate) && o.sampleRate > 0 ? o.sampleRate : 48000;
    const doMidi = isFinite(o.doMidi) ? +o.doMidi : 60;
    const kind = o.kind === 'sequence' ? 'sequence' : 'hold';
    const target = (o.target && o.target.length ? Array.from(o.target) : [0]).map((x) => (typeof x === 'number' ? x : NaN));
    // a target that is not a number (a missing lookup) would grade every note: refuse it, and the
    // app falls back to the learner's own grade
    if (!target.every(Number.isFinite)) throw new TypeError('TL.Pitch.listener: target must be numbers (semitones from Do)');

    const fT = new Float64Array(CAP);   // window-centre time, s
    const fC = new Float32Array(CAP);   // cents from Do, folded toward the frames before; NaN when no pitch
    const fR = new Float32Array(CAP);   // cents as detected
    const fQ = new Float32Array(CAP);   // clarity
    const fE = new Float32Array(CAP);   // level, dBFS
    const fV = new Uint8Array(CAP);     // 0 no voice, 1 voice; waiting for a neighbour: 2 weak, 3 clear
    const fA = new Uint8Array(CAP);     // 1 when the app's reverb tail could account for the frame
    const fF = new Float32Array(CAP);   // the room's level at the time, dBFS
    let n = 0;
    let openFrom = 0;                   // frames before this are settled into `closed` notes
    let closed = [], closedRuns = [];
    let cache = null, cacheRuns = [], cacheVer = -1, cacheT = -Infinity, ver = 0;
    let lastVoiced = -Infinity;         // window-centre time of the last voiced frame, echoes aside
    let lastAny = -Infinity;            // ... echoes included
    let since = null;                   // when listening started (or the app last stopped)
    let heardSec = 0;
    let appOn = false;
    // what the app's sound did at the mic; kept through reset(), since a replay's tail follows it
    let playEnd = -Infinity, leakLvl = 0, leakPcs = [], latePcs = [], tailScale = 1;
    const leakRecent = [];
    let floorDb = null;                 // the level of frames that were not voice (see push)
    let roomFull = null, roomHp = null; // the room's level (see ROOM_RISE), whole frame and high-passed
    let prevDb = -Infinity;
    let hop = 0.02, hops = 0, lastT = null; // the timer's usual hop, s
    const link = () => Math.max(LINK, HOP_SPAN * hop);
    const runGap = () => Math.max(RUN_GAP[kind], HOP_SPAN * hop);

    function learnRoom(a, dt) {
      const rise = Math.pow(10, (ROOM_RISE * dt) / 20);
      if (a.rms > 1e-7) roomFull = roomFull == null ? a.rms : Math.min(a.rms, roomFull * rise);
      if (a.hp > 1e-7) roomHp = roomHp == null ? a.hp : Math.min(a.hp, roomHp * rise);
    }
    // how far a frame stands over the room, in the band where it stands out more
    const overRoom = (a) => Math.max(roomFull ? a.rms / roomFull : 0, roomHp ? a.hp / roomHp : 0);

    function tailLevel(t) {
      const u = t - playEnd;
      if (!(u >= 0) || !leakLvl || u > TAIL_SEC) return 0;
      if (u < WIN_SEC + 0.03) return leakLvl; // the frame still holds some of the playback
      return leakLvl * TAIL_GAIN * tailScale * Math.pow(1 - u / TAIL_SEC, 2.8);
    }
    function endPlayback() {
      appOn = false;
      let mx = 0;
      const pcs = [], weak = [];
      for (const [t, rms, c, q] of leakRecent) {
        if (t >= playEnd - 0.35) mx = Math.max(mx, rms);
        if (c === c) (q >= 0.85 ? pcs : weak).push(mod(c, 1200));
      }
      leakLvl = mx; leakPcs = pcs; latePcs = pcs.concat(weak); tailScale = 1;
      leakRecent.length = 0;
      sv = null; svPc = null;
    }
    // The steady sound in the tail (see STEADY_LAT): the run of pitched frames at one pitch class
    // being followed, { from, last, pc }, and the pitch class found sung over the tail. Once found,
    // its frames are voice back to where the sound held that level, and the tail no longer hides
    // that pitch (nor stays scaled up by it).
    let sv = null, svPc = null;
    function steadyCheck(i, t) {
      const same = (j) => fR[j] === fR[j] && Math.abs(circ(fR[j] - sv.pc)) < STEADY_CENTS;
      if (!sv || fT[i] - fT[sv.last] > link() || !(Math.abs(circ(fR[i] - sv.pc)) < STEADY_CENTS)) { sv = { from: i, last: i, pc: fR[i] }; return; }
      sv.last = i;
      const u = t - playEnd, t0 = fT[i] - STEADY_SEC;
      if (u - STEADY_SEC < STEADY_LAT || fT[sv.from] > t0 + hop) return;
      const thirds = [[], [], []], lv = [];
      for (let j = i; j >= sv.from && fT[j] >= t0; j--) {
        if (!same(j)) continue;
        lv.push(fE[j]);
        thirds[Math.min(2, Math.floor((3 * (fT[j] - t0)) / STEADY_SEC))].push(fE[j]);
      }
      if (lv.length < 4 || thirds.some((x) => !x.length)) return;
      const ms = thirds.map((x) => median(Float64Array.from(x))), m = median(Float64Array.from(lv));
      const model = leakLvl * TAIL_GAIN * Math.pow(Math.max(0, 1 - u / TAIL_SEC), 2.8);
      if (Math.max(...ms) - Math.min(...ms) > STEADY_DB || Math.max(...lv) - Math.min(...lv) > STEADY_RANGE) return;
      if (!(m >= 20 * Math.log10(Math.max(model, 1e-9)) + STEADY_OVER)) return;
      svPc = sv.pc; tailScale = 1;
      for (let j = i; j >= Math.max(sv.from, openFrom); j--) {
        if (!same(j)) continue;
        if (Math.abs(fE[j] - m) > 6) break; // where the sound was another (the tail before a voice)
        if (fV[j] === 1) continue;
        fC[j] = fR[j] + 1200 * Math.round((sv.pc - fR[j]) / 1200); fA[j] = 0;
        markVoiced(j);
      }
    }
    // notes of frames [a, b): voiced frames split into runs at gaps; their tracks go to runs
    function regionNotes(a, b, runs) {
      const out = [], gapRun = runGap();
      let i = a;
      while (i < b) {
        while (i < b && fV[i] !== 1) i++;
        if (i >= b) break;
        const idx = [i];
        let j = i + 1;
        for (; j < b; j++) {
          if (fV[j] !== 1) continue;
          if (fT[j] - fT[idx[idx.length - 1]] > gapRun) break;
          idx.push(j);
        }
        if (idx.length >= 3) {
          const L = idx.length, t = new Float64Array(L), r = new Float64Array(L), q = new Float64Array(L), e = new Float64Array(L), gp = new Float64Array(L).fill(NaN);
          idx.forEach((k, m) => {
            t[m] = fT[k]; r[m] = fR[k]; q[m] = fQ[k]; e[m] = fE[k];
            if (m && k - idx[m - 1] > 1) gp[m] = median(fE, idx[m - 1] + 1, k);
          });
          for (const x of segmentRun(t, r, q, e, gp, kind, runs)) out.push(x);
        }
        i = j;
      }
      return out;
    }
    // Settle frames [openFrom, upTo) into closed notes (all of them by default).
    function closeOpen(upTo = n) {
      if (openFrom < upTo) { closed = closed.concat(regionNotes(openFrom, upTo, closedRuns)); ver++; }
      openFrom = upTo;
    }
    // Where to settle a very long run: where its last note starts, so that no note is cut in two
    // (unless that one note is the whole run).
    function lastNoteStart() {
      const open = regionNotes(openFrom, n, []), last = open[open.length - 1];
      let k = openFrom;
      if (last) while (k < n && fT[k] < last.ta) k++;
      return k > openFrom ? k : n;
    }
    // The notes so far. status() asks on every frame, so for it (t given) the open region is
    // segmented again at most every 0.1 s; result() always gets them fresh.
    function allNotes(t) {
      if (cacheVer !== ver && (t == null || !cache || t - cacheT >= 0.1 || t < cacheT)) {
        cacheRuns = []; cache = closed.concat(regionNotes(openFrom, n, cacheRuns)); cacheVer = ver;
        if (t != null) cacheT = t;
      }
      return cache;
    }

    function markVoiced(i) {
      fV[i] = 1; ver++;
      if (fT[i] > lastAny) lastAny = fT[i];
      if (fT[i] > lastVoiced && !echo(i)) lastVoiced = fT[i];
      heardSec += i > 0 ? Math.min(Math.max(0.05, 1.5 * hop), Math.max(0, fT[i] - fT[i - 1])) : hop;
    }
    // A voiced frame well below the loudest of the last half second and still falling is the
    // room's echo of a note that has ended: it does not hold off the end of the singing.
    function echo(i) {
      let peak = -Infinity, prev = -1;
      for (let j = i - 1; j >= openFrom && fT[i] - fT[j] <= 0.5; j--) if (fV[j] === 1) { peak = Math.max(peak, fE[j]); if (prev < 0) prev = j; }
      return prev >= 0 && fE[i] < peak - 8 && fE[i] <= fE[prev];
    }
    // A frame became a voice: weak frames just before it that lead into its pitch are voice too.
    function confirmBack(i) {
      const lk = link();
      for (let j = i - 1; j >= openFrom && fV[j] >= 2 && fT[j + 1] - fT[j] <= lk && related(fC[j], fC[j + 1], 80, fV[j] === 3); j--) markVoiced(j);
    }
    // Recent voiced pitch, to fold a slip back toward.
    function recentPitch(tc) {
      const ref = [];
      for (let i = n - 1; i >= openFrom && ref.length < 5 && tc - fT[i] <= 0.5; i--) if (fV[i] === 1) ref.push(fC[i]);
      return ref.length ? quant(Float64Array.from(ref).sort(), 0.5) : null;
    }

    function push(frame, t, info) {
      const playing = !!(info && info.appPlaying);
      const a = analyse(frame, sr);
      const dB = 20 * Math.log10(Math.max(a.rms, 1e-6));
      const level = clamp((dB + 60) / 50, 0, 1);
      // a frame without a usable time says nothing (and must not poison the room or timer state)
      if (!Number.isFinite(t)) return { voiced: false, cents: null, level };
      const tc = t - a.winSec / 2;
      const dt = lastT == null ? 0 : t - lastT;
      if (dt > 0 && dt < 0.25) { hops++; hop += Math.max(0.05, 1 / hops) * (dt - hop); }
      lastT = t;
      learnRoom(a, clamp(dt, 0, 0.25));
      const rising = dB > prevDb + 1;
      prevDb = dB;
      if (playing) {
        // the app's own sound: how loud it reaches the mic, and at what pitch (clearly, or as a weak
        // frame might be heard, for a chord); never a voice
        const c = a.hz > 0 && a.clarity >= WEAK ? 1200 * Math.log2(a.hz / 440) + 6900 - 100 * doMidi : NaN;
        leakRecent.push([t, a.rms, c, a.clarity]);
        while (leakRecent.length && leakRecent[0][0] < t - 0.5) leakRecent.shift();
        appOn = true; playEnd = t;
        closeOpen();
        return { voiced: false, cents: null, level };
      }
      if (appOn) endPlayback();
      if (since == null) since = t;
      let flag = 0, c = NaN, raw = NaN;
      const tl = tailLevel(t);
      let tailed = false;
      if (a.hz > 0 && a.rms >= RMS_MIN && a.clarity >= WEAK && (floorDb == null || dB >= floorDb + 2) && overRoom(a) >= ROOM_SNR) {
        c = raw = 1200 * Math.log2(a.hz / 440) + 6900 - 100 * doMidi;
        const ref = recentPitch(tc);
        if (ref != null && Math.abs(c - ref) > 850) { const f = refold(c, ref, 120); if (f != null) c = f; }
        flag = a.clarity >= STRONG ? 3 : 2;
        if (tl > 0 && !(svPc != null && Math.abs(circ(c - svPc)) < STEADY_CENTS)) {
          const same = leakPcs.some((p) => Math.abs(circ(c - p)) < 70);
          // just after playback the tail is measured: when the room or speaker rings longer than
          // modelled (or a Bluetooth speaker is still playing), the model is scaled up. Only by a
          // sound no louder than the playback and not rising: a learner who starts on the app's
          // last note rises out of its tail.
          if (t - playEnd < WIN_SEC + 0.15 && same && a.rms > tl && a.rms <= leakLvl && !rising) tailScale = Math.min(3, tailScale * (a.rms / tl));
          if (a.rms < tailLevel(t) * (same ? K_SAME : K_DIFF)) { flag = 0; tailed = true; }
        }
      }
      if (flag === 0 && a.rms > 1e-7) {
        // room noise: falls fast, rises slowly so a breathy voice does not lift it; in the app's
        // tail it may only fall, as the tail dies into it. A dropped (all-zero) frame says nothing.
        if (floorDb == null) floorDb = Math.max(-100, dB);
        else if (dB < floorDb) floorDb += 0.5 * (dB - floorDb);
        else if (tl === 0) floorDb += Math.min(dB - floorDb, Math.max(0.01, 0.03 * (dB - floorDb)));
      }
      if (n === CAP) dropOld();
      const i = n++;
      // (the notes depend only on voiced frames and the gaps between them, so a frame that is not
      // voice yet leaves `ver`, and the cached notes, alone)
      fT[i] = tc; fE[i] = dB; fC[i] = flag ? c : NaN; fR[i] = raw; fQ[i] = a.clarity; fV[i] = 0;
      fA[i] = tl > 0 && (tailed || a.rms < tl * K_SAME) ? 1 : 0;
      fF[i] = roomFull ? 20 * Math.log10(roomFull) : dB;
      if (tl > 0 && svPc == null && raw === raw) steadyCheck(i, t);
      if (flag && fV[i] !== 1) {
        fV[i] = flag;
        const lk = link(), p = i - 1, linked = p >= openFrom && tc - fT[p] <= lk;
        // carries on from a voiced frame of the last 0.1 s (one or two may have been unclear)
        let on = linked && fV[p] === 1 && related(c, fC[p], 80, flag === 3);
        const back = Math.max(BACK, 3.5 * hop);
        for (let j = p; j >= openFrom && j >= i - 3 && tc - fT[j] <= back && !on; j--) on = fV[j] === 1 && related(c, fC[j], 80, false);
        if (on) markVoiced(i);
        else if (linked && fV[p] >= 2 && related(c, fC[p], 60, false)) {
          if (flag === 3 || fV[p] === 3) { markVoiced(p); markVoiced(i); confirmBack(p); }
          else if (floorDb != null && p - 1 >= openFrom && fV[p - 1] >= 2 && fT[p] - fT[p - 1] <= lk && related(fC[p - 1], fC[p], 60, false)) {
            markVoiced(p - 1); markVoiced(p); markVoiced(i); confirmBack(p - 1);
          }
        }
      }
      // a run is settled once the voice has been gone a while (or after very long humming)
      if (lastAny >= fT[openFrom] && tc - lastAny > runGap() + Math.max(0.1, HOP_SPAN * hop)) closeOpen();
      else if (fV[i] === 1 && tc - fT[openFrom] > 12) closeOpen(lastNoteStart());
      return { voiced: fV[i] === 1, cents: fV[i] === 1 ? fC[i] : null, level };
    }
    // Memory stays bounded however long the mic is left open: the oldest half is forgotten. What
    // came before the note now sounding is settled first, and that note's frames are kept whole.
    function dropOld() {
      closeOpen(lastNoteStart());
      let k = Math.min(CAP >> 1, openFrom);
      if (k < CAP >> 3) { closeOpen(); k = CAP >> 1; } // one note longer than the buffer
      fT.copyWithin(0, k); fC.copyWithin(0, k); fR.copyWithin(0, k); fQ.copyWithin(0, k); fE.copyWithin(0, k); fV.copyWithin(0, k);
      fA.copyWithin(0, k); fF.copyWithin(0, k);
      n -= k; openFrom -= k; ver++;
      if (sv) { sv.from -= k; sv.last -= k; if (sv.from < 0) sv = null; }
      closed = closed.filter((x) => x.t1 >= fT[0]);
      closedRuns = closedRuns.filter((x) => x.t[x.t.length - 1] >= fT[0]);
    }

    // Forget the singing. What was learned about the app's leak, its tail, the room and the timer
    // stays: the app resets as a replay starts, and the replay leaks into the same mic and room.
    function reset() {
      n = 0; openFrom = 0; closed = []; closedRuns = []; cache = null; ver++;
      lastVoiced = lastAny = -Infinity; heardSec = 0; since = null; sv = null; svPc = null;
    }

    // A short note already sounding as the app stopped (too soon for a learner to react), at a pitch
    // it played, may be the app's own sound arriving late through a Bluetooth speaker: on its own it
    // is no sign that anyone sang.
    const lateLeak = (x) => x.t1 - x.t0 < QUAL && x.ta - playEnd < LATE_SEC && latePcs.some((p) => Math.abs(circ(x.cents - p)) < 70);

    function status(t) {
      if (!Number.isFinite(t)) t = lastT != null ? lastT : 0;
      const notes = allNotes(t);
      // since the last voice; before any, since the app went quiet (for the app's "nothing heard" hint)
      const from = lastVoiced > -Infinity ? lastVoiced : Math.max(since != null ? since : t, playEnd);
      const silent = appOn ? 0 : Math.max(0, t - from);
      const gs = holdGroups(notes);
      const held = gs.length ? gs[gs.length - 1].held : 0;
      // The same waits whether the singing was right or wrong, so finishing gives nothing away; a
      // learner who has not made a sound yet is never cut off. `can`: something was sung that the
      // listener can finish on (a blip too short to be a note is not, and then the app's "can't hear
      // you" hint may still come).
      let done = false, can = false;
      if (kind === 'hold') {
        const q = gs.filter((x) => x.held >= QUAL);
        can = q.length > 0 || notes.some((x) => !lateLeak(x));
        if (!appOn && q.length) done = silent >= (notDo && q.every(atDo) ? DONE_REF : DONE_HOLD);
        else if (!appOn && can) done = silent >= DONE_SHORT;
      } else {
        const ns = seqNotes(notes);
        can = ns.some((x) => !lateLeak(x));
        if (!appOn && can) done = silent >= (ns.length >= target.length ? DONE_ALL : DONE_SOME);
      }
      return { heard: can || (heardSec >= 0.1 && silent < DONE_HOLD), held, done, silent };
    }

    function result() {
      const notes = allNotes();
      const res = kind === 'hold' ? gradeHold(notes) : gradeSeq(notes);
      res.trace = trace();
      return res;
    }

    function gradeHold(notes) {
      const want = target[0];
      // `graded` (and `final` on the note) mark the note the grade is about
      const out = (v, reason, fin, extra) => ({
        v, reason,
        notes: notes.map((x) => {
          const off = circ(x.cents - 100 * want);
          const nt = { t0: x.t0, t1: x.t1, cents: x.cents, semi: Math.round(x.cents / 100), off, ok: x === fin && v != null && Math.abs(off) < MATCH, clarity: x.clarity };
          if (x === fin) nt.final = true;
          return nt;
        }),
        graded: fin ? notes.indexOf(fin) : -1,
        steps: [], extra: 0, offset: 0, drift: 0, ...extra,
      });
      // Nothing held long enough to judge: the app asks again (and finishes the same way, see status).
      const fin = holdGroups(notes).some((x) => x.held >= QUAL) ? prominent(notes) : null;
      if (!fin) return out(null, heardSec >= 0.05 ? 'short' : 'silent', null);
      const off = circ(fin.cents - 100 * want), a = Math.abs(off);
      if (!(a <= CLOSE)) return out(0, 'wrong', fin);
      const slid = slideOf(fin), wob = wobbleOf(fin);
      if (a >= MATCH) return out(0.5, 'close', fin, { slid, wobble: wob });
      if (slid) return out(0.5, 'slid', fin, { slid, wobble: wob });
      if (wob) return out(0.5, 'wobble', fin, { slid, wobble: wob });
      return out(1, 'match', fin, { slid, wobble: wob });
    }
    // Pieces k and k + 1 are one held note: at one pitch and touching (a held note in a noisy room
    // can break where the pitch track wavers or the level dips), or apart by a breath with each held
    // a while, or swinging up and down around one pitch (a wide, slow vibrato cut at its turns).
    function joinedAt(notes, k) {
      const a = notes[k], b = notes[k + 1], gap = b.ta - a.tf, d = circ(b.cents - a.cents);
      if (Math.abs(d) < MATCH) return gap <= 0.15 || (gap <= BREATH && a.t1 - a.t0 >= HOLD_MIN && b.t1 - b.t0 >= HOLD_MIN);
      if (gap > 0.15 || Math.abs(d) >= VIB_JOIN) return false;
      const turn = (j) => {
        if (j < 0 || j + 1 >= notes.length || notes[j + 1].ta - notes[j].tf > 0.15) return false;
        const e = circ(notes[j + 1].cents - notes[j].cents);
        return Math.abs(e) < VIB_JOIN && Math.sign(e) !== Math.sign(d);
      };
      return turn(k - 1) || turn(k + 1);
    }
    // The held notes: runs of joined pieces, with the time held (the pieces' stable cores together)
    // and the piece that stands for the note (the longest).
    function holdGroups(notes) {
      const out = [];
      for (let a = 0, i = 0; i < notes.length; i++) {
        if (i + 1 < notes.length && joinedAt(notes, i)) continue;
        let held = 0, main = notes[a];
        for (let j = a; j <= i; j++) { held += notes[j].t1 - notes[j].t0; if (notes[j].t1 - notes[j].t0 > main.t1 - main.t0) main = notes[j]; }
        out.push({ a, b: i, held, main });
        a = i + 1;
      }
      return out;
    }
    const atDo = (x) => Math.abs(circ(x.main.cents)) < MATCH;
    const notDo = Math.abs(circ(100 * target[0])) >= MATCH; // a held answer other than Do
    // The note a listener takes for the answer: the one held longest and loudest. Do hummed first,
    // the steps hummed on the way and the walk home after are shorter or quieter than the note sung
    // out. Loudness counts by its square root, so a note twice as long beats one twice as loud.
    // When the answer is not Do, a note at Do is the learner finding the key (hummed first, or the
    // walk home ending on it), so it is passed over as long as another note was held long enough.
    function prominent(notes) {
      let cand = holdGroups(notes);
      const long = cand.filter((x) => x.held >= HOLD_MIN);
      if (long.length) cand = long; // else a held note broken into short pieces
      if (notDo && cand.some((x) => !atDo(x) && x.held >= QUAL)) cand = cand.filter((x) => !atDo(x));
      const top = cand.reduce((m, x) => Math.max(m, x.main.level), -Infinity);
      const score = cand.map((x) => Math.min(x.held, HOLD_FULL) * Math.pow(10, (x.main.level - top) / 40));
      const best = Math.max(...score);
      let k = 0;
      for (let i = 0; i < cand.length; i++) if (score[i] >= NEAR_TIE * best) k = i; // the later of a near tie
      return cand[k].main;
    }
    // Slid: the note started more than 100 cents away and took a while to arrive. The approach is
    // the moving stretch before the note at its own loudness: back to the last pitch held steady (a
    // step on the way), to where the level is 6 dB below the note (a step hummed quietly, or the
    // onset), or to where the run starts. A steady step is at least 50 cents off; a quiet one counts
    // after 0.12 s, one as loud as the note only after 0.28 s (a slide can stall as it settles).
    // On a slow timer the windows widen to hold enough frames (h: the note's hop).
    function slideOf(fin) {
      const { t, c, e } = fin.src;
      const h = fin.hop;
      const steadyAt = (k, span) => {
        span = Math.max(span, 3 * h);
        let j = k;
        while (j > 0 && t[k] - t[j - 1] <= span + 0.02) j--;
        if (k - j < Math.min(4, Math.ceil(span / h) - 1) || t[k] - t[j] < span) return null;
        const w = sorted(c, j, k + 1);
        if (quant(w, 0.85) - quant(w, 0.15) > 40 || Math.abs(slope(t, c, j, k) * (t[k] - t[j])) > 30) return null;
        return { pitch: quant(w, 0.5), level: median(e, j, k + 1) };
      };
      let s = fin.lo;
      for (; s > 0; s--) {
        if (s > 1 && e[s - 1] < fin.level - 6 && e[s - 2] < fin.level - 6) break;
        const q = steadyAt(s - 1, 0.12);
        if (q && Math.abs(q.pitch - fin.cents) > 50 && (q.level <= fin.level - 3 || steadyAt(s - 1, 0.28))) break;
      }
      if (s >= fin.lo) return false;
      const start = median(c, s, Math.min(s + 3, fin.lo));
      if (Math.abs(start - fin.cents) <= 100) return false;
      // the time spent moving (150 cents/s or more over about 0.1 s) before arriving within 35
      // cents; a moment held on the way, at a step, is not sliding
      let moving = 0;
      const w = Math.max(0.05, 1.3 * h), cap = Math.max(0.05, 1.5 * h);
      for (let k = s; k < fin.hi && Math.abs(c[k] - fin.cents) > 35; k++) {
        let a = k, b = k;
        while (a > s && t[k] - t[a - 1] <= w) a--;
        while (b < fin.hi && t[b + 1] - t[k] <= w) b++;
        if (b > a && Math.abs(slope(t, c, a, b)) >= 150) moving += Math.min(cap, t[k + 1] - t[k]);
      }
      return moving > 0.22;
    }
    // Wobble: the middle of the note swings widely once vibrato (4-7 Hz) is averaged away. Only a
    // wide, slow swing counts; an untrained voice wanders a little and is not marked down for it.
    function wobbleOf(fin) {
      const { t, c } = fin.src;
      const a = fin.t0 + 0.25, b = fin.t1 - 0.15;
      if (b - a < 0.4) return false;
      const sm = [], w = Math.max(WOB_WIN, 1.2 * fin.hop);
      let lo = fin.lo, hi = fin.lo, sum = 0, cnt = 0;
      for (let i = fin.lo; i <= fin.hi; i++) {
        while (hi <= fin.hi && t[hi] <= t[i] + w) { sum += c[hi]; cnt++; hi++; }
        while (t[lo] < t[i] - w) { sum -= c[lo]; cnt--; lo++; }
        if (t[i] >= a && t[i] <= b) sm.push(sum / cnt);
      }
      const s = Float64Array.from(sm).sort();
      return quant(s, 0.9) - quant(s, 0.1) > WOBBLE;
    }

    // The notes that count in a melody: long enough (a short note sung on its own, staccato, once
    // its scoop is trimmed may hold still only briefly), and not the room's echo far under the singing.
    function seqNotes(all) {
      const loud = all.reduce((m, x) => Math.max(m, x.level), -Infinity);
      const alone = (k) => (k === 0 || all[k].ta - all[k - 1].tf >= GAP) && (k + 1 === all.length || all[k + 1].ta - all[k].tf >= GAP);
      return all.filter((x, k) => (x.t1 - x.t0 >= SEQ_NOTE || (x.tf - x.ta >= STACCATO && alone(k))) && x.level >= loud - 20);
    }
    // A piece whose middle keeps sliding to its end, as speech, an "um" or a laugh does (a sung note
    // holds still once it has arrived, scooped or not). Left over after the melody is matched, it is
    // not counted as an extra note.
    const glides = (x) => Math.abs(x.move) >= GLIDE_CENTS && Math.abs(x.move) >= GLIDE_RATE * (x.t1 - x.t0) && x.late * Math.sign(x.move) >= GLIDE_LATE;
    function gradeSeq(all) {
      const notes = seqNotes(all), N = notes.length, M = target.length;
      const none = (reason) => ({ v: null, reason, notes: [], graded: -1, steps: target.map((w) => ({ want: w, got: null, ok: false })), extra: 0, offset: 0, drift: 0 });
      if (!N) return none(heardSec >= 0.05 ? 'short' : 'silent');
      // Notes are missing, but the learner was clearly making sound whose pitch could not be
      // followed (a loud room, a voice below the range): rather than mark down notes that were
      // probably sung, give no grade, and the app lets the learner grade themselves.
      if (M > N && unpitched(notes) >= UNCLEAR_SEC * (M - N)) return none('unclear');
      // The answer is what was sung, or that without what plainly was not part of it, whichever
      // grades higher (see answerParts).
      let best = null;
      for (const part of answerParts(notes)) {
        const g = gradeAnswer(part);
        if (!best || g.v > best.v || (g.v === best.v && g.fit.errors < best.fit.errors)) best = g;
      }
      return report(best, notes);
    }
    // What may be graded as the answer: the notes as sung; without talk or a laugh before a pause
    // (when nothing in it was at the melody's first note, so it was no false start), or without Do
    // hummed long to find the key before the melody sung from Do; and without talk or a laugh after
    // a pause (when nothing in it was at the first note either: a second try is graded, as a restart
    // or the tune sung twice; and it only counts when it helps, since a melody finished after a pause
    // needs its last notes).
    function answerParts(notes) {
      const N = notes.length, out = [notes], heads = [0], tails = [N];
      for (let k = 1; k < N; k++) {
        const gap = notes[k].ta - notes[k - 1].tf;
        if (gap >= HEAD_GAP && heads.length < 4 && headFree(notes, k)) heads.push(k);
        if (gap >= TAIL_GAP && !startsAgain(notes.slice(k), firstNote(notes.slice(0, k)))) tails.push(k);
      }
      tails.splice(1, Math.max(0, tails.length - 4)); // the last few pauses only
      for (const h of heads) for (const t of tails) if (t > h && (h > 0 || t < N)) out.push(notes.slice(h, t));
      return out;
    }
    // Where the melody's first note was sung in `part` (its first note, when that was near it), and
    // whether some note of another part holds that pitch a while: a start of the melody. A laugh or
    // a word may pass through it.
    function firstNote(part) {
      const ref = fitMelody(part, target, false).o + 100 * target[0];
      return Math.abs(circ(part[0].cents - ref)) <= HALF ? part[0].cents : ref;
    }
    const startsAgain = (part, ref) => part.some((x) => Math.abs(circ(x.cents - ref)) < MATCH && x.t1 - x.t0 >= HEAD_NOTE);
    function headFree(notes, k) {
      const rest = notes.slice(k), ref = firstNote(rest);
      const at0 = (x) => Math.abs(circ(x.cents - ref)) < MATCH;
      // no false start (which would hold the first note a while)
      if (!startsAgain(notes.slice(0, k), ref)) return true;
      // the first note (Do, for every Read pattern) hummed long and on its own, then the melody from it
      const core = (x) => x.t1 - x.t0;
      return k === 1 && at0(notes[1]) && core(notes[0]) >= REF_HOLD && core(notes[0]) >= 1.25 * median(Float64Array.from(rest, core));
    }
    // One answer's grade: { v, reason, fit (pairs index `notes` of the fit), offset }. Pieces of
    // speech the melody does not need may be left out, when that grades higher (a sung note can
    // slide too).
    function gradeAnswer(sung) {
      const g = gradeNotes(sung);
      if (!sung.some(glides)) return g;
      const f = fitMelody(sung, target, false, true);
      const drop = new Set(f.pairs.filter((p) => p.j < 0 && glides(sung[p.i])).map((p) => sung[p.i]));
      if (!drop.size || drop.size === sung.length) return g;
      const h = gradeNotes(sung.filter((x) => !drop.has(x)));
      return h.v > g.v || (h.v === g.v && h.fit.errors < g.fit.errors) ? h : g;
    }
    function gradeNotes(notes) {
      const N = notes.length, M = target.length;
      const res = (v, reason, fit, offset) => ({ v, reason, fit, offset: offset == null ? fit.o : offset });
      // A steady slide that takes the end more than DRIFT from the start: the intervals were right
      // but Do was lost on the way.
      const plain = fitMelody(notes, target, false);
      if (N === M) {
        const slide = fitMelody(notes, target, true);
        if (slide.errors === 0 && slide.fits && steady(slide)) return res(0.5, 'drift', slide);
      }
      if (plain.errors === 0) {
        // A common offset is forgiven up to OFF_MATCH. Beyond it the whole tune sat between two keys:
        // Close ('offset': every note right, the tune as a whole off), as a held note would be, and
        // past CLOSE it is the tune from the next note.
        const o = plain.oFree;
        if (Math.abs(o) <= OFF_MATCH) return res(1, 'match', plain, clamp(o, -OFF_MATCH, OFF_MATCH));
        if (Math.abs(o) > CLOSE) {
          const tr = fitMelody(notes, target.map((w) => w + Math.sign(o)), false);
          if (tr.errors === 0) return res(0, 'transposed', tr);
        }
        return res(0.5, 'offset', plain, o);
      }
      // the right tune from the wrong note: every note moved by the same number of semitones
      if (N === M) {
        for (let k = 1; k < 12; k++) {
          const tr = fitMelody(notes, target.map((w) => w + k), false);
          if (tr.errors === 0) return res(0, 'transposed', tr);
        }
      }
      const rs = restartOf(notes, plain.errors);
      if (rs) return rs.capped ? res(0.5, 'restart', rs.fit) : res(rs.fit.errors ? 0.5 : 1, rs.fit.errors ? 'close' : 'match', rs.fit);
      return res(plain.errors === 1 ? 0.5 : 0, plain.errors === 1 ? 'close' : 'notes', plain);
    }
    // A slide is steady when it does not hang on any one note: without each note in turn, the rest
    // still slide the same way by most of DRIFT (one note off at the end of a short tune is a note
    // off, not a drift; scatter of a few notes rarely lines up like that).
    function steady(fit) {
      const P = fit.pts, b = fit.trend;
      if (P.length < 3 || !(Math.abs(b) > DRIFT)) return false;
      for (let k = 0; k < P.length; k++) {
        const c = lsLine(P.filter((x, i) => i !== k), 2);
        if (!c || Math.sign(c.b) !== Math.sign(b) || Math.abs(c.b) < DRIFT_LOO) return false;
      }
      // and the notes between the ends slide too (two wrong notes at the ends, one low and one
      // high, tilt the line without the middle following)
      if (P.length >= 4) {
        const c = lsLine(P.slice(1, -1), 2);
        if (!c || Math.sign(c.b) !== Math.sign(b) || Math.abs(c.b) < DRIFT_MID * Math.abs(b)) return false;
      }
      return true;
    }
    // least-squares line through points {u, y}: mean position and pitch, and slope (from `least` points)
    function lsLine(ps, least = 3) {
      if (!ps.length) return null;
      let mx = 0, my = 0;
      for (const p of ps) { mx += p.u; my += p.y; }
      mx /= ps.length; my /= ps.length;
      let sxy = 0, sxx = 0;
      for (const p of ps) { sxy += (p.u - mx) * (p.y - my); sxx += (p.u - mx) * (p.u - mx); }
      return { mx, my, b: ps.length >= least && sxx > 1e-9 ? sxy / sxx : 0 };
    }
    // The steps, the extra notes and the sung notes, as the grade sees them. A note 50-75 cents off
    // counts as half an error, so a single one is not marked wrong (it is `near`, and its `off`
    // says which way); two or more are marked in pairs, worst first, as they count.
    function report(g, all) {
      const { fit } = g, ns = fit.notes;
      const right = (p) => fit.tg[p.j] === target[p.j];
      const half = fit.pairs.filter((p) => p.i >= 0 && p.j >= 0 && right(p) && Math.abs(p.off) >= MATCH && Math.abs(p.off) <= HALF);
      half.sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
      const marked = new Set(half.slice(0, 2 * Math.floor(half.length / 2)));
      const steps = [], seen = new Map();
      let extra = 0;
      for (const p of fit.pairs) {
        if (p.j < 0) { extra++; continue; }
        const w = target[p.j];
        if (p.i < 0) { steps.push({ want: w, got: null, ok: false }); continue; }
        const a = Math.abs(p.off);
        const ok = right(p) && (a < MATCH || (a <= HALF && !marked.has(p)));
        const st = { want: w, got: ok ? w : fit.tg[p.j] + Math.round(p.off / 100), ok };
        if (ok && a >= MATCH) st.near = true;
        steps.push(st);
        seen.set(ns[p.i], { ok, off: p.off });
      }
      const sung = all.map((x) => {
        const q = seen.get(x);
        let off = q ? q.off : Infinity;
        if (!q) for (const w of target) { const dd = circ(x.cents - fit.o - 100 * w); if (Math.abs(dd) < Math.abs(off)) off = dd; }
        return { t0: x.t0, t1: x.t1, cents: x.cents, semi: Math.round(x.cents / 100), off, ok: q ? q.ok : false, clarity: x.clarity };
      });
      return { v: g.v, reason: g.reason, notes: sung, graded: -1, steps, extra, offset: Math.round(g.offset), drift: g.reason === 'drift' ? Math.round(fit.trend) : 0 };
    }
    // The best common offset for singing `notes` as the melody `tg` (and, when `sloped`, a steady
    // slide from the first note to the last, D cents end to start), then the edit distance under it.
    // The search is soft: a note's cost grows with its distance from the target and stops growing
    // 30 cents out, so a wrong note cannot pull the fit toward itself. Then least squares on the
    // notes it fits. `fits`: no note sits more than DRIFT_FIT off the fitted line; `trend`: the slide
    // the notes show under the fit, end to start, through `pts`; `oFree`: the common offset the notes
    // show, unclamped. With `freeGlide`, a gliding piece left over costs nothing.
    function fitMelody(notes, tg, sloped, freeGlide) {
      const N = notes.length;
      // A slide of more than DRIFT_STEP a note makes the intervals wrong, and two wrong notes at the
      // ends, one low and one high, would pass for one. A slide starts (or ends) within the common
      // offset forgiven, so the line may sit up to half the slide further out.
      const Dmax = sloped && N >= 3 ? DRIFT_STEP * (N - 1) : 0;
      const span = (d) => 50 + Math.abs(d) / 2;
      let o = 0, D = 0, soft = Infinity;
      const at = (x, d) => {
        const cost = align(notes, tg, x, d, true, freeGlide).cost;
        if (cost < soft - 1e-9 || (cost < soft + 1e-9 && Math.abs(x) + Math.abs(d) < Math.abs(o) + Math.abs(D))) { soft = cost; o = x; D = d; }
      };
      for (let x = -50; x <= 50; x += 2) at(x, 0);
      if (Dmax) {
        // slides on a coarse grid (a note's cost is smooth over 30 cents), then around the best
        for (let d = 20; d <= Dmax; d += 20) for (const sd of [d, -d]) for (let x = -span(sd); x <= span(sd); x += 6) at(x, sd);
        const o0 = o, D0 = D;
        for (let d = D0 - 10; d <= D0 + 10; d += 10) if (d && Math.abs(d) <= Dmax) for (let x = o0 - 4; x <= o0 + 4; x += 2) if (Math.abs(x) <= span(d)) at(x, d);
      }
      const u = (i) => (N > 1 ? i / (N - 1) - 0.5 : 0);
      // the notes matched under (o, D), as positions u and pitches y from the melody's notes
      const pointsOf = (pairs) => pairs.filter((p) => p.i >= 0 && p.j >= 0 && Math.abs(p.off) <= MATCH).map((p) => ({ u: u(p.i), y: o + D * u(p.i) + p.off }));
      for (let it = 0; it < 3; it++) {
        const l = lsLine(pointsOf(align(notes, tg, o, D, true, freeGlide).pairs));
        if (!l) break;
        if (Dmax) D = clamp(l.b, -Dmax, Dmax);
        o = clamp(l.my - D * l.mx, -span(D), span(D));
      }
      const best = align(notes, tg, o, D, false, freeGlide);
      let worst = 0;
      for (const p of best.pairs) if (p.i >= 0 && p.j >= 0) worst = Math.max(worst, Math.abs(p.off));
      const pts = pointsOf(best.pairs), l = lsLine(pts);
      return { o, D, tg, notes, pairs: best.pairs, errors: Math.floor(best.cost + 1e-9), fits: worst <= DRIFT_FIT, trend: l ? l.b : 0, pts, oFree: l ? l.my - l.b * l.mx : o };
    }
    // A restart: the start of the melody, a stop, then the melody again from its first note, or
    // from a later note the false start had reached and gone past (backing up). The last attempt is graded, at
    // most Close. One note before it is a false start only after a pause; without one it is an extra
    // note. A first attempt that was the whole melody, as good as the last, is no false start: the
    // tune was simply sung twice.
    function restartOf(notes, errors0) {
      const N = notes.length, M = target.length;
      let best = null;
      for (let k = 1; k < N; k++) {
        const paused = notes[k].ta - notes[k - 1].tf >= RESTART_GAP, B = notes.slice(k);
        for (let j = 0; j < Math.min(k, M); j++) {
          // (backing up by one note is that note sung twice: an extra note, not a restart)
          if (B.length < M - j - 1 || B.length > M - j + 1 || ((j > 0 || k === 1) && !paused) || (j > 0 && k - j < 2)) continue;
          const C = j ? notes.slice(0, j).concat(B) : B;
          const fit = fitMelody(C, target, false);
          if (fit.errors > 1 || fit.errors >= errors0) continue;
          const at = (x, w) => Math.abs(circ(x.cents - fit.o - 100 * w)) <= HALF;
          // the false start began the melody; the last attempt starts where it says, on the note
          // the false start sang there
          if (!at(notes[0], target[0]) || !at(notes[k], target[j]) || !(Math.abs(circ(notes[k].cents - notes[j].cents)) < MATCH) || !fit.pairs.some((p) => p.i === j && p.j === j)) continue;
          // backing up: the false start had sung the melody that far
          if (j && align(notes.slice(0, k), target.slice(0, k), fit.o, 0, false).cost > 0.5) continue;
          const first = !j && k >= M - 1 ? fitMelody(notes.slice(0, k), target, false) : null;
          const capped = !(first && first.errors <= fit.errors);
          // the latest attempt of the fewest errors, and a tune sung twice before a false start
          if (!best || fit.errors < best.fit.errors || (fit.errors === best.fit.errors && (best.capped || !capped))) best = { k, fit, capped };
        }
      }
      return best;
    }
    // Seconds of sound around the notes, nearly as loud as they are and well over the room, that
    // was not voice and not the app's tail, in stretches at least as long as a note (consonants
    // between notes are shorter).
    function unpitched(notes) {
      const ref = median(Float64Array.from(notes, (x) => x.level));
      const a = notes[0].t0 - 1, b = notes[notes.length - 1].t1 + 1, cap = Math.max(0.05, 1.5 * hop);
      let sum = 0, run = 0;
      for (let i = 1; i <= n; i++) {
        const loud = i < n && fT[i] >= a && fT[i] <= b && fV[i] !== 1 && !fA[i] && fE[i] >= ref - 9 && fE[i] >= fF[i] + 6;
        if (loud) run += Math.min(cap, fT[i] - fT[i - 1]);
        else { if (run >= SEQ_NOTE) sum += run; run = 0; }
      }
      return sum;
    }
    // Edit distance between sung pitch classes and the melody tg, under an offset o and a slide D:
    // a wrong, missing or extra note costs 1; a note MATCH-HALF cents off costs half. `smooth`
    // grades the cost by distance instead. With `freeGlide`, a gliding piece left out costs nothing.
    function align(notes, tg, o, D, smooth, freeGlide) {
      const N = notes.length, M = tg.length;
      const offAt = (i, j) => circ(notes[i].cents - o - D * (N > 1 ? i / (N - 1) - 0.5 : 0) - 100 * tg[j]);
      const subCost = smooth
        ? (x) => Math.min(1, (x / 30) * (x / 30))
        : (x) => (Math.abs(x) < MATCH ? 0 : Math.abs(x) <= HALF ? 0.5 : 1);
      const ins = (i) => (freeGlide && glides(notes[i]) ? 0 : 1);
      const Dm = [];
      for (let i = 0; i <= N; i++) { Dm.push(new Float64Array(M + 1)); Dm[i][0] = i ? Dm[i - 1][0] + ins(i - 1) : 0; }
      for (let j = 0; j <= M; j++) Dm[0][j] = j;
      for (let i = 1; i <= N; i++) for (let j = 1; j <= M; j++) {
        Dm[i][j] = Math.min(Dm[i - 1][j] + ins(i - 1), Dm[i][j - 1] + 1, Dm[i - 1][j - 1] + subCost(offAt(i - 1, j - 1)));
      }
      const pairs = [];
      for (let i = N, j = M; i > 0 || j > 0;) {
        if (i > 0 && j > 0 && Dm[i][j] === Dm[i - 1][j - 1] + subCost(offAt(i - 1, j - 1))) { pairs.push({ i: i - 1, j: j - 1, off: offAt(i - 1, j - 1) }); i--; j--; }
        else if (i > 0 && Dm[i][j] === Dm[i - 1][j] + ins(i - 1)) { pairs.push({ i: i - 1, j: -1 }); i--; }
        else { pairs.push({ i: -1, j: j - 1 }); j--; }
      }
      pairs.reverse();
      return { cost: Dm[N][M], pairs };
    }

    // Up to 400 points over the singing, drawn from the runs' cleaned tracks (slips folded, octave
    // settled); null where there was no voice. They span the first run to the last (at most the last
    // TRACE_SPAN of it), so they stay close enough together for the app to draw a line through.
    function trace() {
      if (!n) return [];
      allNotes();
      const runs = closedRuns.concat(cacheRuns);
      if (!runs.length) return [];
      const lastRun = runs[runs.length - 1];
      const t1 = lastRun.t[lastRun.t.length - 1] + 0.3, t0 = Math.max(runs[0].t[0] - 0.3, t1 - TRACE_SPAN);
      const N = clamp(Math.ceil((t1 - t0) / 0.02) + 1, 2, 400), dt = (t1 - t0) / (N - 1);
      const out = [];
      for (let i = 0, r = 0, k = 0; i < N; i++) {
        const t = t0 + i * dt;
        while (r < runs.length && runs[r].t[runs[r].t.length - 1] < t - 0.05) { r++; k = 0; }
        let cents = null;
        if (r < runs.length && runs[r].t[0] <= t + 0.05) {
          const R = runs[r];
          while (k + 1 < R.t.length && R.t[k + 1] <= t) k++;
          const j = k + 1 < R.t.length && R.t[k + 1] - t < t - R.t[k] ? k + 1 : k;
          if (Math.abs(R.t[j] - t) <= 0.05) cents = Math.round(R.c[j]);
        }
        out.push({ t, cents });
      }
      return out;
    }

    return { push, reset, status, result };
  }

  TL.Pitch = { detect, listener, version: VERSION };
  if (typeof module !== 'undefined') module.exports = TL.Pitch;
})(typeof window !== 'undefined' ? window : globalThis);
