/* Tone Ladder — a saved Sing answer ("take"): its sound as a WAV file, with what is needed to hear
   it again exactly as the app did. The details travel inside the WAV as JSON in a 'tlmd' chunk,
   which audio players skip, so the file still plays anywhere. The same code reads takes back in
   tone-ladder/pitch-harness/takes.js, so a misgraded answer becomes a test case for js/pitch.js. */
(function (g) {
  const TL = g.TL || (g.TL = {});
  const FORMAT = 2; // 2: gaps, and the 'g' tick where the app graded

  const ascii = (v, o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  const utf8 = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8')));
  const unutf8 = (b) => (typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(b) : Buffer.from(b).toString('utf8'));

  // 16-bit mono PCM at the take's own sample rate: the detector is checked at the rate it ran at.
  function encode(samples, rate, meta) {
    const json = utf8(JSON.stringify({ format: FORMAT, ...meta }));
    const pcm = samples.length * 2, pad = json.length & 1;
    const size = 12 + 24 + (8 + json.length + pad) + (8 + pcm);
    const out = new Uint8Array(size), v = new DataView(out.buffer);
    ascii(v, 0, 'RIFF'); v.setUint32(4, size - 8, true); ascii(v, 8, 'WAVE');
    ascii(v, 12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    let o = 36;
    ascii(v, o, 'tlmd'); v.setUint32(o + 4, json.length, true); out.set(json, o + 8); o += 8 + json.length + pad;
    ascii(v, o, 'data'); v.setUint32(o + 4, pcm, true); o += 8;
    for (let i = 0; i < samples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i] || 0));
      v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
    }
    return out;
  }

  function decode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    let rate = 0, bits = 0, channels = 1, meta = null, samples = null;
    for (let o = 12; o + 8 <= b.length;) {
      const id = tag(o), len = v.getUint32(o + 4, true), at = o + 8;
      if (id === 'fmt ') { channels = v.getUint16(at + 2, true); rate = v.getUint32(at + 4, true); bits = v.getUint16(at + 14, true); }
      else if (id === 'tlmd') meta = JSON.parse(unutf8(b.subarray(at, at + len)));
      else if (id === 'data') {
        if (bits !== 16) throw new Error('only 16-bit takes are read');
        const n = Math.floor(len / 2 / channels);
        samples = new Float32Array(n);
        for (let i = 0; i < n; i++) samples[i] = v.getInt16(at + i * 2 * channels, true) / 32768;
      }
      o = at + len + (len & 1);
    }
    if (!samples || !rate) throw new Error('no sound in this WAV file');
    return { rate, samples, meta: meta || {} };
  }

  // Hear a take again the way the app did: the same frames, ending at the same moments, with the
  // same playing flags and resets. P is TL.Pitch. Ticks: [seconds into the take, playing, event],
  // the event 'r' for a reset and 'g' where the app took its grade. `result` is the grade at the
  // last 'g' (what the learner was judging), `final` the listener's state at the end, `doneAt`
  // when it would have finished (seconds into the take, or null).
  function replay(P, take) {
    const { rate, samples, meta } = take;
    const q = meta.question || {};
    const L = P.listener({ sampleRate: rate, doMidi: q.doMidi, kind: q.kind, target: q.target });
    const size = meta.fftSize || 2048, frame = new Float32Array(size);
    // a stretch with the mic closed was cut down when the take was saved: time to sample index
    const gaps = meta.gaps || [];
    const index = (f) => { let s = f; for (const [at, len] of gaps) s -= f >= at + len ? len : f > at ? f - at : 0; return s; };
    let doneAt = null, graded = null;
    for (const [t, playing, ev] of meta.ticks || []) {
      if (ev === 'r') { L.reset(); continue; }
      if (ev === 'g') { graded = L.result(); continue; }
      const end = index(Math.round(t * rate));
      frame.fill(0);
      const a = Math.max(0, end - size), z = Math.min(samples.length, end);
      if (z > a) frame.set(samples.subarray(a, z), size - (end - a));
      L.push(frame, t, { appPlaying: !!playing });
      if (doneAt == null && L.status(t).done) doneAt = t;
    }
    const final = L.result();
    return { result: graded || final, final, doneAt };
  }

  TL.Take = { FORMAT, encode, decode, replay };
  if (typeof module !== 'undefined') module.exports = TL.Take;
})(typeof window !== 'undefined' ? window : globalThis);
