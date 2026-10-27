/* Tone Ladder — progress store and learning engine: per-item statistics, mastery gating,
   spaced review (Leitner boxes), confusion tracking, daily log, persistence. */
(function (g) {
  const TL = g.TL || (g.TL = {});
  const { TRACKS, TRACK, PREREQ } = TL.Curriculum;

  const LS_KEY = 'tone-ladder-v1';
  // The saved-data format. A copy of the app that finds a higher number was written by newer code:
  // it leaves that progress alone (no cleaning, no saving) and asks for a reload.
  const FORMAT = 4; // 3: intonation samples on items, self-check tallies, the guessFirst setting; 4: singBack
  // Settings that belong to one device (latency calibration, loudness, tempo) and never travel with progress.
  const DEVICE_KEYS = ['tapOffsetMs', 'volume', 'speed'];
  const WINDOW = 20;           // recent answers that decide mastery
  const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];

  const DEFAULT_SETTINGS = {
    labels: 'both',         // both | solfege | numbers
    timbre: 'piano',        // piano | epiano | strings | organ | pure | vary
    keyMode: 'rotate',      // rotate | each | fixed
    fixedKey: 0,
    context: 'cadence',     // cadence | drone
    cadenceEvery: true,
    speed: 1,
    volume: 0.8,
    autoAdvance: true,
    dictationSound: false,
    dailyGoal: 30,
    voice: 'mid',
    tapOffsetMs: 0,
    guessFirst: true,       // with the microphone: now and then, grade yourself before the app shows its grade
    singBack: true,         // with the microphone: sing each dictation melody back before naming its notes
    hints: {},
    unlockAll: false,
  };

  const dayKey = (d = new Date()) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const dayNum = (key) => Math.round(new Date(key + 'T12:00:00').getTime() / 86400000);
  const todayNum = () => dayNum(dayKey());

  function freshState() {
    const now = Date.now();
    return {
      v: FORMAT, createdAt: now, updatedAt: 0,
      settings: { ...DEFAULT_SETTINGS },
      tracks: {}, items: {}, conf: {}, days: {},
      onboarded: false, sessions: 0,
      seen: {},                 // one-time notices already dismissed
      findDoPracticeNext: false, // two Find Do misses in a row: the next Find Do round is a practice round
      guess: { n: 0, a: 0 },    // self-checks made before the microphone's grade, and how many agreed with it
    };
  }
  // Intonation samples kept per sung item: [day, cents off (absolute), cents off (signed, + is high)],
  // one per day, the newest last.
  const PITCH_KEEP = 10;
  // ---------- cleaning loaded state ----------
  // Saved progress comes back from localStorage, the claude.ai account and pasted backups, so it is
  // rebuilt field by field: known keys only, numbers that are finite, levels this curriculum has.
  const ENUMS = {
    labels: ['both', 'solfege', 'numbers'], timbre: ['piano', 'epiano', 'strings', 'organ', 'pure', 'vary'],
    keyMode: ['rotate', 'each', 'fixed'], context: ['cadence', 'drone'], voice: ['low', 'mid', 'high'],
  };
  const RANGES = { fixedKey: [0, 11], speed: [0.5, 1.5], volume: [0, 1], dailyGoal: [5, 200], tapOffsetMs: [-400, 400] };
  const ITEM_FIELDS = ['n', 'c', 'e', 'rt', 'last', 'box', 'due', 'bd', 'p'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // every item each track can record
  const KNOWN = {};
  for (const tr of TRACKS) {
    KNOWN[tr.id] = new Set();
    for (const lv of tr.levels) for (const it of lv.items || lv.pool || []) KNOWN[tr.id].add(it);
  }
  function cleanSettings(s) {
    const out = { ...DEFAULT_SETTINGS, hints: {} };
    if (!isObj(s)) return out;
    for (const [k, d] of Object.entries(DEFAULT_SETTINGS)) {
      const v = s[k];
      if (k === 'hints' || typeof v !== typeof d) continue;
      if (typeof d === 'number') { if (Number.isFinite(v)) out[k] = RANGES[k] ? clampN(v, RANGES[k][0], RANGES[k][1]) : v; }
      else if (ENUMS[k]) { if (ENUMS[k].includes(v)) out[k] = v; }
      else out[k] = v;
    }
    if (isObj(s.hints)) for (const [k, v] of Object.entries(s.hints)) if (typeof v === 'string' && KNOWN.intervals.has(k)) out.hints[k] = v.slice(0, 80);
    return out;
  }
  function cleanTrack(id, t) {
    const last = TRACK[id].levels.length - 1;
    const level = clampN(Math.floor(num(t.level)), 0, last);
    const out = {
      level, maxLevel: clampN(Math.floor(num(t.maxLevel)), level, last),
      window: [], windowDays: [], levelStats: {}, intro: {}, last: num(t.last), history: [],
    };
    // window and level statistics belong to the level; drop them if that level had to be moved
    if (level === num(t.level)) {
      if (Array.isArray(t.window)) out.window = t.window.filter((x) => Number.isFinite(x)).map((x) => clampN(x, 0, 1)).slice(-40);
      // one day number per answer; answers saved before days were kept count as an earlier day (0)
      const days = Array.isArray(t.windowDays) ? t.windowDays.filter((x) => Number.isFinite(x)) : [];
      out.windowDays = [...Array(Math.max(0, out.window.length - days.length)).fill(0), ...days].slice(-out.window.length || 0);
      if (!out.window.length) out.windowDays = [];
      if (isObj(t.levelStats)) for (const [k, v] of Object.entries(t.levelStats)) if (KNOWN[id].has(k) && isObj(v)) out.levelStats[k] = { n: num(v.n), c: num(v.c) };
    }
    if (isObj(t.intro)) for (const [k, v] of Object.entries(t.intro)) if (/^\d+$/.test(k) && (typeof v === 'boolean' || Number.isFinite(v))) out.intro[k] = v;
    if (Array.isArray(t.history)) out.history = t.history.filter(isObj).slice(-200).map((h) => ({ level: num(h.level), at: num(h.at), ...(h.mastered === true ? { mastered: true } : {}), ...(h.skipped === true ? { skipped: true } : {}) }));
    if (t.complete === true) out.complete = true;
    return out;
  }
  const isNewer = (s) => isObj(s) && num(s.v, 1) > FORMAT;
  function migrate(s) {
    s = isObj(s) ? s : {};
    const out = freshState();
    out.createdAt = num(s.createdAt, out.createdAt);
    out.updatedAt = num(s.updatedAt);
    out.settings = cleanSettings(s.settings);
    if (isObj(s.tracks)) for (const [id, t] of Object.entries(s.tracks)) if (TRACK[id] && isObj(t)) out.tracks[id] = cleanTrack(id, t);
    if (isObj(s.items)) {
      for (const [k, v] of Object.entries(s.items)) {
        const i = k.indexOf(':');
        const tr = k.slice(0, i), it = k.slice(i + 1);
        if (i < 1 || !KNOWN[tr] || !KNOWN[tr].has(it) || !isObj(v)) continue;
        const o = {};
        for (const f of ITEM_FIELDS) o[f] = num(v[f], f === 'e' ? 0.5 : 0);
        o.e = clampN(o.e, 0, 1);
        o.box = clampN(Math.floor(o.box), 0, BOX_DAYS.length - 1);
        if (!o.p) delete o.p; // practice count, stored only once there is one
        if (Array.isArray(v.cl)) {
          const cl = v.cl.filter((x) => Array.isArray(x) && x.length === 3 && x.every(Number.isFinite)).map((x) => [Math.floor(x[0]), clampN(x[1], 0, 600), clampN(x[2], -600, 600)]).slice(-PITCH_KEEP);
          if (cl.length) o.cl = cl;
        }
        out.items[k] = o;
      }
    }
    if (isObj(s.conf)) {
      for (const [tr, m] of Object.entries(s.conf)) {
        if (!KNOWN[tr] || !isObj(m)) continue;
        const o = {};
        for (const [k, v] of Object.entries(m)) { const [a, b] = k.split('>'); if (KNOWN[tr].has(a) && KNOWN[tr].has(b) && Number.isFinite(v)) o[k] = v; }
        out.conf[tr] = o;
      }
    }
    if (isObj(s.days)) {
      for (const [k, d] of Object.entries(s.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isObj(d)) continue;
        const o = { q: num(d.q), c: num(d.c), s: num(d.s), t: {} };
        if (d.pq != null) o.pq = num(d.pq);
        if (isObj(d.t)) for (const [tr, a] of Object.entries(d.t)) if (TRACK[tr] && Array.isArray(a)) o.t[tr] = [num(a[0]), num(a[1])];
        out.days[k] = o;
      }
    }
    out.onboarded = s.onboarded === true;
    out.sessions = num(s.sessions);
    if (isObj(s.seen)) for (const [k, v] of Object.entries(s.seen)) if (v === true) out.seen[k] = true;
    out.findDoPracticeNext = s.findDoPracticeNext === true;
    if (isObj(s.guess)) out.guess = { n: num(s.guess.n), a: clampN(num(s.guess.a), 0, num(s.guess.n)) };
    return out;
  }
  const UNDO_KEY = 'tone-ladder-v1-before-import';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const S = {
    state: freshState(),
    mode: 'memory',       // memory | local | cloud
    listeners: new Set(),
    _ref: null, _saving: false, _dirty: false, _timer: null,

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { this.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); },

    // ---------- persistence ----------
    readLocal() {
      try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    writeLocal() {
      if (this.blocked) return;
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); if (this.mode === 'memory') this.mode = 'local'; } catch (e) { /* storage blocked */ }
    },
    // Progress written by a newer version of the app: show it, but never clean or save over it.
    blocked: false,
    block() {
      if (this.blocked) return;
      this.blocked = true;
      clearTimeout(this._timer);
      this.emit();
    },
    // Keep this device's own settings when progress arrives from somewhere else.
    keepDevice(st) {
      const loc = this.readLocal();
      const src = loc && !isNewer(loc) && isObj(loc.settings) ? cleanSettings(loc.settings) : this.state.settings;
      for (const k of DEVICE_KEYS) st.settings[k] = src[k];
      return st;
    },
    async init() {
      const local = this.readLocal();
      if (isNewer(local)) { this.state = migrate(local); this.mode = 'local'; this.block(); return; }
      if (local) { this.state = migrate(local); this.mode = 'local'; }
      const c = g.claude;
      this.connecting = !!(c && typeof c.use === 'function');
      this.emit();
      try {
        if (!this.connecting) return;
        const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
        if (!db || !user) return;
        const uid = await user.id();
        if (!uid) return;
        this._ref = db.doc('data/users/' + uid + '/progress');
        await this.pull(true);
        this.mode = 'cloud';
        // another device saving to the account shows up here, so this view never writes over it with older progress
        this._ref.onSnapshot((snap) => {
          if (snap.exists && !snap.metadata.hasPendingWrites) this.offer(snap.data());
        }, (e) => console.warn('Live progress updates stopped.', e));
        this.emit();
      } catch (e) {
        console.warn('Cloud progress unavailable; using this browser only.', e);
      } finally {
        if (this.connecting) { this.connecting = false; this.emit(); }
      }
    },
    // Adopt a newer copy saved elsewhere (another device or tab). During a session it waits until the session ends.
    busy: false, _pending: null,
    offer(remote) {
      if (isNewer(remote)) { this.block(); return; }
      if (this.blocked || !remote || (remote.updatedAt || 0) <= (this.state.updatedAt || 0)) return;
      if (this.busy) { this._pending = remote; return; }
      this.state = this.keepDevice(migrate(clone(remote)));
      this.writeLocal();
      this.emit();
    },
    setBusy(b) {
      this.busy = b;
      if (!b && this._pending) { const p = this._pending; this._pending = null; this.offer(p); }
    },
    // Fetch the account copy; keep whichever copy is newer.
    async pull(initial = false) {
      if (!this._ref) return false;
      const snap = await this._ref.get();
      if (snap.exists) {
        const remote = snap.data();
        if (isNewer(remote)) { this.block(); return false; }
        if ((remote.updatedAt || 0) > (this.state.updatedAt || 0)) {
          this.state = this.keepDevice(migrate(clone(remote)));
          this.writeLocal();
          this.emit();
          return true;
        }
        if ((remote.updatedAt || 0) < (this.state.updatedAt || 0)) this.save(true);
      } else if (initial && this.state.updatedAt) {
        this.save(true);
      }
      return false;
    },
    touch() {
      if (this.blocked) return;
      this.state.updatedAt = Date.now();
      this.writeLocal();
      this.save();
    },
    save(now = false) {
      if (!this._ref || this.blocked) return;
      clearTimeout(this._timer);
      if (now) this._flush();
      else this._timer = setTimeout(() => this._flush(), 1500);
    },
    async _flush() {
      if (!this._ref || this.blocked) return;
      if (this._saving) { this._dirty = true; return; }
      this._saving = true;
      try {
        await this._ref.set(clone(this.state));
      } catch (e) {
        if (e && e.code === 'unavailable') setTimeout(() => this.save(), 1500 + Math.random() * 1500);
        else console.warn('Could not save progress to your account.', e);
      } finally {
        this._saving = false;
        if (this._dirty) { this._dirty = false; this._flush(); }
      }
    },

    // ---------- settings ----------
    get settings() { return this.state.settings; },
    set(key, value) { this.state.settings[key] = value; this.touch(); this.emit(); },

    // ---------- tracks & levels ----------
    track(id) {
      let t = this.state.tracks[id];
      if (!t) t = this.state.tracks[id] = { level: 0, maxLevel: 0, window: [], windowDays: [], levelStats: {}, intro: {}, last: 0, history: [] };
      return t;
    },
    levelCount: (id) => TRACK[id].levels.length,
    isUnlocked(id) {
      if (this.settings.unlockAll) return true;
      const reqs = PREREQ[id] || [];
      return reqs.every((r) => this.track(r.track).maxLevel >= r.level);
    },
    prereqText(id) {
      const reqs = PREREQ[id] || [];
      return reqs
        .filter((r) => this.track(r.track).maxLevel < r.level)
        .map((r) => `${TRACK[r.track].name} level ${r.level + 1} (${TRACK[r.track].levels[r.level].name})`)
        .join(' and ');
    },
    setLevel(id, L) {
      const t = this.track(id);
      const max = this.settings.unlockAll ? this.levelCount(id) - 1 : t.maxLevel;
      L = Math.max(0, Math.min(L, max));
      if (L !== t.level) { t.level = L; this.resetWindow(t); }
      this.touch(); this.emit();
    },
    skipAhead(id) {
      const t = this.track(id);
      if (t.maxLevel < this.levelCount(id) - 1) {
        t.maxLevel++; t.level = t.maxLevel; this.resetWindow(t);
        t.history.push({ level: t.level, at: Date.now(), skipped: true });
        this.touch(); this.emit();
      }
    },
    resetWindow(t) { t.window = []; t.windowDays = []; t.levelStats = {}; },
    // A level's intro counts as seen only for its current version (introV), so rewritten intros show once more.
    introSeen(id, L) {
      const v = TRACK[id].levels[L].introV;
      const x = this.track(id).intro[L];
      return v ? x === v : !!x;
    },
    markIntro(id, L) { this.track(id).intro[L] = TRACK[id].levels[L].introV || true; this.touch(); },
    // The first unmet requirement of the next level, or null. Promotion waits for it.
    nextNeeds(id) {
      const t = this.track(id);
      const next = TRACK[id].levels[t.level + 1];
      if (!next || !next.needs || this.settings.unlockAll) return null;
      return next.needs.find((r) => this.track(r.track).maxLevel < r.level) || null;
    },

    mastery(id) {
      const t = this.track(id);
      const lv = TRACK[id].levels[t.level];
      const win = t.window.slice(-WINDOW);
      const sum = win.reduce((a, b) => a + b, 0);
      const threshold = TRACK[id].selfGraded ? 0.8 : 0.9;
      const need = Math.ceil(WINDOW * threshold);
      const newOk = lv.items.length === 1 || (lv.introduce || []).every((it) => {
        const s = t.levelStats[it];
        return s && s.n >= 3 && s.c / s.n >= 0.66;
      });
      const isLast = t.level >= this.levelCount(id) - 1;
      // a level-up needs answers from at least two different days, so sleep has a chance to confirm it
      const days = new Set((t.windowDays || []).slice(-WINDOW));
      const dayOk = days.size >= 2 || t.level < t.maxLevel;
      const full = win.length >= WINDOW && sum >= need && newOk;
      return {
        correct: Math.round(sum * 10) / 10, n: win.length, need, window: WINDOW,
        acc: win.length ? sum / win.length : 0,
        pct: Math.min(1, sum / need),
        newOk, dayOk, full, ready: full && dayOk,
        isLast,
        struggling: win.length >= 12 && win.slice(-12).reduce((a, b) => a + b, 0) / 12 < 0.55,
      };
    },
    // What still stands between this level and the next, assuming every coming answer is right.
    toGo(id) {
      const t = this.track(id);
      const lv = TRACK[id].levels[t.level];
      const m = this.mastery(id);
      if (t.complete) return { complete: true };
      const w = t.window.slice(-WINDOW);
      let answers = 0;
      while (answers < 2 * WINDOW) {
        const recent = w.slice(-WINDOW);
        if (recent.length >= WINDOW && recent.reduce((a, b) => a + b, 0) >= m.need) break;
        w.push(1); answers++;
      }
      const items = lv.items.length === 1 ? [] : (lv.introduce || []).map((it) => {
        const s = t.levelStats[it] || { n: 0, c: 0 };
        return { item: it, more: Math.max(0, 3 - s.n, Math.ceil((0.66 * s.n - s.c) / 0.34)) };
      }).filter((x) => x.more > 0);
      // the window after the answers still needed, all given today: does it span two days?
      const d = (t.windowDays || []).slice(-WINDOW);
      for (let i = 0; i < answers; i++) d.push(todayNum());
      const needsDay = t.level >= t.maxLevel && new Set(d.slice(-WINDOW)).size < 2;
      return { answers, items, needsDay, full: m.full, gate: this.nextNeeds(id), isLast: m.isLast };
    },
    // Promote when the mastery bar is full. Returns the new level index or null.
    maybeLevelUp(id) {
      const t = this.track(id);
      const m = this.mastery(id);
      if (!m.ready) return null;
      if (!m.isLast && this.nextNeeds(id)) return null;
      t.history.push({ level: t.level, at: Date.now(), mastered: true });
      if (m.isLast) { t.complete = true; t.window = []; t.windowDays = []; this.touch(); return null; }
      t.level++;
      t.maxLevel = Math.max(t.maxLevel, t.level);
      this.resetWindow(t);
      this.touch(); this.emit();
      return t.level;
    },

    // ---------- items ----------
    item(track, it) {
      const k = track + ':' + it;
      return this.state.items[k] || { n: 0, c: 0, e: 0.5, rt: 0, last: 0, box: 0, due: 0, bd: 0 };
    },
    // How far off an answer was sung, in cents: merged into today's sample for the item.
    recordPitch(track, it, abs, signed) {
      if (!Number.isFinite(abs) || !Number.isFinite(signed)) return;
      const k = track + ':' + it;
      const s = { ...this.item(track, it) };
      const today = todayNum();
      const cl = (s.cl || []).map((x) => x.slice());
      const last = cl[cl.length - 1];
      if (last && last[0] === today) { last[1] = last[1] * 0.7 + abs * 0.3; last[2] = last[2] * 0.7 + signed * 0.3; }
      else cl.push([today, abs, signed]);
      s.cl = cl.slice(-PITCH_KEEP).map((x) => [x[0], Math.round(x[1]), Math.round(x[2])]);
      this.state.items[k] = s;
      this.touch();
    },
    // An item's intonation: today's or the latest sample, the one from a week or more before it, and
    // whether the voice tends low or high over the last few.
    pitchTrend(track, it) {
      const cl = this.item(track, it).cl;
      if (!cl || !cl.length) return null;
      const now = cl[cl.length - 1];
      const before = cl.slice().reverse().find((x) => now[0] - x[0] >= 7) || null;
      const recent = cl.slice(-4);
      const lean = recent.reduce((a, x) => a + x[2], 0) / recent.length;
      return { now: now[1], nowDay: now[0], before: before ? before[1] : null, lean: Math.abs(lean) >= 20 ? (lean < 0 ? 'low' : 'high') : null, days: cl.length };
    },
    // The learner graded themselves before seeing the microphone's grade: did the two agree?
    noteGuess(agree) {
      const g = this.state.guess || (this.state.guess = { n: 0, a: 0 });
      g.n++; if (agree) g.a++;
      this.touch();
    },
    // Weighted choice: weak items, new items and due items come up more; no item three times in a row.
    chooseItem(track, pool, { newItems = [], recent = [], levelStats = {} } = {}) {
      const today = todayNum();
      const entries = pool.map((it) => {
        const s = this.item(track, it);
        let w = 1 + 2.4 * (1 - s.e);
        if (newItems.includes(it) && ((levelStats[it] && levelStats[it].n) || 0) < 12) w += 1.8;
        if (s.n === 0) w += 0.8;
        if (s.n > 0 && s.due <= today) w += 0.6;
        const r1 = recent[recent.length - 1], r2 = recent[recent.length - 2];
        if (r1 === it) w *= 0.45;
        if (r1 === it && r2 === it) w = 0;
        return [it, w];
      });
      return TL.weightedPick(entries) ?? pool[0];
    },

    // Record one answered question. results: one score (0..1) per stats item.
    // Practice rounds (the answer was played first) count toward the day's goal but not toward
    // accuracy, review scheduling or mastery.
    record({ track, level, items, results, rt = 0, confusions = [], practice = false }) {
      const st = this.state;
      const now = Date.now();
      const today = todayNum();
      const t = this.track(track);
      if (practice) {
        items.forEach((it) => {
          const k = track + ':' + it;
          const s = { ...this.item(track, it) };
          s.p = (s.p || 0) + 1; s.last = now;
          st.items[k] = s;
        });
        t.last = now;
        const dk = dayKey();
        const d = st.days[dk] || (st.days[dk] = { q: 0, c: 0, s: 0, t: {} });
        d.pq = (d.pq || 0) + 1;
        this.touch();
        return;
      }
      items.forEach((it, i) => {
        const r = results[i] ?? 0;
        const k = track + ':' + it;
        const s = { ...this.item(track, it) };
        s.n += 1; s.c += r;
        s.e = s.n === 1 ? 0.5 * 0.5 + r * 0.5 : s.e * 0.78 + r * 0.22;
        if (rt > 0 && rt < 30000) s.rt = s.rt ? s.rt * 0.75 + rt * 0.25 : rt;
        if (r >= 0.99) { if (s.bd !== today) { s.box = Math.min(BOX_DAYS.length - 1, s.box + 1); s.bd = today; } }
        else if (r < 0.5) { s.box = Math.max(0, s.box - 2); s.bd = today; }
        s.due = today + BOX_DAYS[s.box];
        s.last = now;
        st.items[k] = s;
        if (level === t.level) {
          const ls = t.levelStats[it] || { n: 0, c: 0 };
          ls.n++; ls.c += r; t.levelStats[it] = ls;
        }
      });
      if (level === t.level) {
        t.window.push(...results.map((r) => Math.round(r * 100) / 100));
        t.windowDays = [...(t.windowDays || []), ...results.map(() => today)];
        if (t.window.length > 40) t.window = t.window.slice(-40);
        t.windowDays = t.windowDays.slice(-t.window.length);
      }
      t.last = now;
      for (const [asked, said] of confusions) {
        const ct = track === 'melody' ? 'degrees' : track;
        const m = st.conf[ct] || (st.conf[ct] = {});
        const key = asked + '>' + said;
        m[key] = (m[key] || 0) + 1;
      }
      const dk = dayKey();
      const d = st.days[dk] || (st.days[dk] = { q: 0, c: 0, s: 0, t: {} });
      d.q += 1;
      const score = results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0;
      d.c += Math.round(score * 100) / 100;
      const td = d.t[track] || (d.t[track] = [0, 0]);
      td[0] += 1; td[1] += Math.round(score * 100) / 100;
      this.pruneDays();
      this.touch();
    },
    addTime(seconds) {
      const dk = dayKey();
      const d = this.state.days[dk] || (this.state.days[dk] = { q: 0, c: 0, s: 0, t: {} });
      d.s += Math.round(seconds);
    },
    pruneDays() {
      const keys = Object.keys(this.state.days).sort();
      if (keys.length > 420) keys.slice(0, keys.length - 420).forEach((k) => delete this.state.days[k]);
    },
    // A backup as text, to move progress between browsers, devices, or noaware.io and claude.ai.
    exportText() {
      return JSON.stringify({ app: 'tone-ladder', exported: new Date().toISOString(), state: this.state });
    },
    parseBackup(text) {
      let o;
      try { o = JSON.parse(String(text || '').trim()); } catch (e) { o = null; }
      const st = o && o.app === 'tone-ladder' ? o.state : o;
      if (!isObj(st) || !isObj(st.tracks) || !isObj(st.settings)) {
        throw new Error('That is not a Tone Ladder backup. Copy it again and paste all of it.');
      }
      if (isNewer(st)) throw new Error('This progress comes from a newer Tone Ladder. Update this copy first.');
      // progress from a copy with more tracks or levels than this one would be cut down here: refuse it
      for (const [id, t] of Object.entries(st.tracks)) {
        if (!TRACK[id] || !isObj(t) || num(t.level) >= TRACK[id].levels.length || num(t.maxLevel) >= TRACK[id].levels.length) {
          throw new Error('This progress comes from a newer Tone Ladder. Update this copy first.');
        }
      }
      return migrate(clone(st));
    },
    // questions answered in a state, practice rounds included
    answeredIn(st) { return Object.values(st.days || {}).reduce((a, d) => a + this.dayQ(d), 0); },
    applyBackup(st) {
      if (this.blocked) return;
      try { localStorage.setItem(UNDO_KEY, JSON.stringify(this.state)); } catch (e) { /* no undo without storage */ }
      this.state = this.keepDevice(st);
      this.state.updatedAt = Date.now();
      this.writeLocal();
      this.save(true);
      this.emit();
    },
    hasUndo() { try { return !!localStorage.getItem(UNDO_KEY); } catch (e) { return false; } },
    undoImport() {
      if (this.blocked) return false;
      let prev = null;
      try { prev = JSON.parse(localStorage.getItem(UNDO_KEY)); localStorage.removeItem(UNDO_KEY); } catch (e) { prev = null; }
      if (!prev) return false;
      this.state = migrate(prev);
      this.state.updatedAt = Date.now();
      this.writeLocal();
      this.save(true);
      this.emit();
      return true;
    },
    reset() {
      const keep = { ...this.state.settings };
      const seen = { ...this.state.seen, v2: true };
      this.state = freshState();
      this.state.settings = keep;
      this.state.seen = seen;
      this.state.onboarded = true;
      this.touch(); this.emit();
    },

    // ---------- summaries ----------
    today() {
      return this.state.days[dayKey()] || { q: 0, c: 0, s: 0, t: {} };
    },
    // questions answered on a day, practice rounds included
    dayQ(d) { return d ? d.q + (d.pq || 0) : 0; },
    streak() {
      const goal = Math.min(15, this.settings.dailyGoal);
      let n = 0;
      const d = new Date();
      const met = (k) => this.dayQ(this.state.days[k]) >= goal;
      if (!met(dayKey(d))) d.setDate(d.getDate() - 1);
      while (met(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
      return n;
    },
    totals() {
      let q = 0, c = 0, s = 0, days = 0;
      for (const d of Object.values(this.state.days)) { q += this.dayQ(d); c += d.c; s += d.s; if (this.dayQ(d)) days++; }
      return { q, c, s, days };
    },
    recentAccuracy(nDays = 7) {
      let q = 0, c = 0;
      const d = new Date();
      for (let i = 0; i < nDays; i++) {
        const day = this.state.days[dayKey(d)];
        if (day) { q += day.q; c += day.c; }
        d.setDate(d.getDate() - 1);
      }
      return q ? c / q : null;
    },
    topConfusions(limit = 6) {
      const out = [];
      for (const [track, m] of Object.entries(this.state.conf)) {
        for (const [k, n] of Object.entries(m)) {
          const [asked, said] = k.split('>');
          out.push({ track, asked, said, n });
        }
      }
      return out.filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, limit);
    },
    daysSince(track) {
      const t = this.track(track);
      return t.last ? (Date.now() - t.last) / 86400000 : 99;
    },
  };

  // another tab of this site saved: adopt it if newer, so an old tab never writes over it
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('storage', (e) => {
      if (e.key !== LS_KEY || !e.newValue) return;
      try { S.offer(JSON.parse(e.newValue)); } catch (err) { /* ignore a partial write */ }
    });
  }
  S.FORMAT = FORMAT;
  TL.Store = S;
  TL.dayKey = dayKey;
  TL.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(typeof window !== 'undefined' ? window : globalThis);
