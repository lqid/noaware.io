/* Tone Ladder — your music: what the page needs to work on a recording of the learner's own. A
   player that keeps the file streaming through one audio element, an analysis that turns the sound
   into a chroma picture so Find Do can answer for any stretch at once, and a small per-device store
   of what was marked on each file: its key, loop, speed and chord marks. The file itself is never
   stored or sent. */
(function (g) {
  const TL = g.TL || (g.TL = {});

  // ---------- the analysis ----------
  // The sound is decoded at a low rate in a throwaway offline context (a five-minute song is then
  // a few megabytes, and a 4096-point frame tells semitones apart down to the bass), and read once:
  // for each frame, how much of each pitch class sounds, counting only spectral peaks and weighting
  // high partials down, so fundamentals and low partials carry the vote; and the picture's peaks.
  // Find Do over any stretch is then a sum of frames and a correlation with the key profiles.
  const N = 4096, HOP = 2048, RATE = 11025;
  // Temperley's revision of the Krumhansl-Kessler profiles: it leans on the leading tone, which
  // is what tells a key from its relative
  const PROFILES = {
    major: [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4],
    minor: [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4],
  };
  let hann = null, rev = null;
  function tables() {
    if (hann) return;
    hann = new Float32Array(N);
    for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    rev = new Uint16Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  }
  // in-place radix-2 FFT of re/im (length N)
  function fft(re, im) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2, step = (-2 * Math.PI) / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const a = step * k, wr = Math.cos(a), wi = Math.sin(a);
          const i = start + k, j = i + half;
          const tr = re[j] * wr - im[j] * wi, ti = re[j] * wi + im[j] * wr;
          re[j] = re[i] - tr; im[j] = im[i] - ti; re[i] += tr; im[i] += ti;
        }
      }
    }
  }
  const correlate = (x, y) => {
    let mx = 0, my = 0;
    for (let i = 0; i < 12; i++) { mx += x[i]; my += y[i]; }
    mx /= 12; my /= 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) { const a = x[i] - mx, b = y[i] - my; num += a * b; dx += a * a; dy += b * b; }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  };
  function keysFor(chroma) {
    const out = [];
    for (let pc = 0; pc < 12; pc++) {
      const rot = (p) => Array.from({ length: 12 }, (_, i) => p[(i - pc + 12) % 12]);
      out.push({ pc, mode: 'major', score: correlate(chroma, rot(PROFILES.major)) });
      out.push({ pc, mode: 'minor', score: correlate(chroma, rot(PROFILES.minor)) });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  // the file to mono at the analysis rate; the bytes are read again for each try, since decoding
  // takes the buffer away, and one copy at a time is all a phone has room for
  async function decode(file) {
    const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext;
    let buf = null;
    for (const rate of [RATE, 16000, 44100]) {
      try { buf = await new OAC(1, 1, rate).decodeAudioData(await file.arrayBuffer()); break; } catch (e) { buf = null; }
    }
    if (!buf) throw new Error('This browser cannot read this file. Try an MP3 or M4A.');
    const ch = buf.numberOfChannels, n = buf.length, data = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const x = buf.getChannelData(c); for (let i = 0; i < n; i++) data[i] += x[i] / ch; }
    return { data, sampleRate: buf.sampleRate };
  }
  // src: { data: Float32Array (mono), sampleRate }. One pass: a chroma vector per frame and the
  // overview's peaks. The work yields to the page every few milliseconds, and stops when asked.
  async function analyse(src, { onProgress, cancelled = () => false, columns = 1000 } = {}) {
    tables();
    const sr = src.sampleRate, d = src.data;
    const count = Math.max(0, Math.floor((d.length - N) / HOP) + 1);
    const frames = new Float32Array(12 * count);
    const peaks = new Float32Array(columns * 2);
    const per = d.length / columns;
    for (let c = 0; c < columns; c++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(c * per), e = Math.min(d.length, Math.floor((c + 1) * per)); i < e; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
      peaks[2 * c] = lo; peaks[2 * c + 1] = hi;
    }
    const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
    const kLo = Math.max(2, Math.floor((55 * N) / sr)), kHi = Math.min(N / 2 - 2, Math.ceil((2000 * N) / sr));
    const pcOf = new Int8Array(N / 2), wOf = new Float32Array(N / 2);
    for (let k = kLo; k <= kHi; k++) {
      const f = (k * sr) / N, midi = 69 + 12 * Math.log2(f / 440);
      pcOf[k] = ((Math.round(midi) % 12) + 12) % 12;
      wOf[k] = f < 220 ? 1 : 1 / (1 + 0.6 * Math.log2(f / 220) ** 2);
    }
    const clock = () => (g.performance ? g.performance.now() : Date.now());
    let since = clock();
    for (let f = 0; f < count; f++) {
      const pos = f * HOP;
      for (let i = 0; i < N; i++) { re[i] = d[pos + i] * hann[i]; im[i] = 0; }
      fft(re, im);
      for (let k = kLo - 1; k <= kHi + 1; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const at = 12 * f;
      for (let k = kLo; k <= kHi; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) frames[at + pcOf[k]] += mag[k] * wOf[k];
      if (clock() - since > 8) {
        if (onProgress) onProgress((f + 1) / count);
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled()) return null;
        since = clock();
      }
    }
    return { frames, count, hop: HOP / sr, peaks, columns, duration: d.length / sr, sampleRate: sr };
  }
  // Find Do over a stretch of an analysis, at once
  function keysOver(an, from = 0, to = Infinity) {
    const f0 = Math.max(0, Math.floor(from / an.hop)), f1 = Math.max(f0, Math.min(an.count, Math.ceil(to / an.hop)));
    const c = new Array(12).fill(0);
    for (let f = f0; f < f1; f++) for (let p = 0; p < 12; p++) c[p] += an.frames[12 * f + p];
    const peak = Math.max(...c) || 1;
    const chroma = c.map((v) => v / peak);
    const keys = keysFor(chroma);
    return { chroma, keys, frames: f1 - f0, confidence: keys.length > 1 ? Math.max(0, keys[0].score - keys[1].score) : 0 };
  }

  // ---------- the player ----------
  // One audio element, never inside the page's rendered view: the page re-renders its views whole,
  // and the element would die with them. The browser does the slowing without changing the pitch.
  // A loop is kept by a timer aimed at its end, which runs on while the tab is hidden or the phone
  // locked, as the music does; a short gap at the jump is the price of streaming the file instead
  // of holding it in memory.
  function makePlayer() {
    const el = g.document ? g.document.createElement('audio') : null;
    const st = { file: null, name: '', size: 0, duration: 0, time: 0, playing: false, loop: null, rate: 1, error: '', url: '' };
    let timer = null, onChange = null, opening = null;
    const emit = () => { if (onChange) onChange(st); };
    const arm = () => {
      clearTimeout(timer); timer = null;
      if (!st.loop || !el || el.paused) return;
      const ms = ((st.loop[1] - el.currentTime) / (el.playbackRate || 1)) * 1000 - 10;
      timer = setTimeout(check, Math.max(0, ms));
    };
    const check = () => {
      clearTimeout(timer); timer = null;
      if (!st.loop || el.paused) return;
      if (el.seeking) { arm(); return; }
      if (el.currentTime >= st.loop[1] - 0.005) el.currentTime = st.loop[0];
      arm();
    };
    if (el) {
      el.preload = 'metadata';
      try { el.preservesPitch = true; el.mozPreservesPitch = true; } catch (e) { /* older engines */ }
      el.addEventListener('loadedmetadata', () => { st.duration = el.duration || 0; emit(); });
      el.addEventListener('play', () => { st.playing = true; arm(); emit(); });
      el.addEventListener('pause', () => { st.playing = false; clearTimeout(timer); timer = null; emit(); });
      el.addEventListener('ended', () => { st.playing = false; emit(); });
      el.addEventListener('timeupdate', () => { st.time = el.currentTime; if (st.loop && st.playing && !el.seeking && el.currentTime >= st.loop[1]) check(); emit(); });
      el.addEventListener('seeked', () => { st.time = el.currentTime; arm(); emit(); });
      el.addEventListener('ratechange', () => { st.rate = el.playbackRate; arm(); emit(); });
      el.addEventListener('error', () => { st.error = 'This browser cannot play this file. Try an MP3 or M4A.'; st.playing = false; emit(); });
    }
    const P = {
      state: () => st,
      set onChange(fn) { onChange = fn; },
      get time() { return el ? el.currentTime : 0; },
      open(file) {
        P.close();
        if (opening) opening(); // the previous open, still waiting for its metadata, is over
        Object.assign(st, { file, name: file.name, size: file.size, url: URL.createObjectURL(file) });
        el.src = st.url;
        el.load();
        emit();
        return new Promise((res) => {
          const done = () => { el.removeEventListener('loadedmetadata', done); el.removeEventListener('error', done); if (opening === done) opening = null; res(st); };
          opening = done;
          el.addEventListener('loadedmetadata', done); el.addEventListener('error', done);
        });
      },
      close() {
        if (!el || !st.file) return;
        try { el.pause(); } catch (e) { /* nothing was playing */ }
        el.removeAttribute('src'); el.load();
        if (st.url) URL.revokeObjectURL(st.url);
        clearTimeout(timer); timer = null;
        Object.assign(st, { file: null, name: '', size: 0, duration: 0, time: 0, playing: false, loop: null, error: '', url: '' });
        emit();
      },
      play() {
        if (!el || !st.file) return Promise.resolve();
        if (st.loop && (el.currentTime < st.loop[0] || el.currentTime >= st.loop[1] - 0.005)) el.currentTime = st.loop[0];
        return el.play().catch(() => { st.error = 'The browser did not let the music play. Press Play again.'; emit(); });
      },
      pause() { if (el) el.pause(); },
      toggle() { return el && el.paused ? P.play() : (P.pause(), Promise.resolve()); },
      seek(t) { if (!el || !st.file) return; el.currentTime = Math.max(0, Math.min(st.duration || 0, t)); st.time = el.currentTime; emit(); },
      setLoop(a, b) {
        if (a == null || b == null) st.loop = null;
        else { a = Math.max(0, Math.min(a, b)); b = Math.max(a + 0.25, Math.min(st.duration || b, b)); st.loop = [a, b]; }
        arm(); emit();
      },
      setRate(r) { r = Math.max(0.5, Math.min(1, r)); if (el) el.playbackRate = r; st.rate = r; emit(); },
    };
    return P;
  }

  // ---------- what was marked on each file ----------
  // Kept on this device only, keyed by the file's name, size and length, most recent first.
  const KEY = 'tone-ladder-v1-music', MAX_FILES = 50, MAX_MARKS = 300;
  const MODES = ['major', 'minor'];
  const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  function cleanEntry(e) {
    if (!e || typeof e !== 'object' || typeof e.fp !== 'string') return null;
    const key = e.key && num(e.key.pc, 0, 11) != null && MODES.includes(e.key.mode) ? { pc: e.key.pc, mode: e.key.mode } : null;
    const loop = Array.isArray(e.loop) && num(e.loop[0], 0, 1e6) != null && num(e.loop[1], 0, 1e6) != null && e.loop[1] > e.loop[0] ? [e.loop[0], e.loop[1]] : null;
    const marks = (Array.isArray(e.marks) ? e.marks : []).map((m) => (m && num(m.t, 0, 1e6) != null ? { t: m.t, bass: str(m.bass, 4), rn: str(m.rn, 12), note: str(m.note, 80) } : null)).filter(Boolean).sort((a, b) => a.t - b.t).slice(0, MAX_MARKS);
    const drone = num(e.drone, 0, 3);
    return { fp: e.fp.slice(0, 200), name: str(e.name, 120), dur: num(e.dur, 0, 1e6) || 0, key, loop, speed: num(e.speed, 0.5, 1) || 1, drone: drone == null ? 1 : drone, marks, at: num(e.at, 0, 1e13) || 0 };
  }
  function readAll() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY));
      return (o && Array.isArray(o.files) ? o.files : []).map(cleanEntry).filter(Boolean);
    } catch (e) { return []; }
  }
  function writeAll(files) {
    try { localStorage.setItem(KEY, JSON.stringify({ files: files.slice(0, MAX_FILES) })); } catch (e) { /* storage blocked: the marks live for the visit */ }
  }
  const fingerprint = (file, dur) => `${file.name}|${file.size}|${Math.round((dur || 0) * 10)}`;
  const files = {
    get(fp) { return readAll().find((f) => f.fp === fp) || null; },
    put(fp, patch) {
      const all = readAll().filter((f) => f.fp !== fp);
      const cur = cleanEntry({ ...(files.get(fp) || { fp, marks: [] }), ...patch, fp, at: Date.now() });
      all.unshift(cur);
      writeAll(all);
      return cur;
    },
    forget(fp) { writeAll(readAll().filter((f) => f.fp !== fp)); },
    recent() { return readAll(); },
  };
  const mmss = (t) => { const tenths = Math.round(Math.max(0, t || 0) * 10); const m = Math.floor(tenths / 600), s = Math.floor((tenths % 600) / 10); return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`; };
  const marksText = (entry) => (entry.marks || []).map((m) => `${mmss(m.t)} ${m.rn || '?'}${m.bass ? ' on ' + m.bass : ''}${m.note ? ' · ' + m.note : ''}`).join('\n');

  TL.Music = { decode, analyse, keysOver, keysFor, PROFILES, RATE, makePlayer, player: makePlayer(), files, fingerprint, mmss, marksText, KEY };
  if (typeof module !== 'undefined') module.exports = TL.Music;
})(typeof window !== 'undefined' ? window : globalThis);
