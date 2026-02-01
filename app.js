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
  const QUARTERS  = Object.freeze(["Q1", "Q2", "Q3", "Q4"]);

  const LS_ROOT      = "bioClose.v5";
  const LS_DAY_PREFIX= `${LS_ROOT}.day.`;   // + YYYY-MM-DD
  const LS_EXP       = `${LS_ROOT}.exp`;    // {name, startIso}
  const LS_START     = `${LS_ROOT}.start`;  // {startIso} optional

  /* =========================
     DOM
     ========================= */
  const $ = (id) => document.getElementById(id);

  const dateTitle = $("dateTitle");
  const dateSub   = $("dateSub");

  const btnYesterday = $("btnYesterday");
  const btnToday     = $("btnToday");

  const quarterGrid  = $("quarterGrid");
  const quarterHint  = $("quarterHint");

  const eventGrid    = $("eventGrid");
  const btnUndo      = $("btnUndo");
  const btnFinalize  = $("btnFinalize");

  const statusText   = $("statusText");
  const capsText     = $("capsText");

  const lineWorked   = $("lineWorked");
  const lineHurt     = $("lineHurt");
  const lineTomorrow = $("lineTomorrow");
  const lockHint     = $("lockHint");

  // Review
  const btnReview      = $("btnReview");
  const ovReview       = $("ovReview");
  const btnCloseReview = $("btnCloseReview");
  const rWorked        = $("rWorked");
  const rHurt          = $("rHurt");
  const rTomorrow      = $("rTomorrow");

  // Exp
  const btnExp       = $("btnExp");
  const expText      = $("expText");
  const ovExp        = $("ovExp");
  const btnCloseExp  = $("btnCloseExp");
  const expGrid      = $("expGrid");
  const btnClearExp  = $("btnClearExp");

  // Diag
  const btnDiag         = $("btnDiag");
  const ovDiag          = $("ovDiag");
  const btnCloseDiag    = $("btnCloseDiag");
  const dLabel          = $("dLabel");
  const dBar            = $("dBar");
  const btnRunMC        = $("btnRunMC");
  const btnResetTomorrow= $("btnResetTomorrow");

  /* =========================
     TIME (Europe/Helsinki)
     ========================= */
  function fmtISO(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  }

  function todayISO() {
    return fmtISO(new Date());
  }

  function addDaysISO(iso, deltaDays) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + deltaDays);
    return fmtISO(d);
  }

  function isoToHuman(iso) {
    const d = new Date(iso + "T12:00:00");
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki",
      weekday: "short", year: "numeric", month: "short", day: "numeric"
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
    obj.close.worked   = clampLine(obj.close.worked ?? "—");
    obj.close.hurt     = clampLine(obj.close.hurt ?? "—");
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

  function loadStartIso() {
    const raw = localStorage.getItem(LS_START);
    if (!raw) return null;
    const obj = safeParse(raw);
    if (!obj || typeof obj.startIso !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.startIso)) return null;
    return obj.startIso;
  }

  function saveStartIso(startIso) {
    localStorage.setItem(LS_START, JSON.stringify({ startIso }));
  }

  function nukeNamespace() {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(LS_DAY_PREFIX) || k === LS_EXP || k === LS_START) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    return toDelete.length;
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
     LOGIC
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
    const hurtTop   = topN(tally(last7.map(d => d.close?.hurt || "—")), 4);

    const worked = workedTop.length ? workedTop.join(" · ") : "—";
    const hurt   = hurtTop.length ? hurtTop.join(" · ") : "—";

    let tomorrow = "Repeat top worked domains.";
    if (hurtTop.includes("NO REST")) tomorrow = "Fix REST first.";
    else if (hurtTop.includes("BAD")) tomorrow = "Remove BAD trigger path.";
    else if (workedTop.length === 0) tomorrow = "Make 1 deliberate log per day.";
    else tomorrow = "Keep taps deliberate; do not spam.";

    return { worked: clampLine(worked), hurt: clampLine(hurt), tomorrow: clampLine(tomorrow) };
  }

  /* =========================
     GHOST ↔ PRESENCE DIAGNOSTIC
     ========================= */
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function observedPresenceScore01() {
    // "Opened" = any day with quarter chosen OR any events OR finalized.
    // Presence = finalized/opened. Conservative; ignores "good" content.
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_DAY_PREFIX)) keys.push(k);
    }
    if (!keys.length) return null;

    let opened = 0;
    let finalized = 0;

    for (const k of keys) {
      const d = safeParse(localStorage.getItem(k));
      if (!d || typeof d !== "object") continue;
      const hasOpenSignal =
        !!d.finalized ||
        (typeof d.quarter === "string" && d.quarter) ||
        (Array.isArray(d.events) && d.events.length > 0);
      if (hasOpenSignal) opened++;
      if (d.finalized) finalized++;
    }
    if (opened === 0) return null;
    return clamp01(finalized / opened);
  }

  function barWithMarkers(obs01, mc01) {
    // 20-slot bar: left=Ghost, right=Presence
    const slots = 20;
    const obsPos = obs01 == null ? null : Math.round(obs01 * slots);
    const mcPos  = mc01  == null ? null : Math.round(mc01  * slots);

    let line = "Ghost You ";
    for (let i = 0; i <= slots; i++) {
      let ch = "—";
      if (obsPos !== null && i === obsPos) ch = "▲";   // observed marker
      if (mcPos !== null && i === mcPos)  ch = (ch === "▲" ? "◆" : "◇"); // MC marker
      line += ch;
    }
    line += " Presence You";

    const legend = [
      obs01 == null ? "▲ you: no data yet" : `▲ you: ${(obs01*100).toFixed(0)}% presence`,
      mc01  == null ? "◇ mc: not run"      : `◇ mc(90d): ${(mc01*100).toFixed(0)}% expected`
    ].join(" | ");

    return `${line}\n${legend}`;
  }

  /* =========================
     MONTE CARLO (90d) -> expected presence score
     ========================= */
  function rand() { return Math.random(); }
  function approxPoisson(lambda) {
    // Good enough for diagnostic simulation.
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  function sampleCat(items) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let r = rand() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.k;
    }
    return items[items.length - 1].k;
  }

  function runMonteCarlo90dPresence01(sims = 10000) {
    const SIMS = Math.max(1000, Math.min(50000, Math.floor(sims)));
    const DAYS = 90;

    // Behavior model: conservative defaults (tune only in code).
    const model = {
      openP: 0.82,      // chance app opened on a day
      finP:  0.78,      // finalize probability when opened and usable
      missQP:0.06,      // quarter missing probability -> unusable day
      lambda:4.2,       // mean taps on an opened day
      eventMix: [
        { k: "MIND", w: 1.2 },
        { k: "DEEP", w: 1.0 },
        { k: "BODY", w: 1.3 },
        { k: "FOOD", w: 1.1 },
        { k: "REST", w: 1.0 },
        { k: "BAD",  w: 0.7 }
      ]
    };

    let openedDays = 0;
    let finalizedDays = 0;

    for (let s = 0; s < SIMS; s++) {
      for (let d = 0; d < DAYS; d++) {
        const opened = rand() < model.openP;
        if (!opened) continue;
        openedDays++;

        const quarterMissing = rand() < model.missQP;
        if (quarterMissing) continue;

        // simulate taps to stress caps (but presence score uses finalize/opened)
        const intended = approxPoisson(model.lambda);
        const counts = Object.fromEntries(EVT_TYPES.map(t => [t, 0]));
        let total = 0;
        for (let i = 0; i < intended + 30; i++) { // allow overflow to test caps
          const t = sampleCat(model.eventMix);
          if (total >= HARDEN.MAX_EVENTS_PER_DAY) break;
          if (counts[t] >= HARDEN.MAX_PER_TYPE) continue;
          counts[t]++; total++;
        }

        const finalized = rand() < model.finP;
        if (finalized) finalizedDays++;
      }
    }

    if (openedDays === 0) return null;
    return clamp01(finalizedDays / openedDays);
  }

  /* =========================
     STATE
     ========================= */
  let currentIso;
  let day;

  // Cache MC once per run; never auto-run (no background work).
  let mcPresence01 = null;

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

    quarterHint.textContent = day.quarter ? `Selected: ${day.quarter}` : "Select quarter with one tap.";

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

    // Caps
    const remaining = Math.max(0, HARDEN.MAX_EVENTS_PER_DAY - day.events.length);
    capsText.textContent = `Remaining: ${remaining}`;

    // Close
    lineWorked.textContent   = day.close?.worked ?? "—";
    lineHurt.textContent     = day.close?.hurt ?? "—";
    lineTomorrow.textContent = day.close?.tomorrow ?? "—";

    lockHint.textContent = day.finalized
      ? "Locked. Finalize is idempotent; locked days cannot be edited."
      : (!day.quarter ? "Quarter required before logging events." : "");

    applyQuarterTheme();

    // If diagnostics open, refresh diagram
    if (!ovDiag.classList.contains("hidden")) refreshDiag();
  }

  function gotoIso(iso) {
    currentIso = iso;
    day = loadDay(currentIso);
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
    if (why) { setStatus(why, "danger"); render(); return; }

    day.events.push({ t, ts: Date.now() });
    saveDay(day);
    setStatus(`${t} logged.`, "ok");
    render();
  }

  function undo() {
    if (!allowTap("undo")) return;
    if (day.finalized) return;

    const last = day.events.pop();
    saveDay(day);
    setStatus(last ? `Undid ${last.t}.` : "Nothing to undo.", last ? "ok" : "muted");
    render();
  }

  function finalize() {
    if (!allowTap("finalize")) return;

    if (day.finalized) {
      setStatus("Already finalized (idempotent).", "muted");
      render();
      return;
    }

    day.close = summarizeDay(day);
    day.finalized = true;
    saveDay(day);

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
  }

  function closeExp() {
    if (!allowTap("closeExp")) return;
    ovExp.classList.add("hidden");
  }

  function chooseExp(name) {
    if (!allowTap(`chooseExp:${name}`)) return;

    // If a startIso is set (e.g., tomorrow), use it. Else use today.
    const startIso = loadStartIso() || todayISO();
    saveExp(name, startIso);

    setStatus(`EXP set: ${name} (start ${startIso}).`, "ok");
    ovExp.classList.add("hidden");
    render();
  }

  function clearExpTapped() {
    if (!allowTap("clearExp")) return;
    clearExp();
    setStatus("EXP cleared.", "ok");
    ovExp.classList.add("hidden");
    render();
  }

  function openDiag() {
    if (!allowTap("openDiag")) return;
    ovDiag.classList.remove("hidden");
    refreshDiag();
  }

  function closeDiag() {
    if (!allowTap("closeDiag")) return;
    ovDiag.classList.add("hidden");
  }

  /* =========================
     DIAGNOSTIC RENDER
     ========================= */
  function refreshDiag() {
    const obs01 = observedPresenceScore01();
    const text = barWithMarkers(obs01, mcPresence01);

    dBar.textContent = text;

    if (obs01 == null && mcPresence01 == null) {
      dLabel.textContent = "No data yet.";
    } else if (obs01 != null && mcPresence01 == null) {
      dLabel.textContent = `You so far: ${(obs01*100).toFixed(0)}% presence`;
    } else if (obs01 == null && mcPresence01 != null) {
      dLabel.textContent = `Monte Carlo expected: ${(mcPresence01*100).toFixed(0)}% presence`;
    } else {
      dLabel.textContent = `You: ${(obs01*100).toFixed(0)}% | MC(90d): ${(mcPresence01*100).toFixed(0)}%`;
    }
  }

  /* =========================
     RESET FOR TOMORROW
     ========================= */
  function resetForTomorrow() {
    if (!allowTap("resetTomorrow")) return;

    const tomorrow = addDaysISO(todayISO(), 1);
    const deleted = nukeNamespace();

    // Set startIso to tomorrow so EXP day count begins tomorrow.
    saveStartIso(tomorrow);

    // Also set view to tomorrow (so when you open it tomorrow, it already points there).
    currentIso = tomorrow;
    day = loadDay(currentIso);

    // Clear MC cache.
    mcPresence01 = null;

    setStatus(`Reset. Start = ${tomorrow}. (cleared ${deleted} keys)`, "ok");
    ovDiag.classList.add("hidden");
    render();
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

  btnReview.addEventListener("click", openReview);
  btnCloseReview.addEventListener("click", closeReview);
  ovReview.addEventListener("click", (e) => { if (e.target === ovReview) closeReview(); });

  btnExp.addEventListener("click", openExp);
  btnCloseExp.addEventListener("click", closeExp);
  ovExp.addEventListener("click", (e) => { if (e.target === ovExp) closeExp(); });
  expGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-exp]");
    if (!btn) return;
    chooseExp(btn.getAttribute("data-exp"));
  });
  btnClearExp.addEventListener("click", clearExpTapped);

  btnDiag.addEventListener("click", openDiag);
  btnCloseDiag.addEventListener("click", closeDiag);
  ovDiag.addEventListener("click", (e) => { if (e.target === ovDiag) closeDiag(); });

  btnRunMC.addEventListener("click", () => {
    if (!allowTap("runMC")) return;
    // Run once on demand; no background loops.
    mcPresence01 = runMonteCarlo90dPresence01(10000);
    refreshDiag();
  });

  btnResetTomorrow.addEventListener("click", resetForTomorrow);

  // Defensive: block dblclick zoom quirks
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  /* =========================
     INIT
     ========================= */
  const startIso = loadStartIso();
  const tISO = todayISO();

  // If you reset for tomorrow, opening today should point at tomorrow (start day).
  if (startIso && startIso > tISO) {
    currentIso = startIso;
  } else {
    currentIso = tISO;
  }

  day = loadDay(currentIso);
  render();
  setStatus("");
})();
