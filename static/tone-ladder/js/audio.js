/* Tone Ladder — audio engine. All sound is synthesized with Web Audio:
   piano, electric piano, strings, organ and a pure tone, plus metronome clicks,
   a rhythm voice and a tonic drone. It also opens the microphone for grading singing; that sound
   is analysed in the page and never sent. The current answer's sound is held in memory until the
   next question, so the learner can save it ("Save this take") if a grade looks wrong. */
(function (g) {
  const TL = g.TL || (g.TL = {});
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  let ctx = null, bus = null, master = null;
  let groups = new Set();
  let lastStop = -1;
  let spans = []; // what the app has scheduled, pruned by the audio clock (timers can run ahead of it)
  let mic = null, micPending = null, micGen = 0;
  // the current take: chunks of sound from js/take-worklet.js, at most TAKE_SEC of it. One recorder
  // per context, reused by every mic; `gen` numbers the take, so a late chunk of an old one is dropped.
  const TAKE_URL = 'js/take-worklet.js', TAKE_SEC = 45, TAKE_KEEP = 8192;
  let takeMod = null, takeTries = 0, takeNode = null;
  const take = { on: false, gen: 0, chunks: [], len: 0 };
  const BT = /airpods|bluetooth|hands-?free|headset|buds|beats/i;
  // where a headset's mic is swapped out, only for one that is plainly the computer's own
  const BUILTIN = /built-?in|internal|macbook|imac|microphone array/i;
  const VIRTUAL = /virtual|aggregate|loopback|stereo mix|cable|blackhole|soundflower|zoom|teams|steam|obs/i;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
        ctx.addEventListener('statechange', () => { if (A.onState) A.onState(ctx.state); });
        const ch = buildChain(ctx, ctx.destination);
        bus = ch.bus; master = ch.master;
        master.gain.value = clamp(cfg.volume, 0, 1) * 1.1;
      }
      // 'suspended' after a pause, 'interrupted' on iOS after a call or the lock screen
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return ctx;
    },
    // Called on every touch and key press: a resume only succeeds inside a user gesture on iOS.
    wake() {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
    },
    now() { return ctx ? ctx.currentTime : 0; },
    latency() { return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0; },
    inLatency() { return ctx ? (ctx.baseLatency || 0.01) : 0.01; }, // the microphone's own delay, about
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
      h.nominalEnd = t0 + lastNominal;
      h.done = new Promise((res) => {
        h.resolve = res;
        h.timers.push(setTimeout(() => res(!h.cancelled), (t0 - ctx.currentTime + lastNominal + lat) * 1000 + 30));
      });
      h.timers.push(setTimeout(() => { groups.delete(h); try { gnode.disconnect(); } catch (e) { /* gone */ } }, (end - ctx.currentTime) * 1000 + 3000));
      groups.add(h);
      spans.push(h);
      return h;
    },
    // True while a note the app played is still sounding at full strength through the speakers
    // (output latency included). Its release and the reverb tail after it are left to the pitch
    // listener, which tells them from a voice by level, so a learner who starts singing as the
    // chords stop is heard from the start.
    playing() {
      if (!ctx) return false;
      const until = ctx.currentTime - A.latency() - 0.2;
      spans = spans.filter((h) => !h.cancelled && h.nominalEnd > until);
      return !!drone || lastStop > until || spans.length > 0;
    },
    // The audio clock only moves while the context runs; the mic listener must pause otherwise.
    get running() { return !!ctx && ctx.state === 'running'; },
    stop() {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (groups.size) lastStop = now + 0.04;
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

    // ---------- microphone ----------
    micSupported() { return !!(g.isSecureContext !== false && g.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    get micOn() { return !!mic; },
    get micMuted() { return !!(mic && mic.track && mic.track.muted); },
    // Resolves with the open track's label; rejects with the browser's error (NotAllowedError,
    // NotFoundError, ...), or with an error marked tlClosed when micClose() ran before the browser answered.
    // Raw capture: echo cancellation, noise suppression and automatic gain all bend pitch or fade a
    // held note. A Bluetooth headset's mic would drop its sound to call quality, so on a computer
    // the built-in mic is used instead when there is one.
    micOpen(deviceId) {
      A.ensure();
      if (mic) return Promise.resolve(mic.label);
      if (micPending) return micPending;
      const gen = micGen;
      // iOS: recording needs the play-and-record session; 'playback' (set above) would block it
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* optional */ }
      const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      const ask = (id) => navigator.mediaDevices.getUserMedia({ audio: id ? { ...raw, deviceId: { exact: id } } : raw });
      const stopAll = (st) => { try { st.getTracks().forEach((t) => t.stop()); } catch (e) { /* gone */ } };
      micPending = ask(deviceId)
        .then(async (stream) => {
          let track = stream.getAudioTracks()[0];
          if (!deviceId && track && BT.test(track.label) && !isIOS()) {
            try {
              const devs = await navigator.mediaDevices.enumerateDevices();
              const alt = devs.find((d) => d.kind === 'audioinput' && BUILTIN.test(d.label) && !BT.test(d.label) && !VIRTUAL.test(d.label) && d.deviceId !== 'default' && d.deviceId !== 'communications');
              // the headset stream stays open until the built-in one has opened
              if (alt) { const s2 = await ask(alt.deviceId); stopAll(stream); stream = s2; track = stream.getAudioTracks()[0]; }
            } catch (e) { /* keep the headset */ }
          }
          if (gen !== micGen) { stopAll(stream); const e = new Error('closed'); e.name = 'AbortError'; e.tlClosed = true; throw e; }
          try {
            const src = ctx.createMediaStreamSource(stream);
            const an = ctx.createAnalyser();
            // about 43 ms of sound at any sample rate (2048 samples at 48 kHz)
            an.fftSize = Math.min(8192, Math.max(1024, 2 ** Math.round(Math.log2(ctx.sampleRate * 0.043))));
            an.smoothingTimeConstant = 0;
            // a silent path to the output keeps every browser pulling audio through the analyser
            const sink = ctx.createGain(); sink.gain.value = 0;
            src.connect(an); an.connect(sink); sink.connect(ctx.destination);
            const settings = track && track.getSettings ? track.getSettings() : {};
            mic = { stream, track, src, an, sink, buf: new Float32Array(an.fftSize), label: (track && track.label) || '', settings, bluetooth: !!(track && BT.test(track.label)), take: null };
          } catch (e) { stopAll(stream); throw e; }
          attachTake(mic);
          if (track) {
            track.addEventListener('ended', () => { if (mic && mic.track === track) { A.micClose(); if (A.onMic) A.onMic('ended'); } });
            track.addEventListener('mute', () => { if (A.onMic) A.onMic('mute'); });
            track.addEventListener('unmute', () => { if (A.onMic) A.onMic('unmute'); });
          }
          if (ctx.state !== 'running') ctx.resume().catch(() => {});
          return mic.label;
        })
        .catch((e) => { micSession(); throw e; })
        .finally(() => { if (gen === micGen) micPending = null; });
      return micPending;
    },
    // The latest ~43 ms of samples (one buffer, reused: copy it to keep it), or null when closed or muted.
    micFrame() {
      if (!mic || (mic.track && mic.track.muted)) return null;
      mic.an.getFloatTimeDomainData(mic.buf);
      return mic.buf;
    },
    micRate() { return ctx ? ctx.sampleRate : 48000; },
    // What explains the sound, not what identifies the device: no device or group ids, and an
    // owner's name taken out of a label ("Daniel's AirPods Pro" → "AirPods Pro").
    micInfo() {
      if (!mic) return null;
      const keep = ['sampleRate', 'sampleSize', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation', 'latency'];
      const settings = {};
      for (const k of keep) if (mic.settings && mic.settings[k] !== undefined) settings[k] = mic.settings[k];
      const label = mic.label.replace(/[^\s()]+['’]s\s+/gu, '');
      return { label, settings, bluetooth: mic.bluetooth, kind: mic.bluetooth ? 'bluetooth' : BUILTIN.test(mic.label) ? 'built-in' : 'other' };
    },
    micClose() {
      micGen++; // a request still waiting for the browser is dropped when it answers
      micPending = null;
      if (!mic) { micSession(); return; }
      const m = mic; mic = null;
      m.stream.getTracks().forEach((t) => t.stop());
      // (the recorder stays on through a closed mic, as when the page is hidden: the take resumes,
      // with a gap, when the mic opens again)
      try { m.src.disconnect(); m.an.disconnect(); m.sink.disconnect(); if (m.take) m.take.disconnect(); } catch (e) { /* gone */ }
      micSession();
    },

    // ---------- the current take ----------
    // Keep the sound from now on, with the moments just before (and forget the last take). Only
    // while a Sing question listens.
    takeStart() {
      take.gen++; take.on = true; take.chunks = []; take.len = 0;
      if (mic && mic.take) mic.take.port.postMessage({ on: true, gen: take.gen });
      else if (mic) attachTake(mic); // the recorder failed to load earlier: try again
    },
    // The answer is over; its last chunk is still on its way and belongs to it.
    takeStop() {
      take.on = false;
      if (mic && mic.take) mic.take.port.postMessage({ on: false });
    },
    takeForget() { A.takeStop(); take.gen++; take.chunks = []; take.len = 0; },
    get takeReady() { return !!(mic && mic.take); },
    get takeHas() { return take.chunks.length > 0; },
    get takeSec() { return TAKE_SEC; },
    // The take so far: { rate, from (audio frame of the first sample), samples, gaps }. A long stretch
    // with the mic closed (the page hidden) is cut down to TAKE_KEEP frames of silence, the longest
    // analysis window, and listed in `gaps` as [frames from `from` where the cut starts, frames cut],
    // so times still map to samples (js/take.js).
    takeSound() {
      if (!take.chunks.length || !ctx) return null;
      const ch = take.chunks.slice().sort((a, b) => a.from - b.from);
      const from = ch[0].from, gaps = [];
      let end = from, cut = 0;
      for (const c of ch) {
        if (c.from - end > TAKE_KEEP) { gaps.push([end + TAKE_KEEP - from, c.from - end - TAKE_KEEP]); cut += c.from - end - TAKE_KEEP; }
        end = Math.max(end, c.from + c.data.length);
      }
      const samples = new Float32Array(end - from - cut);
      for (const c of ch) {
        let before = 0;
        for (const [at, len] of gaps) if (c.from - from >= at + len) before += len;
        samples.set(c.data.subarray(0, Math.max(0, Math.min(c.data.length, samples.length - (c.from - from - before)))), c.from - from - before);
      }
      return { rate: ctx.sampleRate, from, samples, gaps };
    },
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

  // "Save this take": a recorder in the audio thread beside the analyser. It is set up once the mic
  // is open and never holds the mic up; a browser without AudioWorklet simply has no takes.
  function attachTake(m) {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined' || m.take) return;
    if (!takeMod) {
      if (takeTries >= 3) return;
      // a failed module load is remembered per URL on this context, so a retry needs a new URL
      const url = takeTries++ ? `${TAKE_URL}?r=${takeTries}` : TAKE_URL;
      takeMod = ctx.audioWorklet.addModule(url).catch((e) => { takeMod = null; throw e; });
    }
    takeMod.then(() => {
      if (mic !== m || m.take) return; // closed meanwhile
      if (!takeNode) {
        // mixed down to one channel the way the analyser hears it (a stereo interface, say)
        takeNode = new AudioWorkletNode(ctx, 'tl-take', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
          processorOptions: { pre: m.an.fftSize },
        });
        takeNode.port.onmessage = (e) => takeAdd(e.data);
        takeNode.onprocessorerror = () => { takeNode = null; };
      }
      m.src.connect(takeNode); takeNode.connect(m.sink); // the silent path keeps it running
      m.take = takeNode;
      if (take.on) takeNode.port.postMessage({ on: true, gen: take.gen });
    }, () => { /* no takes on this device */ });
  }
  function takeAdd(c) {
    if (!c || !c.data || c.gen !== take.gen) return;
    take.chunks.push(c); take.len += c.data.length;
    const cap = TAKE_SEC * (ctx ? ctx.sampleRate : 48000);
    while (take.len > cap && take.chunks.length > 1) take.len -= take.chunks.shift().data.length;
  }

  // back to the playback session, which ignores the ringer switch on iPhone
  function micSession() {
    try { if (navigator.audioSession && !mic) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }
  }

  TL.Audio = A;
})(typeof window !== 'undefined' ? window : globalThis);
