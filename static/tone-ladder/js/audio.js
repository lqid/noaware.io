/* Tone Ladder — audio engine. All sound is synthesized with Web Audio:
   piano, electric piano, strings, organ and a pure tone, plus metronome clicks,
   a rhythm voice and a tonic drone. */
(function (g) {
  const TL = g.TL || (g.TL = {});
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  let ctx = null, bus = null, master = null;
  let groups = new Set();
  let drone = null;
  const waveCache = new WeakMap();
  const noiseCache = new WeakMap();
  const cfg = { volume: 0.8, timbre: 'piano', speed: 1 };

  const TIMBRES = {
    piano: 'Piano',
    epiano: 'Electric piano',
    strings: 'Strings',
    organ: 'Organ',
    pure: 'Pure tone',
  };

  function waves(ac) {
    let w = waveCache.get(ac);
    if (w) return w;
    const make = (amps) => {
      const real = new Float32Array(amps.length + 1);
      const imag = new Float32Array(amps.length + 1);
      amps.forEach((a, i) => (imag[i + 1] = a));
      return ac.createPeriodicWave(real, imag);
    };
    w = {
      piano: make([1, 0.62, 0.42, 0.3, 0.2, 0.14, 0.1, 0.075, 0.055, 0.04, 0.03, 0.022, 0.016, 0.012, 0.008, 0.006]),
      organ: make([1, 0.72, 0.42, 0.33, 0, 0.18, 0, 0.13]),
      pure: make([1, 0.06, 0.015]),
    };
    waveCache.set(ac, w);
    return w;
  }
  function noise(ac) {
    let b = noiseCache.get(ac);
    if (b) return b;
    b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, b);
    return b;
  }
  function impulse(ac, seconds, decay) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - i / len, decay) * (i < ac.sampleRate * 0.008 ? i / (ac.sampleRate * 0.008) : 1);
      }
    }
    return buf;
  }
  // Lower notes sound quieter at equal amplitude; nudge them up.
  const loud = (m) => clamp(1 + (60 - m) * 0.012, 0.72, 1.35);

  function buildChain(ac, dest) {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    const out = ac.createGain();
    const b = ac.createGain();
    const dry = ac.createGain(); dry.gain.value = 0.9;
    const wet = ac.createGain(); wet.gain.value = 0.16;
    const rev = ac.createConvolver(); rev.buffer = impulse(ac, 2.0, 2.8);
    b.connect(dry).connect(comp);
    b.connect(rev).connect(wet).connect(comp);
    comp.connect(out).connect(dest);
    return { bus: b, master: out };
  }

  // ---------- voices ----------
  function pianoVoice(ac, dest, m, t, dur, vel) {
    const f = TL.mtof(m);
    const out = ac.createGain(); out.gain.value = 0; out.connect(dest);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.35; lp.connect(out);
    lp.frequency.setValueAtTime(Math.min(16000, f * (5 + 7 * vel) + 1200), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(8000, f * 2.2 + 420), t + 0.8 + dur * 0.4);
    const w = waves(ac).piano;
    const oscs = [1.6, -1.6].map((det) => {
      const o = ac.createOscillator(); o.setPeriodicWave(w); o.frequency.value = f; o.detune.value = det; o.connect(lp); return o;
    });
    const peak = 0.2 * vel * loud(m);
    const decay = clamp(3.4 - (m - 40) * 0.05, 0.6, 4.2);
    const gn = out.gain;
    gn.setValueAtTime(0.0001, t);
    gn.exponentialRampToValueAtTime(peak, t + 0.004);
    gn.setTargetAtTime(peak * 0.42, t + 0.004, 0.1);
    if (dur > 0.28) gn.setTargetAtTime(0.0001, t + 0.28, decay * 0.55);
    const rel = m < 50 ? 0.22 : 0.13;
    gn.setTargetAtTime(0.0001, t + dur, rel / 3);
    const stopAt = t + dur + rel * 2.5 + 0.05;
    oscs.forEach((o) => { o.start(t); o.stop(stopAt); });
    // hammer
    const n = ac.createBufferSource(); n.buffer = noise(ac);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(7000, f * 3 + 500); bp.Q.value = 0.9;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(peak * 0.18, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    n.connect(bp).connect(ng).connect(dest);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.05);
    return stopAt;
  }

  function epianoVoice(ac, dest, m, t, dur, vel) {
    const f = TL.mtof(m);
    const out = ac.createGain(); out.gain.value = 0; out.connect(dest);
    const car = ac.createOscillator(); car.frequency.value = f;
    const mod = ac.createOscillator(); mod.frequency.value = f;
    const mg = ac.createGain();
    mg.gain.setValueAtTime(f * (2.2 + vel * 1.8), t);
    mg.gain.setTargetAtTime(f * 0.35, t, 0.22);
    mod.connect(mg).connect(car.frequency);
    const tine = ac.createOscillator(); tine.frequency.value = f * 14;
    const tg = ac.createGain();
    tg.gain.setValueAtTime(f * 0.9, t); tg.gain.setTargetAtTime(0, t, 0.02);
    tine.connect(tg).connect(car.frequency);
    car.connect(out);
    const peak = 0.2 * vel * loud(m);
    const gn = out.gain;
    gn.setValueAtTime(0.0001, t);
    gn.exponentialRampToValueAtTime(peak, t + 0.004);
    gn.setTargetAtTime(peak * 0.5, t + 0.004, 0.25);
    if (dur > 0.5) gn.setTargetAtTime(0.0001, t + 0.5, 1.4);
    gn.setTargetAtTime(0.0001, t + dur, 0.06);
    const stopAt = t + dur + 0.4;
    [car, mod, tine].forEach((o) => { o.start(t); o.stop(stopAt); });
    return stopAt;
  }

  function stringsVoice(ac, dest, m, t, dur, vel) {
    const f = TL.mtof(m);
    const out = ac.createGain(); out.gain.value = 0; out.connect(dest);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.value = Math.min(5500, f * 5 + 300); lp.connect(out);
    const lfo = ac.createOscillator(); lfo.frequency.value = 5.1;
    const lg = ac.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(5, t + 0.6);
    lfo.connect(lg);
    const oscs = [-8, 0, 7].map((det) => {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      lg.connect(o.detune); o.connect(lp); return o;
    });
    const peak = 0.075 * vel * loud(m);
    const atk = clamp(dur * 0.25, 0.04, 0.14);
    const gn = out.gain;
    gn.setValueAtTime(0, t);
    gn.linearRampToValueAtTime(peak, t + atk);
    gn.setTargetAtTime(peak * 0.82, t + atk, 0.3);
    gn.setTargetAtTime(0, t + dur, 0.12);
    const stopAt = t + dur + 0.6;
    [...oscs, lfo].forEach((o) => { o.start(t); o.stop(stopAt); });
    return stopAt;
  }

  function organVoice(ac, dest, m, t, dur, vel) {
    const f = TL.mtof(m);
    const out = ac.createGain(); out.gain.value = 0; out.connect(dest);
    const o = ac.createOscillator(); o.setPeriodicWave(waves(ac).organ); o.frequency.value = f; o.connect(out);
    const peak = 0.13 * vel * loud(m);
    const gn = out.gain;
    gn.setValueAtTime(0, t);
    gn.linearRampToValueAtTime(peak, t + 0.012);
    gn.setValueAtTime(peak, t + dur);
    gn.linearRampToValueAtTime(0, t + dur + 0.07);
    const stopAt = t + dur + 0.1;
    o.start(t); o.stop(stopAt);
    return stopAt;
  }

  function pureVoice(ac, dest, m, t, dur, vel) {
    const f = TL.mtof(m);
    const out = ac.createGain(); out.gain.value = 0; out.connect(dest);
    const o = ac.createOscillator(); o.setPeriodicWave(waves(ac).pure); o.frequency.value = f; o.connect(out);
    const peak = 0.26 * vel * loud(m);
    const gn = out.gain;
    gn.setValueAtTime(0, t);
    gn.linearRampToValueAtTime(peak, t + 0.018);
    gn.setTargetAtTime(peak * 0.8, t + 0.02, 0.4);
    gn.setTargetAtTime(0, t + dur, 0.04);
    const stopAt = t + dur + 0.25;
    o.start(t); o.stop(stopAt);
    return stopAt;
  }

  function clickVoice(ac, dest, t, accent, vel = 1) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = accent ? 2350 : 1650;
    const gn = ac.createGain(); gn.gain.value = 0;
    const peak = (accent ? 0.34 : 0.22) * vel;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(gn).connect(dest);
    o.start(t); o.stop(t + 0.05);
    return t + 0.05;
  }

  function woodVoice(ac, dest, t, dur, vel = 1) {
    // a knock plus a soft sustained tone, so note lengths are audible as well as onsets
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(980, t); o.frequency.exponentialRampToValueAtTime(640, t + 0.03);
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(gn).connect(dest);
    o.start(t); o.stop(t + 0.12);
    const s = ac.createOscillator(); s.setPeriodicWave(waves(ac).pure); s.frequency.value = TL.mtof(67);
    const sg = ac.createGain(); sg.gain.value = 0;
    const len = Math.max(0.08, dur * 0.88);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.09 * vel, t + 0.012);
    sg.gain.setValueAtTime(0.09 * vel, t + len);
    sg.gain.linearRampToValueAtTime(0, t + len + 0.03);
    s.connect(sg).connect(dest);
    s.start(t); s.stop(t + len + 0.06);
    return t + len + 0.06;
  }

  const VOICES = { piano: pianoVoice, epiano: epianoVoice, strings: stringsVoice, organ: organVoice, pure: pureVoice };

  function scheduleEvent(ac, dest, ev, st, du, timbre) {
    if (ev.perc === 'click' || ev.perc === 'accent') return clickVoice(ac, dest, st, ev.perc === 'accent', ev.vel ?? 1);
    if (ev.perc === 'wood') return woodVoice(ac, dest, st, du, ev.vel ?? 1);
    const fn = VOICES[ev.timbre || timbre] || pianoVoice;
    let end = st;
    for (const m of ev.notes || []) end = Math.max(end, fn(ac, dest, m, st, du, ev.vel ?? 0.7));
    return end;
  }

  // ---------- public API ----------
  const A = {
    TIMBRES,
    configure(s) {
      Object.assign(cfg, s);
      if (master) master.gain.value = clamp(cfg.volume, 0, 1) * 1.1;
    },
    get ready() { return !!ctx; },
    ensure() {
      if (!ctx) {
        const AC = g.AudioContext || g.webkitAudioContext;
        if (!AC) throw new Error('This browser has no Web Audio support.');
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }
        ctx = new AC({ latencyHint: 'interactive' });
        const ch = buildChain(ctx, ctx.destination);
        bus = ch.bus; master = ch.master;
        master.gain.value = clamp(cfg.volume, 0, 1) * 1.1;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    },
    now() { return ctx ? ctx.currentTime : 0; },
    latency() { return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0; },
    // The audio-clock time the listener was hearing at a given performance.now() moment.
    heardTime(perfMs) {
      if (!ctx) return 0;
      try {
        const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
        if (ts && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      } catch (e) { /* fall through */ }
      return ctx.currentTime - A.latency() - (performance.now() - perfMs) / 1000;
    },
    // events: [{t, notes|perc, dur, vel, timbre}] in seconds at normal speed.
    play(events, opts = {}) {
      A.ensure();
      if (opts.keep !== true) A.stop();
      const scale = opts.raw ? 1 : 1 / (cfg.speed || 1);
      const gnode = ctx.createGain(); gnode.connect(bus);
      const t0 = ctx.currentTime + (opts.lead ?? 0.06);
      let end = t0;
      const timbre = opts.timbre || cfg.timbre;
      for (const ev of events) {
        const st = t0 + ev.t * scale;
        const du = (ev.dur ?? 0.5) * scale;
        end = Math.max(end, scheduleEvent(ctx, gnode, ev, st, du, timbre), st + du);
      }
      const h = { gain: gnode, t0, end, scale, cancelled: false, timers: [] };
      const lat = A.latency();
      if (opts.onEvent) {
        events.forEach((ev, i) => {
          const ms = (t0 + ev.t * scale - ctx.currentTime + lat) * 1000;
          h.timers.push(setTimeout(() => { if (!h.cancelled) opts.onEvent(ev, i); }, Math.max(0, ms)));
        });
      }
      // "done" resolves when the last event's nominal duration has elapsed (not the reverb tail)
      const lastNominal = events.reduce((mx, ev) => Math.max(mx, ev.t * scale + (ev.dur ?? 0.5) * scale), 0);
      h.done = new Promise((res) => {
        h.resolve = res;
        h.timers.push(setTimeout(() => res(!h.cancelled), (t0 - ctx.currentTime + lastNominal + lat) * 1000 + 30));
      });
      h.timers.push(setTimeout(() => { groups.delete(h); try { gnode.disconnect(); } catch (e) { /* gone */ } }, (end - ctx.currentTime) * 1000 + 3000));
      groups.add(h);
      return h;
    },
    stop() {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const h of groups) {
        h.cancelled = true;
        h.timers.forEach(clearTimeout);
        if (h.resolve) h.resolve(false);
        try {
          h.gain.gain.cancelScheduledValues(now);
          h.gain.gain.setValueAtTime(h.gain.gain.value, now);
          h.gain.gain.linearRampToValueAtTime(0, now + 0.04);
        } catch (e) { /* node already gone */ }
        const node = h.gain;
        setTimeout(() => { try { node.disconnect(); } catch (e) { /* gone */ } }, 120);
      }
      groups.clear();
    },
    droneStart(tonic) {
      A.ensure();
      A.droneStop(0.2);
      const gnode = ctx.createGain(); gnode.gain.value = 0; gnode.connect(bus);
      const t = ctx.currentTime + 0.05;
      gnode.gain.linearRampToValueAtTime(1, t + 1.2);
      const oscs = [];
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(gnode);
      [[tonic - 12, 0.05], [tonic - 5, 0.032], [tonic - 24, 0.03]].forEach(([m, amp]) => {
        [-4, 4].forEach((det) => {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = TL.mtof(m); o.detune.value = det;
          const og = ctx.createGain(); og.gain.value = amp;
          o.connect(og).connect(lp); o.start(t); oscs.push(o);
        });
      });
      drone = { gnode, oscs, tonic };
      return drone;
    },
    droneStop(fade = 0.8) {
      if (!drone || !ctx) return;
      const d = drone; drone = null;
      const now = ctx.currentTime;
      d.gnode.gain.cancelScheduledValues(now);
      d.gnode.gain.setValueAtTime(d.gnode.gain.value, now);
      d.gnode.gain.linearRampToValueAtTime(0, now + fade);
      d.oscs.forEach((o) => o.stop(now + fade + 0.05));
      setTimeout(() => { try { d.gnode.disconnect(); } catch (e) { /* gone */ } }, (fade + 0.3) * 1000);
    },
    get droneTonic() { return drone ? drone.tonic : null; },
    // Offline render of a single note, used by the self-test in Preferences.
    async renderTest(timbre = 'piano', midi = 69) {
      const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext;
      if (!OAC) return null;
      const ac = new OAC(1, 44100, 44100);
      const ch = buildChain(ac, ac.destination);
      (VOICES[timbre] || pianoVoice)(ac, ch.bus, midi, 0.01, 0.8, 0.8);
      const buf = await ac.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0, zc = 0;
      for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); }
      // estimate pitch from zero crossings in a stable window
      const s0 = 4410, s1 = 22050;
      for (let i = s0 + 1; i < s1; i++) if (d[i - 1] <= 0 && d[i] > 0) zc++;
      return { peak, hz: zc / ((s1 - s0) / 44100) };
    },
  };

  TL.Audio = A;
})(typeof window !== 'undefined' ? window : globalThis);
