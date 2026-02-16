(() => {
  "use strict";

  /* =========================
     MODEL
     ========================= */
  const EVT = Object.freeze([
    "DECISION_MADE",
    "DECISION_DEFERRED",
    "DECISION_AVOIDED",
    "EXECUTION",
    "CONTEXT_SHIFT",
    "DRAG"
  ]);

  const BELIEFS = Object.freeze(["EXECUTION", "ENVIRONMENT", "ENERGY", "CLARITY"]);
  const EVIDENCE = Object.freeze(["STRONGER", "SAME", "WEAKER"]);

  const HARDEN = Object.freeze({
    GLOBAL_MIN_INTERVAL_MS: 220,
    PER_BUTTON_COOLDOWN_MS: 360,
    MAX_EVENTS_PER_DAY: 18,
    MAX_PER_TYPE: 5
  });

  const LS_ROOT = "decisionLedger.final";
  const LS_DAY_PREFIX   = `${LS_ROOT}.day.`;       // + YYYY-MM-DD
  const LS_BELIEF       = `${LS_ROOT}.belief`;     // string
  const LS_BELIEF_LOG   = `${LS_ROOT}.beliefLog`;  // array of {iso, evidence, ts}

  /* =========================
     DOM
     ========================= */
  const $ = (id) => document.getElementById(id);

  const beliefTicker = $("beliefTicker");

  const dateTitle = $("dateTitle");
  const dateSub   = $("dateSub");

  const btnYesterday = $("btnYesterday");
  const btnToday     = $("btnToday");

  const eventGrid   = $("eventGrid");
  const btnUndo     = $("btnUndo");
  const btnFinalize = $("btnFinalize");

  const statusText  = $("statusText");
  const capsText    = $("capsText");

  const lineMoved   = $("lineMoved");
  const lineDrag    = $("lineDrag");
  const lineNext    = $("lineNext");
  const lockHint    = $("lockHint");

  // Review
  const btnReview      = $("btnReview");
  const ovReview       = $("ovReview");
  const btnCloseReview = $("btnCloseReview");
  const rMoved         = $("rMoved");
  const rDrag          = $("rDrag");
  const rNext          = $("rNext");

  // Belief
  const btnBelief      = $("btnBelief");
  const beliefText     = $("beliefText");
  const ovBelief       = $("ovBelief");
  const btnCloseBelief = $("btnCloseBelief");
  const beliefGrid     = $("beliefGrid");
  const evidenceGrid   = $("evidenceGrid");

  // Diag
  const btnDiag        = $("btnDiag");
  const ovDiag         = $("ovDiag");
  const btnCloseDiag   = $("btnCloseDiag");
  const diagText       = $("diagText");
  const btnResetToday  = $("btnResetToday");

  /* =========================
     TIME (Europe/Helsinki)
     ========================= */
  function fmtISO(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  }
  function todayISO() { return fmtISO(new Date()); }
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
  function helsinkiTimeHHMM() {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date());
  }

  /* =========================
     STORAGE / SCHEMA
     ========================= */
  function safeParse(raw) { try { return JSON.parse(raw); } catch { return null; } }
  function clampLine(s) {
    const str = String(s ?? "—");
    return str.length <= 80 ? str : (str.slice(0, 77) + "…");
  }

  function emptyDay(iso) {
    return {
      iso,
      events: [], // {t, ts}
      finalized: false,
      close: { moved: "—", drag: "—", next: "—" }
    };
  }

  function loadDay(iso) {
    const raw = localStorage.getItem(LS_DAY_PREFIX + iso);
    if (!raw) return emptyDay(iso);
    const obj = safeParse(raw);
    if (!obj || obj.iso !== iso) return emptyDay(iso);

    if (!Array.isArray(obj.events)) obj.events = [];
    obj.events = obj.events
      .filter(e => e && EVT.includes(e.t) && Number.isFinite(e.ts))
      .slice(0, HARDEN.MAX_EVENTS_PER_DAY);

    obj.finalized = !!obj.finalized;

    if (!obj.close || typeof obj.close !== "object") obj.close = emptyDay(iso).close;
    obj.close.moved = clampLine(obj.close.moved ?? "—");
    obj.close.drag  = clampLine(obj.close.drag  ?? "—");
    obj.close.next  = clampLine(obj.close.next  ?? "—");
    return obj;
  }

  function saveDay(day) {
    localStorage.setItem(LS_DAY_PREFIX + day.iso, JSON.stringify(day));
  }

  function loadBelief() {
    const b = localStorage.getItem(LS_BELIEF);
    return BELIEFS.includes(b) ? b : null;
  }
  function saveBelief(b) {
    if (!BELIEFS.includes(b)) return;
    localStorage.setItem(LS_BELIEF, b);
  }

  function loadBeliefLog() {
    const raw = localStorage.getItem(LS_BELIEF_LOG);
    const arr = safeParse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(x => x && typeof x.iso === "string" && EVIDENCE.includes(x.evidence) && Number.isFinite(x.ts))
      .slice(-200);
  }

  function appendBeliefEvidence(iso, evidence) {
    if (!EVIDENCE.includes(evidence)) return;
    const arr = loadBeliefLog();
    arr.push({ iso, evidence, ts: Date.now() });
    localStorage.setItem(LS_BELIEF_LOG, JSON.stringify(arr));
  }

  function lastEvidenceLabel() {
    const arr = loadBeliefLog();
    const last = arr[arr.length - 1];
    if (!last) return "—";
    if (last.evidence === "STRONGER") return "Stronger";
    if (last.evidence === "SAME") return "Same";
    if (last.evidence === "WEAKER") return "Weaker";
    return "—";
  }

  function nukeNamespace() {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(LS_DAY_PREFIX) || k === LS_BELIEF || k === LS_BELIEF_LOG) toDelete.push(k);
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
     CLOSE LOGIC
     ========================= */
  function countsByType(events) {
    const c = Object.fromEntries(EVT.map(t => [t, 0]));
    for (const e of events) c[e.t] = (c[e.t] || 0) + 1;
    return c;
  }

  function summarizeDay(day) {
    const c = countsByType(day.events);

    const moved = [];
    if (c.DECISION_MADE > 0) moved.push("DECISIONS MADE");
    if (c.EXECUTION > 0) moved.push("EXECUTION");
    if (c.CONTEXT_SHIFT > 0) moved.push("CONTEXT SHIFT");

    const drag = [];
    if (c.DECISION_DEFERRED > 0) drag.push("DEFERRED");
    if (c.DECISION_AVOIDED > 0) drag.push("AVOIDED");
    if (c.DRAG > 0) drag.push("DRAG");

    let next = "Make one irreversible decision.";
    if (c.DECISION_AVOIDED > 0) next = "Face the avoided decision.";
    else if (c.DECISION_DEFERRED > 0) next = "Close one deferred loop.";
    else if (c.DECISION_MADE === 0) next = "Make one decision and execute one step.";

    return {
      moved: clampLine(moved.length ? moved.join(" · ") : "—"),
      drag:  clampLine(drag.length ? drag.join(" · ") : "—"),
      next:  clampLine(next)
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
      .sort((a, b) => (a.iso < b.iso ? 1 : -1));

    const last7 = days.slice(0, 7);
    if (last7.length === 0) return { moved: "—", drag: "—", next: "—" };

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

    const movedTop = topN(tally(last7.map(d => d.close?.moved || "—")), 4);
    const dragTop  = topN(tally(last7.map(d => d.close?.drag  || "—")), 4);

    const moved = movedTop.length ? movedTop.join(" · ") : "—";
    const drag  = dragTop.length ? dragTop.join(" · ") : "—";

    let next = "Close one loop per day.";
    if (dragTop.includes("AVOIDED")) next = "Identify and face one avoided decision.";
    else if (dragTop.includes("DEFERRED")) next = "Close one deferred decision daily.";
    else if (movedTop.length === 0) next = "Make one decision, execute one step.";

    return { moved: clampLine(moved), drag: clampLine(drag), next: clampLine(next) };
  }

  /* =========================
     FINAL DIAGNOSTIC (Ghost ↔ Presence)
     ========================= */
  function computePresence01() {
    let opened = 0;
    let finalized = 0;
    let avoided = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_DAY_PREFIX)) continue;

      const d = safeParse(localStorage.getItem(k));
      if (!d || !Array.isArray(d.events)) continue;

      if (d.events.length > 0) opened++;
      if (d.finalized) finalized++;

      avoided += d.events.filter(e => e && e.t === "DECISION_AVOIDED").length;
    }

    if (opened === 0) return null;

    const penalty = avoided * 0.5;
    const score = finalized / (opened + penalty);
    return Math.max(0, Math.min(1, score));
  }

  function renderPresenceBar(score01) {
    if (score01 === null) {
      return "No signal yet.\nLog and close days.";
    }

    const slots = 16;
    const pos = Math.round(score01 * slots);

    let bar = "Ghost You ";
    for (let i = 0; i <= slots; i++) bar += (i === pos ? "▲" : "─");
    bar += " Presence You";

    const label =
      score01 > 0.75 ? "Days are being closed."
      : score01 > 0.40 ? "Inconsistent ownership."
      : "Days are being left open.";

    return `${bar}\n${label}`;
  }

  function renderDiagnostic() {
    const s = computePresence01();
    diagText.textContent = renderPresenceBar(s);
  }

  /* =========================
     TICKER (no continuous animation)
     ========================= */
  function updateTicker() {
    const b = loadBelief() || "—";
    const ev = lastEvidenceLabel();
    const t = helsinkiTimeHHMM();
    beliefTicker.textContent = `I believe: ${b} · Evidence: ${ev} · ${t}`;
  }

  /* =========================
     STATE
     ========================= */
  let currentIso = todayISO();
  let day = loadDay(currentIso);

  function setStatus(msg, kind = "muted") {
    statusText.textContent = msg || "";
    statusText.style.color =
      kind === "ok" ? "var(--ok)" :
      kind === "danger" ? "var(--danger)" :
      "var(--muted)";
  }

  function render() {
    const isToday = (currentIso === todayISO());
    dateTitle.textContent = isToday ? "Today" : "Day";
    dateSub.textContent = `${currentIso} · ${isoToHuman(currentIso)}`;

    const belief = loadBelief();
    beliefText.textContent = belief ? belief : "—";

    const c = countsByType(day.events);
    [...eventGrid.querySelectorAll("button[data-evt]")].forEach(btn => {
      const t = btn.getAttribute("data-evt");
      const perType = c[t] || 0;
      btn.disabled = day.finalized ||
        day.events.length >= HARDEN.MAX_EVENTS_PER_DAY ||
        perType >= HARDEN.MAX_PER_TYPE;
    });

    btnUndo.disabled = day.finalized || day.events.length === 0;
    btnFinalize.disabled = day.finalized;

    const remaining = Math.max(0, HARDEN.MAX_EVENTS_PER_DAY - day.events.length);
    capsText.textContent = `Remaining: ${remaining}`;

    lineMoved.textContent = day.close?.moved ?? "—";
    lineDrag.textContent  = day.close?.drag  ?? "—";
    lineNext.textContent  = day.close?.next  ?? "—";

    lockHint.textContent = day.finalized
      ? "Locked. Finalize is idempotent; locked days cannot be edited."
      : "";

    updateTicker();

    if (!ovDiag.classList.contains("hidden")) renderDiagnostic();
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
  function canLogEvent(t) {
    if (day.finalized) return "Locked.";
    if (day.events.length >= HARDEN.MAX_EVENTS_PER_DAY) return "Daily cap reached.";
    const perType = day.events.filter(e => e.t === t).length;
    if (perType >= HARDEN.MAX_PER_TYPE) return `${t} cap reached.`;
    return null;
  }

  function logEvent(t) {
    if (!allowTap(`evt:${t}`)) return;
    if (!EVT.includes(t)) return;

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
    rMoved.textContent = s.moved;
    rDrag.textContent  = s.drag;
    rNext.textContent  = s.next;
    ovReview.classList.remove("hidden");
  }
  function closeReview() {
    if (!allowTap("closeReview")) return;
    ovReview.classList.add("hidden");
  }

  function openBelief() {
    if (!allowTap("openBelief")) return;
    const b = loadBelief();
    [...beliefGrid.querySelectorAll("button[data-belief]")].forEach(btn => {
      btn.classList.toggle("selected", btn.getAttribute("data-belief") === b);
    });
    ovBelief.classList.remove("hidden");
  }
  function closeBelief() {
    if (!allowTap("closeBelief")) return;
    ovBelief.classList.add("hidden");
  }
  function chooseBelief(b) {
    if (!allowTap(`belief:${b}`)) return;
    saveBelief(b);
    setStatus(`Belief set: ${b}`, "ok");
    render();
  }
  function logEvidence(ev) {
    if (!allowTap(`evidence:${ev}`)) return;
    appendBeliefEvidence(currentIso, ev);
    setStatus(`Evidence: ${ev}`, "ok");
    render();
  }

  function openDiag() {
    if (!allowTap("openDiag")) return;
    ovDiag.classList.remove("hidden");
    renderDiagnostic();
  }
  function closeDiag() {
    if (!allowTap("closeDiag")) return;
    ovDiag.classList.add("hidden");
  }

  function resetForToday() {
    if (!allowTap("resetToday")) return;
    const deleted = nukeNamespace();
    currentIso = todayISO();
    day = loadDay(currentIso);
    setStatus(`Reset complete. (cleared ${deleted} keys)`, "ok");
    ovDiag.classList.add("hidden");
    render();
  }

  /* =========================
     WIRING
     ========================= */
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

  btnBelief.addEventListener("click", openBelief);
  btnCloseBelief.addEventListener("click", closeBelief);
  ovBelief.addEventListener("click", (e) => { if (e.target === ovBelief) closeBelief(); });

  beliefGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-belief]");
    if (!btn) return;
    chooseBelief(btn.getAttribute("data-belief"));
  });

  evidenceGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-evidence]");
    if (!btn) return;
    logEvidence(btn.getAttribute("data-evidence"));
  });

  btnDiag.addEventListener("click", openDiag);
  btnCloseDiag.addEventListener("click", closeDiag);
  ovDiag.addEventListener("click", (e) => { if (e.target === ovDiag) closeDiag(); });

  btnResetToday.addEventListener("click", resetForToday);

  // Defensive: block dblclick zoom quirks
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  // “Real-time” ticker update without continuous animation.
  window.addEventListener("focus", updateTicker);
  setInterval(updateTicker, 60_000);

  /* =========================
     INIT
     ========================= */
  render();
  setStatus("");
})();
