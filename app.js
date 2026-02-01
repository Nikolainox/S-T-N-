(() => {
  "use strict";

  /* =========================
     HARDENING
     ========================= */
  const HARDEN = Object.freeze({
    GLOBAL_MIN_INTERVAL_MS: 220,
    PER_BUTTON_COOLDOWN_MS: 360,
    MAX_EVENTS_PER_DAY: 24,
    MAX_PER_TYPE: 6
  });

  const EVT_TYPES = Object.freeze(["MIND", "DEEP", "BODY", "FOOD", "REST", "BAD"]);
  const QUARTERS = Object.freeze(["Q1", "Q2", "Q3", "Q4"]);

  const LS_ROOT = "bioClose.v4";
  const LS_DAY_PREFIX = `${LS_ROOT}.day.`; // + YYYY-MM-DD
  const LS_EXP = `${LS_ROOT}.exp`;         // {name, startIso}

  /* =========================
     DOM
     ========================= */
  const $ = (id) => document.getElementById(id);

  const dateTitle = $("dateTitle");
  const dateSub = $("dateSub");

  const btnYesterday = $("btnYesterday");
  const btnToday = $("btnToday");

  const quarterGrid = $("quarterGrid");
  const quarterHint = $("quarterHint");

  const eventGrid = $("eventGrid");
  const btnUndo = $("btnUndo");
  const btnFinalize = $("btnFinalize");

  const statusText = $("statusText");
  const capsText = $("capsText");

  const lineWorked = $("lineWorked");
  const lineHurt = $("lineHurt");
  const lineTomorrow = $("lineTomorrow");
  const lockHint = $("lockHint");

  // Review
  const btnReview = $("btnReview");
  const ovReview = $("ovReview");
  const btnCloseReview = $("btnCloseReview");
  const rWorked = $("rWorked");
  const rHurt = $("rHurt");
  const rTomorrow = $("rTomorrow");

  // EXP
  const btnExp = $("btnExp");
  const expText = $("expText");
  const ovExp = $("ovExp");
  const btnCloseExp = $("btnCloseExp");
  const expGrid = $("expGrid");
  const btnClearExp = $("btnClearExp");

  // Diagnostics
  const btnDiag = $("btnDiag");
  const ovDiag = $("ovDiag");
  const btnCloseDiag = $("btnCloseDiag");
  const dState = $("dState");
  const dWhy = $("dWhy");
  const dStorage = $("dStorage");
  const dJson = $("dJson");
  const dMC = $("dMC");
  const btnRunMC = $("btnRunMC");
  const btnClearAll = $("btnClearAll");

  /* =========================
     TIME (Europe/Helsinki)
     ========================= */
  function todayISO() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function isoToHuman(iso) {
    const d = new Date(iso + "T12:00:00");
    return new Intl.DateTimeFormat("fi-FI", {
      timeZone: "Europe/Helsinki",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(d);
  }

  function addDaysISO(iso, deltaDays) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + deltaDays);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  }

  /* =========================
     STORAGE + SCHEMA
     ========================= */
  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function clampLine(s) {
    const str = String(s ?? "—");
    return str.length <= 80 ? str : (str.slice(0, 77) + "…");
  }

  function emptyDay(iso) {
    return {
      iso,
      quarter: null,
      events: [], // {t, ts}
      finalized: false,
      close: { worked: "—", hurt: "—", tomorrow: "—" }
    };
  }

  function loadDay(iso) {
    const raw = localStorage.getItem(LS_DAY_PREFIX + iso);
    if (!raw) return emptyDay(iso);
    const obj = safeParse(raw);
    if (!obj || obj.iso !== iso) return emptyDay(iso);

    obj.quarter = QUARTERS.includes(obj.quarter) ? obj.quarter : null;

    if (!Array.isArray(obj.events)) obj.events = [];
    obj.events = obj.events
      .filter(e => e && EVT_TYPES.includes(e.t) && Number.isFinite(e.ts))
      .slice(0, HARDEN.MAX_EVENTS_PER_DAY);

    obj.finalized = !!obj.finalized;

    if (!obj.close || typeof obj.close !== "object") obj.close = emptyDay(iso).close;
    obj.close.worked = clampLine(obj.close.worked ?? "—");
    obj.close.hurt = clampLine(obj.close.hurt ?? "—");
    obj.close.tomorrow = clampLine(obj.close.tomorrow ?? "—");

    return obj;
  }

  function saveDay(day) {
    localStorage.setItem(LS_DAY_PREFIX + day.iso, JSON.stringify(day));
  }

  function loadExp() {
    const raw = localStorage.getItem(LS_EXP);
    if (!raw) return null;
    const obj = safeParse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.name !== "string" || !obj.name.trim()) return null;
    if (typeof obj.startIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.startIso)) return null;
    return { name: obj.name.trim(), startIso: obj.startIso };
  }

  function saveExp(name, startIso) {
    localStorage.setItem(LS_EXP, JSON.stringify({ name, startIso }));
  }

  function clearExp() {
    localStorage.removeItem(LS_EXP);
  }

  function expDayCount(exp, currentIso) {
    if (!exp) return null;
    const a = new Date(exp.startIso + "T12:00:00");
    const b = new Date(currentIso + "T12:00:00");
    const diffMs = b.getTime() - a.getTime();
    const days = Math.floor(diffMs / (24 * 3600 * 1000)) + 1;
    return Number.isFinite(days) && days >= 1 ? days : null;
  }

  /* =========================
     TAP HARDENING
     ========================= */
  let lastAnyTapTs = 0;
  const lastButtonTap = new Map();

  function allowTap(key) {
    const now = Date.now();
    if (now - lastAnyTapTs < HARDEN.GLOBAL_MIN_INTERVAL_MS) return false;
    const last = lastButtonTap.get(key) || 0;
    if (now - last < HARDEN.PER_BUTTON_COOLDOWN_MS) return false;
    lastAnyTapTs = now;
    lastButtonTap.set(key, now);
    return true;
  }

  /* =========================
     LOGIC (DETERMINISTIC CLOSE)
     ========================= */
  function countsByType(events) {
    const c = Object.fromEntries(EVT_TYPES.map(t => [t, 0]));
    for (const e of events) c[e.t] = (c[e.t] || 0) + 1;
    return c;
  }

  function summarizeDay(day) {
    const c = countsByType(day.events);

    const worked = [];
    for (const t of ["MIND", "DEEP", "BODY", "FOOD", "REST"]) {
      if (c[t] > 0) worked.push(t);
    }

    const hurt = [];
    if (c.BAD > 0) hurt.push("BAD");
    if (c.REST === 0) hurt.push("NO REST");
    if (c.FOOD === 0) hurt.push("NO FOOD LOG");

    let tomorrow = "Repeat what worked.";
    if (c.REST === 0) tomorrow = "Protect REST (log it once).";
    else if (c.BAD > 0) tomorrow = "Remove BAD trigger path; keep taps deliberate.";
    else if (worked.length === 0) tomorrow = "Log 1 real event (not spam).";
    else tomorrow = "Do the minimum that repeats worked domains.";

    return {
      worked: clampLine(worked.length ? worked.join(" · ") : "—"),
      hurt: clampLine(hurt.length ? hurt.join(" · ") : "—"),
      tomorrow: clampLine(tomorrow)
    };
  }

  function summarizeLast7Finalized() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_DAY_PREFIX)) keys.push(k);
    }

    const days = keys
      .map(k => safeParse(localStorage.getItem(k)))
      .filter(d => d && d.finalized && typeof d.iso === "string")
      .sort((a, b) => (a.iso < b.iso ? 1 : -1)); // desc

    const last7 = days.slice(0, 7);
    if (last7.length === 0) return { worked: "—", hurt: "—", tomorrow: "—" };

    const tally = (arr) => {
      const m = new Map();
      for (const x of arr) {
        const parts = String(x).split("·").map(p => p.trim()).filter(Boolean);
        for (const p of parts) m.set(p, (m.get(p) || 0) + 1);
      }
      return m;
    };

    const topN = (m, n) =>
      [...m.entries()]
        .filter(([k]) => k !== "—")
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k]) => k);

    const workedTop = topN(tally(last7.map(d => d.close?.worked || "—")), 4);
    const hurtTop = topN(tally(last7.map(d => d.close?.hurt || "—")), 4);

    const worked = workedTop.length ? workedTop.join(" · ") : "—";
    const hurt = hurtTop.length ? hurtTop.join(" · ") : "—";

    let tomorrow = "Repeat top worked domains.";
    if (hurtTop.includes("NO REST")) tomorrow = "Fix REST first.";
    else if (hurtTop.includes("BAD")) tomorrow = "Remove BAD trigger path.";
    else if (workedTop.length === 0) tomorrow = "Make 1 deliberate log per day.";
    else tomorrow = "Keep taps deliberate; do not spam.";

    return { worked: clampLine(worked), hurt: clampLine(hurt), tomorrow: clampLine(tomorrow) };
  }

  /* =========================
     STATE
     ========================= */
  let currentIso = todayISO();
  let day = loadDay(currentIso);

  let lastAction = { type: "init", detail: "", ts: Date.now() };
  let lastDisabledWhy = "—";

  function setStatus(msg, kind = "muted") {
    statusText.textContent = msg || "";
    statusText.style.color =
      kind === "ok" ? "var(--ok)" :
      kind === "danger" ? "var(--danger)" :
      "var(--muted)";
  }

  function applyQuarterTheme() {
    document.body.setAttribute("data-q", day.quarter || "");
  }

  function computeDisabledReason() {
    if (day.finalized) return "Day is locked (finalized).";
    if (!day.quarter) return "Quarter missing.";
    if (day.events.length >= HARDEN.MAX_EVENTS_PER_DAY) return "Daily cap reached.";
    return "—";
  }

  function render() {
    const isToday = (currentIso === todayISO());
    dateTitle.textContent = isToday ? "Today" : "Day";
    dateSub.textContent = `${currentIso} · ${isoToHuman(currentIso)}`;

    // EXP
    const exp = loadExp();
    if (!exp) expText.textContent = "—";
    else {
      const dcount = expDayCount(exp, currentIso);
      expText.textContent = dcount ? `${exp.name} · Day ${dcount}` : exp.name;
    }

    // Quarter buttons
    [...quarterGrid.querySelectorAll("button[data-quarter]")].forEach(btn => {
      const q = btn.getAttribute("data-quarter");
      btn.classList.toggle("selected", q === day.quarter);
      btn.disabled = day.finalized;
    });

    quarterHint.textContent = day.quarter ? `Selected: ${day.quarter}` : "Valitse quarter yhdellä napautuksella.";

    // Event buttons
    const c = countsByType(day.events);
    [...eventGrid.querySelectorAll("button[data-evt]")].forEach(btn => {
      const t = btn.getAttribute("data-evt");
      const atCap = (c[t] || 0) >= HARDEN.MAX_PER_TYPE;

      btn.disabled =
        day.finalized ||
        !day.quarter ||
        day.events.length >= HARDEN.MAX_EVENTS_PER_DAY ||
        atCap;
    });

    // Undo/Finalize
    btnUndo.disabled = day.finalized || day.events.length === 0;
    btnFinalize.disabled = day.finalized;

    // Caps + Close
    const remaining = Math.max(0, HARDEN.MAX_EVENTS_PER_DAY - day.events.length);
    capsText.textContent = `Remaining: ${remaining}`;

    lineWorked.textContent = day.close?.worked ?? "—";
    lineHurt.textContent = day.close?.hurt ?? "—";
    lineTomorrow.textContent = day.close?.tomorrow ?? "—";

    lockHint.textContent = day.finalized
      ? "Locked. Finalize is idempotent; locked days cannot be edited."
      : (!day.quarter ? "Quarter required before logging events." : "");

    applyQuarterTheme();
    lastDisabledWhy = computeDisabledReason();

    // If diagnostics open, live-refresh snapshot
    if (!ovDiag.classList.contains("hidden")) refreshDiagnostics();
  }

  function gotoIso(iso) {
    currentIso = iso;
    day = loadDay(currentIso);
    lastAction = { type: "nav", detail: iso, ts: Date.now() };
    setStatus("", "muted");
    render();
  }

  /* =========================
     ACTIONS
     ========================= */
  function setQuarter(q) {
    if (!allowTap(`q:${q}`)) return;
    if (day.finalized) return;
    if (!QUARTERS.includes(q)) return;

    day.quarter = q;
    saveDay(day);
    lastAction = { type: "setQuarter", detail: q, ts: Date.now() };
    setStatus(`${q} selected.`, "ok");
    render();
  }

  function canLogEvent(t) {
    if (day.finalized) return "Locked.";
    if (!day.quarter) return "Select quarter first.";
    if (day.events.length >= HARDEN.MAX_EVENTS_PER_DAY) return "Daily cap reached.";
    const perType = day.events.filter(e => e.t === t).length;
    if (perType >= HARDEN.MAX_PER_TYPE) return `${t} cap reached.`;
    return null;
  }

  function logEvent(t) {
    if (!allowTap(`evt:${t}`)) return;
    if (!EVT_TYPES.includes(t)) return;

    const why = canLogEvent(t);
    if (why) {
      lastAction = { type: "logDenied", detail: why, ts: Date.now() };
      setStatus(why, "danger");
      render();
      return;
    }

    day.events.push({ t, ts: Date.now() });
    saveDay(day);
    lastAction = { type: "logEvent", detail: t, ts: Date.now() };
    setStatus(`${t} logged.`, "ok");
    render();
  }

  function undo() {
    if (!allowTap("undo")) return;
    if (day.finalized) return;

    const last = day.events.pop();
    saveDay(day);
    lastAction = { type: "undo", detail: last ? last.t : "none", ts: Date.now() };
    setStatus(last ? `Undid ${last.t}.` : "Nothing to undo.", last ? "ok" : "muted");
    render();
  }

  function finalize() {
    if (!allowTap("finalize")) return;

    if (day.finalized) {
      lastAction = { type: "finalize", detail: "idempotent", ts: Date.now() };
      setStatus("Already finalized (idempotent).", "muted");
      render();
      return;
    }

    day.close = summarizeDay(day);
    day.finalized = true;
    saveDay(day);
    lastAction = { type: "finalize", detail: "locked", ts: Date.now() };
    setStatus("Finalized. Locked.", "ok");
    render();
  }

  /* =========================
     OVERLAYS
     ========================= */
  function openReview() {
    if (!allowTap("openReview")) return;
    const s = summarizeLast7Finalized();
    rWorked.textContent = s.worked;
    rHurt.textContent = s.hurt;
    rTomorrow.textContent = s.tomorrow;
    ovReview.classList.remove("hidden");
    lastAction = { type: "openReview", detail: "", ts: Date.now() };
  }

  function closeReview() {
    if (!allowTap("closeReview")) return;
    ovReview.classList.add("hidden");
  }

  function openExp() {
    if (!allowTap("openExp")) return;
    const exp = loadExp();
    [...expGrid.querySelectorAll("button[data-exp]")].forEach(btn => {
      const name = btn.getAttribute("data-exp");
      btn.classList.toggle("selected", !!exp && exp.name === name);
    });
    ovExp.classList.remove("hidden");
    lastAction = { type: "openExp", detail: "", ts: Date.now() };
  }

  function closeExp() {
    if (!allowTap("closeExp")) return;
    ovExp.classList.add("hidden");
  }

  function chooseExp(name) {
    if (!allowTap(`chooseExp:${name}`)) return;
    saveExp(name, todayISO());
    lastAction = { type: "chooseExp", detail: name, ts: Date.now() };
    setStatus(`EXP set: ${name} (Day 1).`, "ok");
    ovExp.classList.add("hidden");
    render();
  }

  function clearExpTapped() {
    if (!allowTap("clearExp")) return;
    clearExp();
    lastAction = { type: "clearExp", detail: "", ts: Date.now() };
    setStatus("EXP cleared.", "ok");
    ovExp.classList.add("hidden");
    render();
  }

  function openDiag() {
    if (!allowTap("openDiag")) return;
    ovDiag.classList.remove("hidden");
    refreshDiagnostics();
    lastAction = { type: "openDiag", detail: "", ts: Date.now() };
  }

  function closeDiag() {
    if (!allowTap("closeDiag")) return;
    ovDiag.classList.add("hidden");
  }

  /* =========================
     DIAGNOSTICS
     ========================= */
  function storageStats() {
    let bytes = 0;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      keys.push(k);
      bytes += (k?.length || 0) + (v?.length || 0);
    }
    keys.sort();
    return { keys, approxChars: bytes };
  }

  function refreshDiagnostics(mcText) {
    const exp = loadExp();
    const c = countsByType(day.events);
    const st = storageStats();

    dState.textContent =
      `iso=${currentIso} | quarter=${day.quarter || "—"} | events=${day.events.length} | finalized=${day.finalized}`;

    dWhy.textContent = lastDisabledWhy;

    dStorage.textContent =
      `keys=${st.keys.length} | approxChars=${st.approxChars}`;

    dJson.textContent = JSON.stringify({
      harden: HARDEN,
      currentIso,
      lastAction,
      disabledReason: lastDisabledWhy,
      exp,
      counts: c,
      day,
      storageKeys: st.keys.slice(0, 50) // cap display
    }, null, 2);

    if (typeof mcText === "string") dMC.textContent = mcText;
  }

  function nukeData() {
    if (!allowTap("nuke")) return;
    // Remove only our namespace
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(LS_DAY_PREFIX) || k === LS_EXP)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    lastAction = { type: "nukeData", detail: `deleted=${toDelete.length}`, ts: Date.now() };
    setStatus("Data cleared (namespace).", "ok");
    gotoIso(todayISO());
    refreshDiagnostics();
  }

  /* =========================
     MONTE CARLO (90 days)
     ========================= */
  function rand() { return Math.random(); }

  // Sample from a categorical distribution: [{k, w}, ...]
  function sampleCat(items) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let r = rand() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.k;
    }
    return items[items.length - 1].k;
  }

  function clampInt(n, lo, hi) {
    n = Math.floor(n);
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  // Poisson-ish without heavy math: sum of Bernoullis for small lambda band
  function approxPoisson(lambda) {
    // For lambda up to ~10; good enough for diagnostic MC.
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }

  function runMonteCarlo90d(opts = {}) {
    const SIMS = clampInt(opts.sims ?? 10000, 1000, 50000);
    const DAYS = 90;

    // Behavior model (tuneable): conservative & plausible
    // - finalizeProbability: probability user finalizes a day they interacted with
    // - openDaysProbability: chance user opens app on a given day
    // - tapsLambda: average number of event taps on an opened day
    // - badRate: probability an event tap is BAD
    // - quarterMissingRate: chance user forgets quarter (then 0 events logged)
    const model = {
      openDaysProbability: opts.openP ?? 0.82,
      finalizeProbability: opts.finP ?? 0.78,
      quarterMissingRate: opts.missQP ?? 0.06,
      tapsLambda: opts.lambda ?? 4.2,
      eventMix: [
        { k: "MIND", w: 1.2 },
        { k: "DEEP", w: 1.0 },
        { k: "BODY", w: 1.3 },
        { k: "FOOD", w: 1.1 },
        { k: "REST", w: 1.0 },
        { k: "BAD",  w: 0.7 }
      ]
    };

    let totalOpenedDays = 0;
    let totalFinalizedDays = 0;
    let totalEvents = 0;

    let capHitDays = 0;
    let perTypeCapHitDays = 0;
    let lockedEditsAttempted = 0;

    let daysWithBad = 0;
    let daysNoRest = 0;

    for (let s = 0; s < SIMS; s++) {
      for (let d = 0; d < DAYS; d++) {
        const opened = rand() < model.openDaysProbability;
        if (!opened) continue;
        totalOpenedDays++;

        const quarterMissing = rand() < model.quarterMissingRate;
        let events = [];
        let finalized = false;

        if (!quarterMissing) {
          // generate taps
          const intended = approxPoisson(model.tapsLambda);
          const intendedClamped = clampInt(intended, 0, HARDEN.MAX_EVENTS_PER_DAY + 50); // allow overflow to test cap

          const counts = Object.fromEntries(EVT_TYPES.map(t => [t, 0]));
          for (let i = 0; i < intendedClamped; i++) {
            const t = sampleCat(model.eventMix);

            // apply caps (like app)
            if (events.length >= HARDEN.MAX_EVENTS_PER_DAY) { capHitDays++; break; }
            if (counts[t] >= HARDEN.MAX_PER_TYPE) { perTypeCapHitDays++; continue; }

            events.push(t);
            counts[t]++;
          }

          totalEvents += events.length;

          const c = counts;
          if (c.BAD > 0) daysWithBad++;
          if (c.REST === 0) daysNoRest++;

          // finalize decision
          finalized = rand() < model.finalizeProbability;
          if (finalized) totalFinalizedDays++;

          // attempt edits after lock (models user stupidity)
          if (finalized && rand() < 0.10) lockedEditsAttempted++;
        } else {
          // quarter missing => user can't log events
          finalized = false;
        }
      }
    }

    // Normalize
    const denomOpened = Math.max(1, totalOpenedDays);
    const denomSimDays = SIMS * DAYS;

    const avgOpenedDays90 = totalOpenedDays / SIMS;
    const avgFinalizedDays90 = totalFinalizedDays / SIMS;
    const avgEventsPerOpenedDay = totalEvents / denomOpened;

    const capHitRatePerOpenedDay = capHitDays / denomOpened;
    const perTypeCapRatePerOpenedDay = perTypeCapHitDays / denomOpened;

    const finalizeRateGivenOpened = totalFinalizedDays / denomOpened;

    const badRateOpenedDays = daysWithBad / denomOpened;
    const noRestRateOpenedDays = daysNoRest / denomOpened;

    const report = [
      `Monte Carlo 90d (SIMS=${SIMS})`,
      `Model: openP=${model.openDaysProbability}, finP=${model.finalizeProbability}, missQP=${model.quarterMissingRate}, lambda=${model.tapsLambda}`,
      ``,
      `Expected opened days / 90: ${avgOpenedDays90.toFixed(1)}`,
      `Expected finalized days / 90: ${avgFinalizedDays90.toFixed(1)}`,
      `Finalize rate | opened day: ${(finalizeRateGivenOpened * 100).toFixed(1)}%`,
      ``,
      `Avg event taps / opened day: ${avgEventsPerOpenedDay.toFixed(2)}`,
      `Cap-hit rate | opened day: ${(capHitRatePerOpenedDay * 100).toFixed(2)}%`,
      `Per-type-cap rate | opened day: ${(perTypeCapRatePerOpenedDay * 100).toFixed(2)}%`,
      ``,
      `Days with BAD | opened day: ${(badRateOpenedDays * 100).toFixed(1)}%`,
      `Days with NO REST | opened day: ${(noRestRateOpenedDays * 100).toFixed(1)}%`,
      ``,
      `Locked edit attempts (modeled): ${(lockedEditsAttempted / denomSimDays * 100).toFixed(2)}% of all sim-days`,
      ``,
      `Interpretation (diagnostic):`,
      `- If cap-hit > ~1–2%, daily cap is probably too low for your real behavior OR you spam.`,
      `- If finalize rate < ~70%, your loop leaks; you are not closing days reliably.`,
      `- NO REST rate is a “missing signal” detector (not a bio claim).`
    ].join("\\n");

    return report;
  }

  /* =========================
     WIRING
     ========================= */
  quarterGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-quarter]");
    if (!btn) return;
    setQuarter(btn.getAttribute("data-quarter"));
  });

  eventGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-evt]");
    if (!btn) return;
    logEvent(btn.getAttribute("data-evt"));
  });

  btnUndo.addEventListener("click", undo);
  btnFinalize.addEventListener("click", finalize);

  btnYesterday.addEventListener("click", () => {
    if (!allowTap("nav:y")) return;
    gotoIso(addDaysISO(currentIso, -1));
  });

  btnToday.addEventListener("click", () => {
    if (!allowTap("nav:t")) return;
    gotoIso(todayISO());
  });

  // Review overlay
  btnReview.addEventListener("click", openReview);
  btnCloseReview.addEventListener("click", closeReview);
  ovReview.addEventListener("click", (e) => { if (e.target === ovReview) closeReview(); });

  // EXP overlay
  btnExp.addEventListener("click", openExp);
  btnCloseExp.addEventListener("click", closeExp);
  ovExp.addEventListener("click", (e) => { if (e.target === ovExp) closeExp(); });
  expGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-exp]");
    if (!btn) return;
    chooseExp(btn.getAttribute("data-exp"));
  });
  btnClearExp.addEventListener("click", clearExpTapped);

  // Diagnostics overlay
  btnDiag.addEventListener("click", openDiag);
  btnCloseDiag.addEventListener("click", closeDiag);
  ovDiag.addEventListener("click", (e) => { if (e.target === ovDiag) closeDiag(); });

  btnRunMC.addEventListener("click", () => {
    if (!allowTap("runMC")) return;
    const rep = runMonteCarlo90d({ sims: 10000 });
    refreshDiagnostics(rep);
  });

  btnClearAll.addEventListener("click", nukeData);

  // Defensive: block dblclick zoom weirdness
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  /* =========================
     INIT
     ========================= */
  render();
  setStatus("");
})();
