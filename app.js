(() => {
  "use strict";

  // -----------------------------
  // Core laws guardrail:
  // - zero typing
  // - minimal interaction path
  // - no background loops (only rAF when visible)
  // -----------------------------

  const STORAGE_KEY = "holoEngine_v1";
  const SCHEMA_VERSION = 1;

  const MAX_DAYS = 400;             // hard cap
  const MAX_EVENTS_PER_DAY = 80;    // hard cap per day (prevents runaway taps)
  const EXPERIMENT_DAYS = 7;

  const TYPES = ["mind","deep","body","food","rest","bad"];
  const TYPE_LABEL = {
    mind:"Mind", deep:"Deep", body:"Body", food:"Food", rest:"Rest", bad:"Bad"
  };

  const $ = (id) => document.getElementById(id);

  // UI refs
  const todayDateEl = $("todayDate");
  const wakeLabelEl = $("wakeLabel");
  const lockLabelEl = $("lockLabel");
  const dayPillEl = $("dayPill");
  const finalizeBtn = $("finalizeBtn");
  const tapGrid = $("tapGrid");

  const readinessText = $("readinessText");
  const fatigueText = $("fatigueText");
  const growthText = $("growthText");
  const readinessFill = $("readinessFill");
  const fatigueFill = $("fatigueFill");
  const growthFill = $("growthFill");

  const coachTruth = $("coachTruth");
  const coachNext = $("coachNext");
  const coachRisk = $("coachRisk");
  const coachRiskRow = $("coachRiskRow");

  const playbackToggle = $("playbackToggle");
  const playbackPanel = $("playbackPanel");
  const pbSlider = $("pbSlider");
  const pbLabel = $("pbLabel");
  const pbModePill = $("pbModePill");
  const youGhostPctEl = $("youGhostPct");

  const probPill = $("probPill");
  const pGrowthEl = $("pGrowth");
  const pDriftEl = $("pDrift");
  const pBeatGhostEl = $("pBeatGhost");

  const calendarEl = $("calendar");
  const toTodayBtn = $("toTodayBtn");
  const todayPanel = $("todayPanel");

  const holoCanvas = $("holoCanvas");
  const trajCanvas = $("trajCanvas");
  const holoMeta = $("holoMeta");

  // -----------------------------
  // Utils
  // -----------------------------
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function softSat(count, scale) { // 0..1 saturating, scale ~ "how many taps to feel it"
    return 1 - Math.exp(-Math.max(0, count) / Math.max(1e-6, scale));
  }
  function dayKeyFromDate(d) { // local day key
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  }
  function parseDayKey(key) { // "YYYY-MM-DD"
    const [y,m,d] = key.split("-").map(n => parseInt(n,10));
    return new Date(y, (m||1)-1, d||1, 12, 0, 0, 0);
  }
  function formatShortDate(key) {
    const d = parseDayKey(key);
    const wd = d.toLocaleDateString(undefined,{weekday:"short"});
    const mo = d.toLocaleDateString(undefined,{month:"short"});
    return `${wd} ${mo} ${d.getDate()}`;
  }
  function formatTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {hour:"2-digit", minute:"2-digit"});
  }
  function safeJSONParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }
  function now() { return Date.now(); }

  // Beta posterior mean
  function betaMean(alpha, beta) { return alpha / (alpha + beta); }

  // -----------------------------
  // State schema
  // -----------------------------
  function makeEmptyDay(dayKey) {
    return {
      dayKey,
      wakeTs: 0,
      finalized: false,
      counts: { mind:0, deep:0, body:0, food:0, rest:0, bad:0 },
      // event log for undo (stack)
      log: [],
      // computed (cached)
      computed: {
        S:0, F:0, R:0, D:0,
        fatigue:0, readiness:0, growth:0,
        cumGrowth:0
      }
    };
  }

  function normalizeStore(raw) {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      selectedDayKey: "",
      days: []
    };

    if (!raw || typeof raw !== "object") return base;

    const v = raw.schemaVersion || 0;
    if (v !== SCHEMA_VERSION) {
      // Only one schema so far; but we still sanitize.
    }

    const days = Array.isArray(raw.days) ? raw.days : [];
    const cleanDays = [];
    for (const d of days) {
      if (!d || typeof d !== "object") continue;
      if (typeof d.dayKey !== "string") continue;
      const cd = makeEmptyDay(d.dayKey);

      cd.wakeTs = (typeof d.wakeTs === "number" && isFinite(d.wakeTs)) ? d.wakeTs : 0;
      cd.finalized = !!d.finalized;

      const c = d.counts || {};
      for (const t of TYPES) {
        const n = c[t];
        cd.counts[t] = (typeof n === "number" && isFinite(n)) ? clamp(Math.floor(n), 0, MAX_EVENTS_PER_DAY) : 0;
      }

      const log = Array.isArray(d.log) ? d.log : [];
      cd.log = log
        .filter(e => e && typeof e === "object" && typeof e.type === "string" && TYPES.includes(e.type) && typeof e.ts === "number")
        .slice(-MAX_EVENTS_PER_DAY);

      // computed will be rebuilt
      cleanDays.push(cd);
    }

    // Sort by dayKey asc
    cleanDays.sort((a,b) => a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0);

    // Cap
    while (cleanDays.length > MAX_DAYS) cleanDays.shift();

    const selectedDayKey = (typeof raw.selectedDayKey === "string") ? raw.selectedDayKey : "";
    return {
      schemaVersion: SCHEMA_VERSION,
      selectedDayKey,
      days: cleanDays
    };
  }

  function loadStore() {
    const raw = safeJSONParse(localStorage.getItem(STORAGE_KEY), null);
    return normalizeStore(raw);
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // If storage fails, we still keep runtime state; no crash.
    }
  }

  let store = loadStore();

  // -----------------------------
  // Day management + rollover
  // -----------------------------
  function getOrCreateDay(dayKey) {
    let d = store.days.find(x => x.dayKey === dayKey);
    if (!d) {
      d = makeEmptyDay(dayKey);
      store.days.push(d);
      store.days.sort((a,b) => a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0);
      while (store.days.length > MAX_DAYS) store.days.shift();
    }
    return d;
  }

  function todayKey() {
    return dayKeyFromDate(new Date());
  }

  function ensureTodaySelected() {
    const tk = todayKey();
    if (!store.selectedDayKey) store.selectedDayKey = tk;

    // If selected is in the future (clock weirdness), clamp to today.
    if (store.selectedDayKey > tk) store.selectedDayKey = tk;

    // Auto-rollover if last interaction was yesterday and user opens today
    getOrCreateDay(tk);

    // If selected day doesn't exist, create it.
    getOrCreateDay(store.selectedDayKey);
  }

  function selectedDay() {
    ensureTodaySelected();
    return getOrCreateDay(store.selectedDayKey);
  }

  function setSelectedDay(dayKey) {
    store.selectedDayKey = dayKey;
    getOrCreateDay(dayKey);
    saveStore();
    renderAll();
  }

  function rolloverIfNeeded() {
    const tk = todayKey();
    if (!store.selectedDayKey) store.selectedDayKey = tk;
    getOrCreateDay(tk);

    // If currently viewing today (or app just opened), keep selection to today.
    // If user is viewing a past day, do not yank them away.
    const sel = store.selectedDayKey;
    if (sel === tk) {
      // nothing
    } else {
      // If selected day was "yesterday but user never meant to browse", keep it.
      // No forced jump.
    }

    saveStore();
  }

  // schedule a single timeout to next midnight to refresh dayKey (no loops)
  let midnightTimer = null;
  function scheduleMidnightRefresh() {
    if (midnightTimer) clearTimeout(midnightTimer);
    const d = new Date();
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 5, 0);
    const ms = Math.max(1000, next.getTime() - d.getTime());
    midnightTimer = setTimeout(() => {
      rolloverIfNeeded();
      renderAll();
      scheduleMidnightRefresh();
    }, ms);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      rolloverIfNeeded();
      renderAll();
    }
    // animation loop handled separately
  });

  // -----------------------------
  // Physics model
  // -----------------------------
  // Coefficients tuned for stability and realism (not hype).
  const COEF = {
    // signal formation (from counts -> 0..1)
    scaleMind: 2.6,
    scaleRest: 2.2,
    scaleFood: 2.4,
    scaleBody: 2.0,
    scaleDeep: 2.0,
    scaleBad: 1.7,

    // state recurrences
    k1S: 0.28,   // stimulus adds fatigue
    k2R: 0.30,   // recovery reduces fatigue
    k3D: 0.12,   // damage adds fatigue slightly
    m1R: 0.30,   // recovery increases readiness
    m2F: 0.22,   // fuel increases readiness
    m3D: 0.28,   // damage reduces readiness
    m4S: 0.12,   // stimulus reduces readiness short-term

    // growth impulse (sigmoid)
    aS: 1.10,
    bF: 0.80,
    cR: 0.95,
    dD: 1.15,
    eFat: 1.05,
    bias: -0.25
  };

  function computeSignalsFromCounts(counts) {
    const mind = softSat(counts.mind, COEF.scaleMind);
    const rest = softSat(counts.rest, COEF.scaleRest);
    const food = softSat(counts.food, COEF.scaleFood);
    const body = softSat(counts.body, COEF.scaleBody);
    const deep = softSat(counts.deep, COEF.scaleDeep);
    const bad  = softSat(counts.bad,  COEF.scaleBad);

    const S = clamp(0.62 * body + 0.48 * deep, 0, 1);
    const F = clamp(food, 0, 1);
    const R = clamp(0.55 * rest + 0.50 * mind, 0, 1);
    const D = clamp(bad, 0, 1);
    return { S, F, R, D };
  }

  function recomputeAllDays() {
    // Iterate in chronological order and propagate fatigue/readiness.
    let fatigue = 0.28;     // mild baseline
    let readiness = 0.52;   // neutral baseline
    let cumGrowth = 0;

    for (const day of store.days) {
      const sig = computeSignalsFromCounts(day.counts);

      // Update fatigue: stimulus increases, recovery decreases, damage increases slightly
      fatigue = clamp(fatigue + COEF.k1S * sig.S + COEF.k3D * sig.D - COEF.k2R * sig.R, 0, 1);

      // Update readiness: recovery + fuel help; damage and acute stimulus reduce
      readiness = clamp(readiness + COEF.m1R * sig.R + COEF.m2F * sig.F - COEF.m3D * sig.D - COEF.m4S * sig.S, 0, 1);

      // Growth impulse: bounded + honest; fatigue penalizes signal.
      const x = COEF.bias
        + COEF.aS * sig.S
        + COEF.bF * sig.F
        + COEF.cR * sig.R
        - COEF.dD * sig.D
        - COEF.eFat * fatigue;

      const growth = clamp(sigmoid(x), 0, 1);

      // cumulative growth is subtle; accumulate slowly and saturate.
      cumGrowth = clamp(cumGrowth + 0.06 * growth * (0.65 + 0.35 * readiness) * (1 - 0.55 * sig.D), 0, 1);

      day.computed = {
        S: sig.S, F: sig.F, R: sig.R, D: sig.D,
        fatigue, readiness, growth,
        cumGrowth
      };
    }
  }

  // -----------------------------
  // Ghost generation
  // -----------------------------
  function ghostFromDay(day, badRate) {
    // Remove Mind/Rest events, keep Body/Deep; amplify damage tendency.
    const g = {
      S: day.computed.S,
      F: day.computed.F,
      R: 0,
      D: clamp(day.computed.D + 0.22 + 0.55 * badRate, 0, 1),
      fatigue: 0,
      readiness: 0,
      growth: 0,
      cumGrowth: 0
    };
    return g;
  }

  function simulateGhost(daysChrono) {
    let fatigue = 0.35;
    let readiness = 0.46;
    let cumGrowth = 0;

    const badVals = daysChrono.map(d => d.computed.D);
    const badRate = badVals.length ? badVals.reduce((a,b)=>a+b,0) / badVals.length : 0.25;

    const ghosts = [];
    for (const day of daysChrono) {
      const sig = ghostFromDay(day, badRate);

      fatigue = clamp(fatigue + COEF.k1S * sig.S + COEF.k3D * sig.D - COEF.k2R * sig.R, 0, 1);
      readiness = clamp(readiness + COEF.m1R * sig.R + COEF.m2F * sig.F - COEF.m3D * sig.D - COEF.m4S * sig.S, 0, 1);

      const x = COEF.bias
        + COEF.aS * sig.S
        + COEF.bF * sig.F
        + COEF.cR * sig.R
        - COEF.dD * sig.D
        - COEF.eFat * fatigue;

      const growth = clamp(sigmoid(x), 0, 1);
      cumGrowth = clamp(cumGrowth + 0.06 * growth * (0.65 + 0.35 * readiness) * (1 - 0.55 * sig.D), 0, 1);

      ghosts.push({ ...sig, fatigue, readiness, growth, cumGrowth });
    }
    return ghosts;
  }

  // -----------------------------
  // Bayesian probabilities (only after >= 7 finalized days)
  // -----------------------------
  function computeProbabilities() {
    const finalized = store.days.filter(d => d.finalized);
    if (finalized.length < EXPERIMENT_DAYS) {
      return { ready:false };
    }

    // Use most recent 7 finalized days as the experiment window.
    const window = finalized.slice(-EXPERIMENT_DAYS);

    // P(Growth Day): define success if growth impulse clears an honest threshold.
    const growthThresh = 0.58;
    let growthSuccess = 0;
    for (const d of window) if (d.computed.growth >= growthThresh) growthSuccess++;

    // Beta prior for stability.
    const a0 = 2, b0 = 2;
    const pGrowth = betaMean(a0 + growthSuccess, b0 + (EXPERIMENT_DAYS - growthSuccess));

    // P(Drift/Overtraining next 7):
    // drift if fatigue high or readiness low at end of day (proxy), and worsening trend in window.
    let driftEvents = 0;
    for (let i=0;i<window.length;i++){
      const d = window[i].computed;
      const drift = (d.fatigue >= 0.72) || (d.readiness <= 0.30);
      if (drift) driftEvents++;
    }
    // trend penalty: if readiness slope negative + fatigue slope positive, add one pseudo-event
    const rSlope = window[window.length-1].computed.readiness - window[0].computed.readiness;
    const fSlope = window[window.length-1].computed.fatigue - window[0].computed.fatigue;
    const pseudo = (rSlope < -0.08 && fSlope > 0.08) ? 1 : 0;
    const pDrift = betaMean(a0 + driftEvents + pseudo, b0 + (EXPERIMENT_DAYS - driftEvents));

    // P(You > Ghost): compare cumulative growth and average readiness (ghost is overtrained).
    const ghosts = simulateGhost(window);
    const youScore = window[window.length-1].computed.cumGrowth * 0.70 + avg(window.map(d=>d.computed.readiness))*0.30 - avg(window.map(d=>d.computed.D))*0.10;
    const ghostScore = ghosts[ghosts.length-1].cumGrowth * 0.70 + avg(ghosts.map(g=>g.readiness))*0.30 - avg(ghosts.map(g=>g.D))*0.10;

    // Turn it into repeated “trials” by day: you “win” day if your growth >= ghost growth AND your readiness >= ghost readiness.
    let wins = 0;
    for (let i=0;i<window.length;i++){
      if (window[i].computed.growth >= ghosts[i].growth && window[i].computed.readiness >= ghosts[i].readiness) wins++;
    }
    // If overall score loses, subtract a win (floored).
    if (youScore + 1e-6 < ghostScore) wins = Math.max(0, wins - 1);

    const pBeatGhost = betaMean(a0 + wins, b0 + (EXPERIMENT_DAYS - wins));

    return {
      ready:true,
      pGrowth, pDrift, pBeatGhost,
      window,
      ghosts
    };
  }

  function avg(arr) {
    if (!arr.length) return 0;
    let s=0; for (const x of arr) s+=x;
    return s/arr.length;
  }

  // -----------------------------
  // Monte Carlo forecast (30 days)
  // -----------------------------
  function betaFromMeanVar(mean, variance) {
    // Solve alpha, beta from mean and var. Clamp variance for sanity.
    mean = clamp(mean, 0.001, 0.999);
    variance = clamp(variance, 1e-4, 0.08);
    const common = mean*(1-mean)/variance - 1;
    const a = clamp(mean * common, 0.25, 50);
    const b = clamp((1-mean) * common, 0.25, 50);
    return {a, b};
  }

  // Gamma sampler (Marsaglia & Tsang) for beta sampling
  function randn() { // Box-Muller
    let u=0, v=0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }
  function gammaSample(k, theta=1) {
    // k > 0
    if (k < 1) {
      // Johnk's generator via boosting
      const u = Math.random();
      return gammaSample(k + 1, theta) * Math.pow(u, 1/k);
    }
    const d = k - 1/3;
    const c = 1 / Math.sqrt(9*d);
    while (true) {
      const x = randn();
      let v = 1 + c*x;
      if (v <= 0) continue;
      v = v*v*v;
      const u = Math.random();
      if (u < 1 - 0.0331*(x*x)*(x*x)) return d*v*theta;
      if (Math.log(u) < 0.5*x*x + d*(1 - v + Math.log(v))) return d*v*theta;
    }
  }
  function betaSample(a,b) {
    const x = gammaSample(a,1);
    const y = gammaSample(b,1);
    return x / (x + y);
  }

  function computeForecast() {
    // Learn distribution of daily signals from finalized days.
    const finalized = store.days.filter(d => d.finalized);
    const recent = finalized.slice(-Math.max(7, Math.min(28, finalized.length)));

    const base = recent.length ? recent : store.days.slice(-Math.min(14, store.days.length));

    const seriesS = base.map(d=>d.computed.S);
    const seriesF = base.map(d=>d.computed.F);
    const seriesR = base.map(d=>d.computed.R);
    const seriesD = base.map(d=>d.computed.D);

    function meanVar(arr) {
      if (!arr.length) return {m:0.35, v:0.03};
      const m = avg(arr);
      let v=0;
      for (const x of arr) v += (x-m)*(x-m);
      v = v / Math.max(1, arr.length-1);
      v = clamp(v, 0.003, 0.06);
      return {m, v};
    }

    const mvS = meanVar(seriesS);
    const mvF = meanVar(seriesF);
    const mvR = meanVar(seriesR);
    const mvD = meanVar(seriesD);

    const distS = betaFromMeanVar(mvS.m, mvS.v);
    const distF = betaFromMeanVar(mvF.m, mvF.v);
    const distR = betaFromMeanVar(mvR.m, mvR.v);
    const distD = betaFromMeanVar(mvD.m, mvD.v);

    // Starting state from latest day
    const last = store.days.length ? store.days[store.days.length-1].computed : {fatigue:0.28, readiness:0.52, cumGrowth:0};
    const startFatigue = last.fatigue ?? 0.28;
    const startReadiness = last.readiness ?? 0.52;
    const startCumGrowth = last.cumGrowth ?? 0.0;

    const horizon = 30;
    const runs = 180; // enough for stable quantiles without burning CPU
    const readinessRuns = Array.from({length:horizon}, () => []);
    const growthRuns = Array.from({length:horizon}, () => []);

    for (let r=0;r<runs;r++){
      let fatigue = startFatigue;
      let readiness = startReadiness;
      let cumGrowth = startCumGrowth;

      for (let t=0;t<horizon;t++){
        // Sample signals; add realistic coupling:
        // high S tends to slightly increase D and require more R to prevent fatigue spiral.
        let S = betaSample(distS.a, distS.b);
        let F = betaSample(distF.a, distF.b);
        let R = betaSample(distR.a, distR.b);
        let D = betaSample(distD.a, distD.b);

        D = clamp(D + 0.10*(S - 0.5), 0, 1);
        R = clamp(R - 0.08*(S - 0.6), 0, 1); // big stimulus makes recovery "harder" if habits don't follow

        fatigue = clamp(fatigue + COEF.k1S*S + COEF.k3D*D - COEF.k2R*R, 0, 1);
        readiness = clamp(readiness + COEF.m1R*R + COEF.m2F*F - COEF.m3D*D - COEF.m4S*S, 0, 1);

        const x = COEF.bias + COEF.aS*S + COEF.bF*F + COEF.cR*R - COEF.dD*D - COEF.eFat*fatigue;
        const growth = clamp(sigmoid(x), 0, 1);

        cumGrowth = clamp(cumGrowth + 0.06 * growth * (0.65 + 0.35 * readiness) * (1 - 0.55 * D), 0, 1);

        readinessRuns[t].push(readiness);
        growthRuns[t].push(growth);
      }
    }

    function quantiles(arr) {
      const a = arr.slice().sort((x,y)=>x-y);
      const q = (p) => a[Math.floor(clamp(p,0,1)*(a.length-1))];
      return { q10:q(0.10), q50:q(0.50), q90:q(0.90) };
    }

    const readinessQ = readinessRuns.map(quantiles);
    const growthQ = growthRuns.map(quantiles);

    return { horizon, readinessQ, growthQ };
  }

  // -----------------------------
  // Interaction (tap / undo / finalize)
  // -----------------------------
  function canEditDay(day) {
    // Only allow editing today and only if not finalized.
    return day.dayKey === todayKey() && !day.finalized;
  }

  function logTap(type) {
    rolloverIfNeeded();
    const day = selectedDay();

    if (!canEditDay(day)) return;

    // First tap of day sets wake time
    if (!day.wakeTs) day.wakeTs = now();

    // hard cap events
    const totalEvents = day.log.length;
    if (totalEvents >= MAX_EVENTS_PER_DAY) return;

    day.counts[type] = clamp(day.counts[type] + 1, 0, MAX_EVENTS_PER_DAY);
    day.log.push({ type, ts: now() });

    recomputeAllDays();
    saveStore();
    renderAll();

    // Nudge holo about last event
    holo.lastEventType = type;
    holo.lastEventAt = performance.now();
  }

  function undoLast() {
    rolloverIfNeeded();
    const day = selectedDay();
    if (!canEditDay(day)) return;
    const e = day.log.pop();
    if (!e) return;
    if (day.counts[e.type] > 0) day.counts[e.type]--;

    recomputeAllDays();
    saveStore();
    renderAll();

    holo.lastEventType = "undo";
    holo.lastEventAt = performance.now();
  }

  function finalizeDay() {
    rolloverIfNeeded();
    const day = selectedDay();
    if (day.finalized) {
      // idempotent
      return;
    }
    // Only allow finalizing today (keeps it clean).
    if (day.dayKey !== todayKey()) return;

    day.finalized = true;

    // Trim log (still keep for undo? finalized means no undo)
    day.log = day.log.slice(-MAX_EVENTS_PER_DAY);

    recomputeAllDays();
    saveStore();
    renderAll();

    holo.lastEventType = "finalize";
    holo.lastEventAt = performance.now();
  }

  // long-press detection for undo (on any tap button)
  function attachLongPressUndo(btn) {
    let timer = null;
    let moved = false;

    const start = (e) => {
      if (btn.disabled) return;
      moved = false;
      // prevent long-press context menu on mobile
      e.preventDefault?.();
      timer = setTimeout(() => {
        timer = null;
        undoLast();
        // subtle haptic if available
        if (navigator.vibrate) navigator.vibrate(12);
      }, 420);
    };

    const end = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const move = () => { moved = true; if (timer) { clearTimeout(timer); timer=null; } };

    btn.addEventListener("pointerdown", start, {passive:false});
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("pointermove", move);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // -----------------------------
  // Coach
  // -----------------------------
  function buildCoach(day) {
    const days = store.days;
    const i = days.findIndex(d => d.dayKey === day.dayKey);
    const d = day.computed;

    // Dominant pattern: stress vs recovery balance
    const balance = (d.R + 0.6*d.F) - (d.S + 0.9*d.D);
    let truth;
    if (balance > 0.25) truth = "Recovery is ahead of stress. You’re banking readiness.";
    else if (balance < -0.25) truth = "Stress is ahead of recovery. You’re spending readiness.";
    else truth = "Stress and recovery are near-balanced. Small shifts will show fast.";

    // NEXT: smallest leverage action tomorrow
    // choose among Mind/Rest/Food based on deficits and what harms growth.
    const wants = [
      {k:"rest", score:(0.55 - d.R) + 0.35*d.fatigue},
      {k:"food", score:(0.55 - d.F) + 0.15*d.S},
      {k:"mind", score:(0.48 - d.R) + 0.20*d.D},
      {k:"bad",  score:(d.D - 0.18) + 0.25*d.fatigue}
    ].sort((a,b)=>b.score-a.score);

    let next;
    if (wants[0].k === "rest") next = "Add one recovery hit: sleep/breath/deload. Protect tomorrow’s readiness.";
    else if (wants[0].k === "food") next = "Fuel earlier: protein + calories near training. Make stimulus worth it.";
    else if (wants[0].k === "mind") next = "One parasympathetic shift: slow exhale / walk / downshift. Keep signals clean.";
    else next = "Delete one damage event. It’s stealing both readiness and growth signal.";

    // RISK only if drift rising
    let riskShow = false;
    let risk = "—";
    const drift = (d.fatigue >= 0.72) || (d.readiness <= 0.30);

    // trend over last 4 days (if available)
    const slice = days.slice(Math.max(0, i-3), i+1);
    if (slice.length >= 3) {
      const rSlope = slice[slice.length-1].computed.readiness - slice[0].computed.readiness;
      const fSlope = slice[slice.length-1].computed.fatigue - slice[0].computed.fatigue;
      if (drift || (rSlope < -0.07 && fSlope > 0.07)) {
        riskShow = true;
        if (d.fatigue >= 0.80) risk = "Fatigue is high. Reduce stimulus or add recovery before it turns into regression.";
        else if (d.readiness <= 0.25) risk = "Readiness is low. Expect weaker sessions unless recovery rises first.";
        else risk = "Trend suggests drift. Keep stimulus, but pay the recovery bill immediately.";
      }
    } else if (drift) {
      riskShow = true;
      risk = "Drift detected. Recovery is the limiter, not willpower.";
    }

    return { truth, next, riskShow, risk };
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function pct(x) { return `${Math.round(clamp(x,0,1)*100)}%`; }

  function renderTodayPanel() {
    const tk = todayKey();
    const sel = selectedDay();
    const isToday = sel.dayKey === tk;

    // Header date
    todayDateEl.textContent = isToday ? `Today • ${formatShortDate(sel.dayKey)}` : formatShortDate(sel.dayKey);

    wakeLabelEl.textContent = `Wake: ${sel.wakeTs ? formatTime(sel.wakeTs) : "—"}`;
    lockLabelEl.textContent = sel.finalized ? "Finalized" : (canEditDay(sel) ? "Unlocked" : "View-only");

    dayPillEl.textContent = isToday
      ? (sel.finalized ? "TODAY • LOCKED" : "TODAY • LIVE")
      : (sel.finalized ? "PAST • LOCKED" : "PAST • VIEW");
    dayPillEl.style.background = sel.finalized
      ? "rgba(80,255,190,0.07)"
      : "rgba(90,140,255,0.08)";
    dayPillEl.style.borderColor = sel.finalized
      ? "rgba(80,255,190,0.22)"
      : "rgba(90,140,255,0.22)";

    // Enable/disable tap buttons
    const editable = canEditDay(sel);
    finalizeBtn.disabled = !(isToday && !sel.finalized);
    for (const btn of tapGrid.querySelectorAll(".tap")) btn.disabled = !editable;

    // Metrics
    const c = sel.computed;
    readinessText.textContent = pct(c.readiness);
    fatigueText.textContent = pct(c.fatigue);
    growthText.textContent = pct(c.growth);

    readinessFill.style.width = pct(c.readiness);
    fatigueFill.style.width = pct(c.fatigue);
    growthFill.style.width = pct(c.growth);

    // Coach
    const coach = buildCoach(sel);
    coachTruth.textContent = coach.truth;
    coachNext.textContent = coach.next;
    if (coach.riskShow) {
      coachRiskRow.style.display = "flex";
      coachRisk.textContent = coach.risk;
    } else {
      coachRiskRow.style.display = "none";
      coachRisk.textContent = "—";
    }

    // Holo meta
    const sig = `S ${pct(c.S)} • F ${pct(c.F)} • R ${pct(c.R)} • D ${pct(c.D)}`;
    holoMeta.textContent = sel.finalized ? `Locked day • ${sig}` : `Live day • ${sig}`;
  }

  function renderCalendar() {
    // last 30 days footprint, including today
    calendarEl.innerHTML = "";
    const d = new Date();
    const daysToShow = 30;
    const keys = [];
    for (let i=daysToShow-1;i>=0;i--){
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()-i, 12,0,0,0);
      keys.push(dayKeyFromDate(x));
    }
    const selKey = store.selectedDayKey || todayKey();

    for (const key of keys) {
      const day = store.days.find(dd => dd.dayKey === key) || makeEmptyDay(key);
      const cell = document.createElement("div");
      cell.className = "daycell" + (key === selKey ? " selected" : "");
      const small = document.createElement("div");
      small.className = "d";
      const dateObj = parseDayKey(key);
      small.textContent = `${dateObj.getMonth()+1}/${dateObj.getDate()}`;
      const m = document.createElement("div");
      m.className = "m";
      const f = document.createElement("div");
      f.className = "f";

      const intensity = clamp(day.computed ? day.computed.growth : 0, 0, 1);
      f.style.width = `${Math.round(intensity*100)}%`;
      m.appendChild(f);

      const lock = document.createElement("div");
      lock.className = "lock";
      lock.textContent = day.finalized ? "✓" : "";

      cell.appendChild(small);
      cell.appendChild(m);
      cell.appendChild(lock);

      cell.addEventListener("click", () => {
        setSelectedDay(key);
      });

      calendarEl.appendChild(cell);
    }
  }

  function renderProbabilitiesAndTraj() {
    const probs = computeProbabilities();
    if (!probs.ready) {
      probPill.textContent = `Need ${EXPERIMENT_DAYS} finalized days`;
      pGrowthEl.textContent = "—";
      pDriftEl.textContent = "—";
      pBeatGhostEl.textContent = "—";
      youGhostPctEl.textContent = "—";
      drawTrajectory(null);
      return;
    }

    probPill.textContent = `Using latest ${EXPERIMENT_DAYS} finalized days`;
    pGrowthEl.textContent = `${Math.round(probs.pGrowth*100)}%`;
    pDriftEl.textContent = `${Math.round(probs.pDrift*100)}%`;
    pBeatGhostEl.textContent = `${Math.round(probs.pBeatGhost*100)}%`;

    youGhostPctEl.textContent = `${Math.round(probs.pBeatGhost*100)}%`;

    // Draw fog cone
    const forecast = computeForecast();
    drawTrajectory(forecast);
  }

  function renderPlaybackControls() {
    // slider range always 1..7, but label depends on available days
    const finalized = store.days.filter(d => d.finalized);
    const window = finalized.slice(-EXPERIMENT_DAYS);
    pbSlider.max = String(EXPERIMENT_DAYS);
    pbSlider.min = "1";
    pbSlider.step = "1";

    // default to latest day in window
    if (!pbSlider.value || parseInt(pbSlider.value,10) > EXPERIMENT_DAYS) pbSlider.value = String(EXPERIMENT_DAYS);

    const idx = clamp(parseInt(pbSlider.value,10)-1, 0, EXPERIMENT_DAYS-1);
    const d = window[idx];
    pbLabel.textContent = d ? `${idx+1}/${EXPERIMENT_DAYS} • ${formatShortDate(d.dayKey)}` : `${idx+1}/${EXPERIMENT_DAYS}`;
  }

  function renderAll() {
    ensureTodaySelected();
    recomputeAllDays();

    renderTodayPanel();
    renderCalendar();
    renderProbabilitiesAndTraj();
    renderPlaybackControls();

    // Holo target state
    holo.setTargetFromSelection();
  }

  // -----------------------------
  // Hologram renderer (Canvas2D)
  // -----------------------------
  const holo = {
    ctx: holoCanvas.getContext("2d"),
    w: 720, h: 720,
    t0: 0,
    running: false,
    lastEventType: "",
    lastEventAt: 0,

    // display mode
    playbackOn: false,
    playbackIndex: 6, // 0..6

    // state (smoothed)
    glow: 0.4,
    fatigue: 0.3,
    growth: 0.3,
    cumGrowth: 0.1,
    S: 0.3, F: 0.3, R: 0.3, D: 0.2,

    // target
    tg: {},

    particles: [],

    init() {
      this.w = holoCanvas.width;
      this.h = holoCanvas.height;

      // seed particles
      for (let i=0;i<120;i++){
        this.particles.push(this.makeParticle(Math.random()));
      }
    },

    makeParticle(seed) {
      // pick a path lane: 0 stimulus, 1 fuel, 2 recovery, 3 damage
      const lane = Math.floor(Math.random()*4);
      return {
        lane,
        p: Math.random(),           // progress 0..1
        v: lerp(0.18, 0.55, Math.random()),
        a: lerp(0.7, 1.0, Math.random()),
        wob: lerp(0.0, 1.0, Math.random()),
        phase: Math.random()*Math.PI*2,
        life: lerp(0.4, 1.0, Math.random()),
        seed
      };
    },

    setTargetFromSelection() {
      const sel = selectedDay();

      // If playback is on and we have enough finalized days, override selection visuals
      let dayForViz = sel;
      let ghosts = null;
      let ghostDay = null;

      const probs = computeProbabilities();
      if (this.playbackOn && probs.ready) {
        const window = probs.window;
        const idx = clamp(this.playbackIndex, 0, window.length-1);
        dayForViz = window[idx];
        ghosts = probs.ghosts;
        ghostDay = ghosts ? ghosts[idx] : null;
        pbModePill.textContent = dayForViz.finalized ? "PLAYBACK • LOCKED" : "PLAYBACK";
      } else {
        pbModePill.textContent = "PLAYBACK";
      }

      const c = dayForViz.computed;

      this.tg = {
        glow: c.readiness,
        fatigue: c.fatigue,
        growth: c.growth,
        cumGrowth: c.cumGrowth,
        S: c.S, F: c.F, R: c.R, D: c.D,
        ghost: ghostDay
      };
    },

    tick(ts) {
      if (!this.running) return;
      if (!this.t0) this.t0 = ts;
      const dt = Math.min(0.033, (ts - this.t0) / 1000);
      this.t0 = ts;

      // Smooth state
      const s = 1 - Math.pow(0.001, dt); // responsive but stable
      const tg = this.tg || {};
      this.glow = lerp(this.glow, tg.glow ?? this.glow, s);
      this.fatigue = lerp(this.fatigue, tg.fatigue ?? this.fatigue, s);
      this.growth = lerp(this.growth, tg.growth ?? this.growth, s);
      this.cumGrowth = lerp(this.cumGrowth, tg.cumGrowth ?? this.cumGrowth, s);
      this.S = lerp(this.S, tg.S ?? this.S, s);
      this.F = lerp(this.F, tg.F ?? this.F, s);
      this.R = lerp(this.R, tg.R ?? this.R, s);
      this.D = lerp(this.D, tg.D ?? this.D, s);

      // Particle dynamics
      const stim = this.S;
      const fuel = this.F;
      const rec = this.R;
      const dmg = this.D;
      const jitter = 0.7*this.fatigue + 0.55*dmg;

      for (const p of this.particles) {
        let drive = 0.35;
        if (p.lane === 0) drive = lerp(0.18, 0.85, stim);
        if (p.lane === 1) drive = lerp(0.16, 0.75, fuel);
        if (p.lane === 2) drive = lerp(0.16, 0.85, rec);
        if (p.lane === 3) drive = lerp(0.08, 0.65, dmg);

        p.p += dt * p.v * drive;
        p.phase += dt * (1.2 + 2.0*jitter) * (0.6 + 0.8*p.wob);

        if (p.p >= 1) {
          // respawn with same lane preference, but allow lane shifting based on latest tap
          const bias = this.lastEventType;
          if (bias === "body" || bias === "deep") p.lane = (Math.random()<0.72) ? 0 : p.lane;
          else if (bias === "food") p.lane = (Math.random()<0.72) ? 1 : p.lane;
          else if (bias === "rest" || bias === "mind") p.lane = (Math.random()<0.72) ? 2 : p.lane;
          else if (bias === "bad") p.lane = (Math.random()<0.72) ? 3 : p.lane;

          p.p = 0;
          p.life = lerp(0.4, 1.0, Math.random());
          p.v = lerp(0.18, 0.55, Math.random());
          p.a = lerp(0.6, 1.0, Math.random());
          p.wob = lerp(0.0, 1.0, Math.random());
        }
      }

      this.draw(ts);
      requestAnimationFrame((t)=>this.tick(t));
    },

    start() {
      if (this.running) return;
      this.running = true;
      this.t0 = 0;
      requestAnimationFrame((t)=>this.tick(t));
    },

    stop() {
      this.running = false;
      this.t0 = 0;
    },

    draw(ts) {
      const ctx = this.ctx;
      const w = this.w, h = this.h;

      // background
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillRect(0,0,w,h);

      // base haze
      const g = ctx.createRadialGradient(w*0.5, h*0.25, 40, w*0.5, h*0.5, h*0.7);
      const glowAmt = clamp(this.glow, 0, 1);
      const dmgAmt = clamp(this.D, 0, 1);
      g.addColorStop(0, `rgba(90,140,255,${0.10 + 0.18*glowAmt})`);
      g.addColorStop(0.55, `rgba(80,255,190,${0.05 + 0.12*glowAmt})`);
      g.addColorStop(1, `rgba(255,80,110,${0.03 + 0.08*dmgAmt})`);
      ctx.fillStyle = g;
      ctx.fillRect(0,0,w,h);

      // silhouette transform (posture/expansion vs compression)
      const expand = 1 + 0.035*glowAmt - 0.028*this.fatigue;
      const sway = 0.010*Math.sin(ts*0.0013) * (0.6 + 0.8*(1-this.fatigue));
      const jitter = (0.9*this.fatigue + 0.7*this.D);
      const jx = (Math.sin(ts*0.017) + Math.sin(ts*0.011))*0.8*jitter;
      const jy = (Math.cos(ts*0.015) + Math.sin(ts*0.009))*0.8*jitter;

      ctx.save();
      ctx.translate(w*0.5 + jx, h*0.52 + jy);
      ctx.scale(expand, expand);
      ctx.rotate(sway);

      // draw aura ring around muscle zones (cumulative growth subtle)
      this.drawAura(ctx);

      // draw silhouette
      this.drawSilhouette(ctx);

      // draw energy flows on top (through-body lines)
      this.drawFlows(ctx, ts);

      // draw ghost overlay (dashed & distorted) during playback if available
      if (this.playbackOn && this.tg && this.tg.ghost) {
        this.drawGhostOverlay(ctx, ts, this.tg.ghost);
      }

      ctx.restore();

      // event pulse
      this.drawEventPulse(ctx, ts);
    },

    drawSilhouette(ctx) {
      const glowAmt = clamp(this.glow, 0, 1);
      const fat = clamp(this.fatigue, 0, 1);
      const dmg = clamp(this.D, 0, 1);

      // base hologram stroke
      const baseAlpha = 0.55 + 0.22*glowAmt - 0.22*dmg - 0.12*fat;
      const glowAlpha = 0.20 + 0.35*glowAmt;

      // outer glow
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 10;
      ctx.strokeStyle = `rgba(90,140,255,${glowAlpha})`;
      ctx.shadowColor = `rgba(80,255,190,${0.18 + 0.22*glowAmt})`;
      ctx.shadowBlur = 24 + 22*glowAmt;

      this.pathBody(ctx, 0);
      ctx.stroke();
      ctx.restore();

      // inner lines
      ctx.save();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `rgba(210,230,255,${baseAlpha})`;
      ctx.shadowBlur = 0;
      this.pathBody(ctx, 0);
      ctx.stroke();

      // scanlines
      ctx.globalAlpha = 0.28 + 0.22*glowAmt;
      ctx.strokeStyle = `rgba(80,255,190,${0.18 + 0.22*glowAmt})`;
      ctx.lineWidth = 1;
      for (let y=-250; y<=260; y+=10) {
        const wob = (Math.sin((y*0.06)+performance.now()*0.002) + Math.sin((y*0.02)+performance.now()*0.001))* (0.6 + 1.6*fat);
        ctx.beginPath();
        ctx.moveTo(-150 + wob, y);
        ctx.lineTo(150 + wob, y);
        ctx.stroke();
      }

      // damage shadow noise
      if (dmg > 0.02) {
        ctx.globalAlpha = 0.18 + 0.35*dmg;
        for (let i=0;i<48;i++){
          const x = lerp(-150, 150, Math.random());
          const y = lerp(-260, 260, Math.random());
          const r = lerp(4, 18, Math.random())*(0.6 + 1.2*dmg);
          ctx.fillStyle = `rgba(120,60,160,${0.10 + 0.28*dmg})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI*2);
          ctx.fill();
        }
      }

      ctx.restore();
    },

    pathBody(ctx, offset) {
      // Stylized bodybuilding silhouette path around origin.
      // Segments: head/torso/arms/legs (not photo-real; truthfully "signal vessel")
      ctx.beginPath();

      // head
      ctx.moveTo(0, -250);
      ctx.bezierCurveTo(30, -250, 44, -226, 44, -206);
      ctx.bezierCurveTo(44, -178, 22, -162, 0, -162);
      ctx.bezierCurveTo(-22, -162, -44, -178, -44, -206);
      ctx.bezierCurveTo(-44, -226, -30, -250, 0, -250);

      // neck -> shoulders
      ctx.moveTo(-32, -162);
      ctx.bezierCurveTo(-46, -150, -64, -138, -92, -132);
      ctx.bezierCurveTo(-128, -125, -150, -110, -160, -92);

      // left arm (biceps/triceps mass)
      ctx.bezierCurveTo(-176, -60, -165, -20, -150, 10);
      ctx.bezierCurveTo(-142, 28, -145, 46, -156, 60);
      ctx.bezierCurveTo(-170, 78, -160, 104, -140, 122);
      ctx.bezierCurveTo(-118, 142, -104, 170, -110, 200);
      ctx.bezierCurveTo(-114, 218, -102, 232, -88, 236);

      // left hip -> leg
      ctx.moveTo(-92, -132);
      ctx.bezierCurveTo(-118, -70, -112, -16, -96, 34);
      ctx.bezierCurveTo(-84, 72, -76, 106, -86, 140);
      ctx.bezierCurveTo(-104, 196, -112, 230, -98, 258);
      ctx.bezierCurveTo(-88, 278, -68, 290, -46, 294);
      ctx.bezierCurveTo(-26, 298, -16, 286, -18, 270);
      ctx.bezierCurveTo(-24, 236, -24, 210, -20, 170);
      ctx.bezierCurveTo(-16, 130, -10, 98, -6, 60);
      ctx.bezierCurveTo(-2, 20, -8, -26, -24, -78);

      // torso centerline to right
      ctx.moveTo(32, -162);
      ctx.bezierCurveTo(46, -150, 64, -138, 92, -132);
      ctx.bezierCurveTo(128, -125, 150, -110, 160, -92);

      // right arm
      ctx.bezierCurveTo(176, -60, 165, -20, 150, 10);
      ctx.bezierCurveTo(142, 28, 145, 46, 156, 60);
      ctx.bezierCurveTo(170, 78, 160, 104, 140, 122);
      ctx.bezierCurveTo(118, 142, 104, 170, 110, 200);
      ctx.bezierCurveTo(114, 218, 102, 232, 88, 236);

      // right hip -> leg
      ctx.moveTo(92, -132);
      ctx.bezierCurveTo(118, -70, 112, -16, 96, 34);
      ctx.bezierCurveTo(84, 72, 76, 106, 86, 140);
      ctx.bezierCurveTo(104, 196, 112, 230, 98, 258);
      ctx.bezierCurveTo(88, 278, 68, 290, 46, 294);
      ctx.bezierCurveTo(26, 298, 16, 286, 18, 270);
      ctx.bezierCurveTo(24, 236, 24, 210, 20, 170);
      ctx.bezierCurveTo(16, 130, 10, 98, 6, 60);
      ctx.bezierCurveTo(2, 20, 8, -26, 24, -78);

      // chest/abs outline (inner)
      ctx.moveTo(-92, -132);
      ctx.bezierCurveTo(-60, -150, -26, -158, 0, -162);
      ctx.bezierCurveTo(26, -158, 60, -150, 92, -132);
      ctx.bezierCurveTo(108, -90, 98, -40, 84, 0);
      ctx.bezierCurveTo(72, 32, 64, 66, 58, 98);
      ctx.bezierCurveTo(44, 168, 30, 206, 0, 210);
      ctx.bezierCurveTo(-30, 206, -44, 168, -58, 98);
      ctx.bezierCurveTo(-64, 66, -72, 32, -84, 0);
      ctx.bezierCurveTo(-98, -40, -108, -90, -92, -132);
    },

    drawAura(ctx) {
      // thin aura rings around muscle zones: chest/back/legs/arms/core
      const cg = clamp(this.cumGrowth, 0, 1);
      const glowAmt = clamp(this.glow, 0, 1);

      const alpha = 0.05 + 0.22*cg;
      const width = 1.2 + 2.2*cg;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = width;

      const zones = [
        {x:0, y:-85, r:92, a:alpha},     // chest/back
        {x:0, y:35,  r:74, a:alpha*0.9}, // core
        {x:-112, y:-50, r:50, a:alpha*0.8}, // left arm
        {x:112,  y:-50, r:50, a:alpha*0.8}, // right arm
        {x:-45, y:210, r:60, a:alpha*0.7}, // left leg
        {x:45,  y:210, r:60, a:alpha*0.7}  // right leg
      ];

      for (const z of zones) {
        ctx.strokeStyle = `rgba(255,255,255,${z.a * (0.55 + 0.45*glowAmt)})`;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI*2);
        ctx.stroke();
      }

      ctx.restore();
    },

    flowColor(lane) {
      // Stimulus red/orange, Fuel white/green, Recovery green/blue, Damage black/purple
      if (lane === 0) return [255, 92, 70];
      if (lane === 1) return [190, 255, 220];
      if (lane === 2) return [80, 190, 255];
      return [160, 85, 220];
    },

    laneStrength(lane) {
      if (lane === 0) return this.S;
      if (lane === 1) return this.F;
      if (lane === 2) return this.R;
      return this.D;
    },

    pathPoint(lane, p) {
      // p: 0..1. Predefined energy routes through the body.
      // origin coordinates around silhouette.
      const t = p;

      // lanes:
      // 0 stimulus: legs->torso->arms
      // 1 fuel: gut->torso->muscles
      // 2 recovery: lungs->heart->whole body
      // 3 damage: noisy shadow traveling downward
      if (lane === 0) {
        const x = lerp(-40, 120, t) + 20*Math.sin(t*5.2);
        const y = lerp(260, -20, t) + 18*Math.sin(t*3.9);
        return {x, y};
      }
      if (lane === 1) {
        const x = 12*Math.sin(t*6.0) + lerp(-30, 30, Math.sin(t*Math.PI));
        const y = lerp(130, -90, t) + 14*Math.sin(t*5.4);
        return {x, y};
      }
      if (lane === 2) {
        const x = 90*Math.sin(t*Math.PI*2) * 0.33;
        const y = lerp(-160, 240, t) + 12*Math.cos(t*7.0);
        return {x, y};
      }
      // damage
      const x = lerp(70, -90, t) + 26*Math.sin(t*9.2);
      const y = lerp(-200, 280, t) + 28*Math.cos(t*8.7);
      return {x, y};
    },

    drawFlows(ctx, ts) {
      const fat = clamp(this.fatigue, 0, 1);
      const dmg = clamp(this.D, 0, 1);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      for (const p of this.particles) {
        const s = this.laneStrength(p.lane);
        const baseA = (0.04 + 0.22*s) * p.a * (0.9 - 0.35*dmg) * (1.0 - 0.25*fat);
        if (baseA < 0.01) continue;

        const col = this.flowColor(p.lane);
        const pt = this.pathPoint(p.lane, p.p);

        // jitter increases with fatigue and damage
        const jit = (0.5*fat + 0.9*dmg) * (0.6 + 0.6*p.wob);
        const jx = Math.sin(p.phase) * 10*jit;
        const jy = Math.cos(p.phase*1.3) * 10*jit;

        // draw small streak (line segment)
        const head = pt;
        const tail = this.pathPoint(p.lane, clamp(p.p - 0.035 - 0.05*s, 0, 1));

        ctx.lineWidth = 1.2 + 2.0*s;
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${baseA})`;

        ctx.beginPath();
        ctx.moveTo(tail.x + jx*0.65, tail.y + jy*0.65);
        ctx.lineTo(head.x + jx, head.y + jy);
        ctx.stroke();

        // sparkle node
        if (Math.random() < 0.012 + 0.025*s) {
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${baseA*1.2})`;
          ctx.beginPath();
          ctx.arc(head.x + jx, head.y + jy, 1.2 + 1.8*s, 0, Math.PI*2);
          ctx.fill();
        }
      }

      ctx.restore();
    },

    drawGhostOverlay(ctx, ts, ghost) {
      // Dashed faint silhouette, distorted, representing overtrained counterfactual.
      const gRead = clamp(ghost.readiness, 0, 1);
      const gFat = clamp(ghost.fatigue, 0, 1);
      const gD = clamp(ghost.D, 0, 1);

      const alpha = 0.14 + 0.10*(1-gRead) + 0.12*gD;
      const dx = 8 + 10*Math.sin(ts*0.0012) * (0.6 + 0.8*gFat);
      const dy = 6*Math.cos(ts*0.0015) * (0.6 + 0.8*gFat);

      ctx.save();
      ctx.translate(dx, dy);
      ctx.globalAlpha = alpha;
      ctx.setLineDash([7, 6]);
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = `rgba(220,220,240,${alpha})`;
      ctx.shadowColor = `rgba(160,85,220,${0.12 + 0.18*gD})`;
      ctx.shadowBlur = 16;

      this.pathBody(ctx, 0);
      ctx.stroke();

      // add distortion noise streaks
      ctx.setLineDash([2, 10]);
      ctx.lineWidth = 1.0;
      ctx.globalAlpha = alpha*0.9;
      for (let i=0;i<24;i++){
        const y = lerp(-240, 260, Math.random());
        const wob = (Math.sin((y*0.08)+ts*0.006) + Math.sin((y*0.02)+ts*0.003))* (1.0 + 2.0*gFat);
        ctx.beginPath();
        ctx.moveTo(-150 + wob, y);
        ctx.lineTo(150 + wob, y);
        ctx.stroke();
      }

      ctx.restore();
    },

    drawEventPulse(ctx, ts) {
      const age = (performance.now() - (this.lastEventAt || 0)) / 1000;
      if (!this.lastEventAt || age > 0.9) return;

      const t = clamp(1 - age/0.9, 0, 1);
      const r = lerp(18, 110, 1-t);
      const a = 0.22 * t;

      let col = "rgba(90,140,255,";
      if (this.lastEventType === "body" || this.lastEventType === "deep") col = "rgba(255,92,70,";
      else if (this.lastEventType === "food") col = "rgba(190,255,220,";
      else if (this.lastEventType === "rest" || this.lastEventType === "mind") col = "rgba(80,190,255,";
      else if (this.lastEventType === "bad") col = "rgba(160,85,220,";
      else if (this.lastEventType === "undo") col = "rgba(200,200,220,";

      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `${col}${a})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(this.w*0.5, this.h*0.5, r, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  };

  // -----------------------------
  // Trajectory chart (Canvas2D)
  // -----------------------------
  function drawTrajectory(forecast) {
    const ctx = trajCanvas.getContext("2d");
    const w = trajCanvas.width, h = trajCanvas.height;

    ctx.clearRect(0,0,w,h);

    // background grid
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0,0,w,h);

    const padL = 46, padR = 14, padT = 16, padB = 34;
    const gw = w - padL - padR;
    const gh = h - padT - padB;

    ctx.save();
    ctx.translate(padL, padT);

    // axes/grid
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    for (let i=0;i<=5;i++){
      const y = gh * (i/5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gw, y);
      ctx.stroke();
    }
    for (let i=0;i<=10;i++){
      const x = gw * (i/10);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gh);
      ctx.stroke();
    }

    // labels
    ctx.fillStyle = "rgba(230,240,255,0.7)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
    ctx.fillText("1.0", -32, 6);
    ctx.fillText("0.0", -32, gh);

    if (!forecast) {
      ctx.fillStyle = "rgba(160,170,200,0.7)";
      ctx.fillText("Finalize 7 days to unlock Bayesian + Monte Carlo forecast.", 8, gh/2);
      ctx.restore();
      return;
    }

    const n = forecast.horizon;

    const xAt = (i) => (i/(n-1)) * gw;
    const yAt = (v) => gh * (1 - clamp(v,0,1));

    function drawFog(qArr, rgb, alphaBase) {
      // fill between q10 and q90 (fog cone)
      ctx.beginPath();
      for (let i=0;i<n;i++){
        const x = xAt(i);
        const y = yAt(qArr[i].q90);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      for (let i=n-1;i>=0;i--){
        const x = xAt(i);
        const y = yAt(qArr[i].q10);
        ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alphaBase})`;
      ctx.fill();

      // median line
      ctx.beginPath();
      for (let i=0;i<n;i++){
        const x = xAt(i);
        const y = yAt(qArr[i].q50);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.55})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Readiness fog (blue/teal)
    drawFog(forecast.readinessQ, [90, 160, 255], 0.14);
    // Growth fog (greenish/white)
    drawFog(forecast.growthQ, [140, 255, 210], 0.12);

    // x axis labels
    ctx.fillStyle = "rgba(160,170,200,0.8)";
    ctx.fillText("Now", 0, gh + 22);
    ctx.fillText("+30d", gw - 34, gh + 22);

    ctx.restore();
  }

  // -----------------------------
  // Events wiring
  // -----------------------------
  function wireUI() {
    finalizeBtn.addEventListener("click", finalizeDay);

    for (const btn of tapGrid.querySelectorAll(".tap")) {
      const type = btn.getAttribute("data-type");
      btn.addEventListener("click", () => logTap(type));
      attachLongPressUndo(btn);
    }

    playbackToggle.addEventListener("click", () => {
      holo.playbackOn = !holo.playbackOn;
      playbackPanel.hidden = !holo.playbackOn;

      // if turning on but not enough data, still show scrub UI (it just mirrors latest available)
      holo.setTargetFromSelection();
      renderPlaybackControls();
    });

    pbSlider.addEventListener("input", () => {
      holo.playbackIndex = clamp(parseInt(pbSlider.value,10)-1, 0, EXPERIMENT_DAYS-1);
      renderPlaybackControls();
      holo.setTargetFromSelection();
    });

    toTodayBtn.addEventListener("click", () => {
      setSelectedDay(todayKey());
      todayPanel.scrollIntoView({behavior:"smooth", block:"start"});
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    ensureTodaySelected();
    recomputeAllDays();

    // If selected day doesn't exist or is empty, select today.
    const sel = selectedDay();
    if (!sel) setSelectedDay(todayKey());

    // Initialize canvases for crispness on high-DPI
    setupHiDPICanvas(holoCanvas, 720, 720);
    setupHiDPICanvas(trajCanvas, 960, 360);

    holo.init();
    wireUI();

    renderAll();
    scheduleMidnightRefresh();

    // Start/stop animation based on visibility (no background loops)
    function syncAnim() {
      if (document.hidden) holo.stop();
      else holo.start();
    }
    document.addEventListener("visibilitychange", syncAnim);
    syncAnim();
  }

  function setupHiDPICanvas(canvas, cssW, cssH) {
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // keep internal logical sizes for hologram engine
    if (canvas === holoCanvas) {
      holo.w = cssW;
      holo.h = cssH;
    }
  }

  boot();
})();
