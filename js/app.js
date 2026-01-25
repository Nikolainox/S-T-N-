(() => {
  "use strict";

  const HARDEN = Object.freeze({
    GLOBAL_MIN_INTERVAL_MS: 220,
    PER_BUTTON_COOLDOWN_MS: 360,
    MAX_EVENTS_PER_DAY: 24,
    MAX_PER_TYPE: 6
  });

  const EVT_TYPES = Object.freeze(["MIND", "DEEP", "BODY", "FOOD", "REST", "BAD"]);
  const QUARTERS = Object.freeze(["Q1", "Q2", "Q3", "Q4"]);

  const LS_ROOT = "bioClose.v2";
  const LS_EXP = `${LS_ROOT}.exp`; // {name, startIso}
  const LS_DAY_PREFIX = `${LS_ROOT}.day.`; // + YYYY-MM-DD

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

  const btnReview = $("btnReview");
  const overlayReview = $("overlayReview");
  const btnCloseReview = $("btnCloseReview");
  const rWorked = $("rWorked");
  const rHurt = $("rHurt");
  const rTomorrow = $("rTomorrow");

  const btnExp = $("btnExp");
  const expText = $("expText");
  const overlayExp = $("overlayExp");
  const btnCloseExp = $("btnCloseExp");
  const expGrid = $("expGrid");
  const btnClearExp = $("btnClearExp");

  function todayISOInHelsinki() {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return fmt.format(new Date());
  }

  function isoToHuman(iso) {
    const d = new Date(iso + "T12:00:00");
    const fmt = new Intl.DateTimeFormat("fi-FI", {
      timeZone: "Europe/Helsinki",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    return fmt.format(d);
  }

  function addDaysISO(iso, deltaDays) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + deltaDays);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return fmt.format(d);
  }

  function emptyDay(iso) {
    return {
      iso,
      quarter: null,
      events: [],
      finalized: false,
      close: { worked: "—", hurt: "—", tomorrow: "—" }
    };
  }

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function clampLine(s) {
    const str = String(s ?? "—");
    if (str.length <= 80) return str;
    return str.slice(0, 77) + "…";
  }

  function loadDay(iso) {
    const raw = localStorage.getItem(LS_DAY_PREFIX + iso);
    if (!raw) return emptyDay(iso);
    const obj = safeParse(raw);
    if (!obj || obj.iso !== iso) return emptyDay(iso);

    if (!QUARTERS.includes(obj.quarter)) obj.quarter = null;

    if (!Array.isArray(obj.events)) obj.events = [];
    obj.events = obj.events
      .filter(e => e && EVT_TYPES.includes(e.t) && Number.isFinite(e.ts))
      .slice(0, HARDEN.MAX_EVENTS_PER_DAY);

    if (typeof obj.finalized !== "boolean") obj.finalized = false;
    if (!obj.close || typeof obj.close !== "object") obj.close = { worked: "—", hurt: "—", tomorrow: "—" };

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
    if (!Number.isFinite(days) || days < 1) return null;
    return days;
  }

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

  function summarizeDay(day) {
    const counts = Object.fromEntries(EVT_TYPES.map(t => [t, 0]));
    for (const e of day.events) counts[e.t] = (counts[e.t] || 0) + 1;

    const worked = [];
    for (const t of ["MIND", "DEEP", "BODY", "FOOD", "REST"]) {
      if (counts[t] > 0) worked.push(t);
    }
    const workedLine = worked.length ? worked.join(" · ") : "—";

    const hurt = [];
    if (counts.BAD > 0) hurt.push("BAD");
    if (counts.REST === 0) hurt.push("NO REST");
    if (counts.FOOD === 0) hurt.push("NO FOOD LOG");
    const hurtLine = hurt.length ? hurt.join(" · ") : "—";

    let tomorrow = "Repeat what worked.";
    if (counts.REST === 0) tomorrow = "Protect REST (log it once).";
    else if (counts.BAD > 0) tomorrow = "Remove BAD trigger path; keep taps deliberate.";
    else if (worked.length === 0) tomorrow = "Log 1 real event (not spam).";
    else tomorrow = "Do the minimum that repeats worked domains.";

    return {
      worked: clampLine(workedLine),
      hurt: clampLine(hurtLine),
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
      .sort((a, b) => (a.iso < b.iso ? 1 : -1));

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

  let currentIso = todayISOInHelsinki();
  let day = loadDay(currentIso);

  function setStatus(msg, kind = "muted") {
    statusText.textContent = msg || "";
    statusText.style.color =
      kind === "ok" ? "var(--ok)" :
      kind === "danger" ? "var(--danger)" :
      "var(--muted)";
  }

  function countsByType() {
    const counts = Object.fromEntries(EVT_TYPES.map(t => [t, 0]));
    for (const e of day.events) counts[e.t] = (counts[e.t] || 0) + 1;
    return counts;
  }

  function updateCaps() {
    const total = day.events.length;
    const remaining = Math.max(0, HARDEN.MAX_EVENTS_PER_DAY - total);
    capsText.textContent = `Remaining: ${remaining}`;
  }

  function applyQuarterTheme() {
    document.body.setAttribute("data-q", day.quarter || "");
  }

  function render() {
    const isToday = (currentIso === todayISOInHelsinki());
    dateTitle.textContent = isToday ? "Today" : "Day";
    dateSub.textContent = `${currentIso} · ${isoToHuman(currentIso)}`;

    const exp = loadExp();
    if (!exp) {
      expText.textContent = "—";
    } else {
      const dcount = expDayCount(exp, currentIso);
      expText.textContent = dcount ? `${exp.name} · Day ${dcount}` : exp.name;
    }

    [...quarterGrid.querySelectorAll("button")].forEach(btn => {
      const q = btn.getAttribute("data-quarter");
      btn.classList.toggle("selected", q === day.quarter);
      btn.disabled = day.finalized;
    });

    quarterHint.textContent = day.quarter ? `Selected: ${day.quarter}` : "Valitse quarter yhdellä napautuksella.";

    const counts = countsByType();
    [...eventGrid.querySelectorAll("button")].forEach(btn => {
      const t = btn.getAttribute("data-evt");
      const atCap = (counts[t] || 0) >= HARDEN.MAX_PER_TYPE;
      btn.disabled = day.finalized || !day.quarter || day.events.length >= HARDEN.MAX_EVENTS_PER_DAY || atCap;
    });

    btnUndo.disabled = day.finalized || day.events.length === 0;
    btnFinalize.disabled = day.finalized;

    lineWorked.textContent = day.close?.worked ?? "—";
    lineHurt.textContent = day.close?.hurt ?? "—";
    lineTomorrow.textContent = day.close?.tomorrow ?? "—";

    lockHint.textContent = day.finalized
      ? "Locked. Finalize on idempotent; this day cannot be edited."
      : (day.quarter ? "" : "Quarter required before logging events.");

    updateCaps();
    applyQuarterTheme();
  }

  function gotoIso(iso) {
    currentIso = iso;
    day = loadDay(currentIso);
    setStatus("");
    render();
  }

  function canLogEvent(type) {
    if (day.finalized) return { ok: false, reason: "Locked." };
    if (!day.quarter) return { ok: false, reason: "Select quarter first." };
    if (day.events.length >= HARDEN.MAX_EVENTS_PER_DAY) return { ok: false, reason: "Daily cap reached." };

    const perType = day.events.filter(e => e.t === type).length;
    if (perType >= HARDEN.MAX_PER_TYPE) return { ok: false, reason: `${type} cap reached.` };
    return { ok: true, reason: "" };
  }

  function logEvent(type) {
    const key = `evt:${type}`;
    if (!allowTap(key)) return;

    const gate = canLogEvent(type);
    if (!gate.ok) { setStatus(gate.reason, "danger"); return; }

    day.events.push({ t: type, ts: Date.now() });
    saveDay(day);
    setStatus(`${type} logged.`, "ok");
    render();
  }

  function setQuarter(q) {
    const key = `q:${q}`;
    if (!allowTap(key)) return;
    if (day.finalized) return;
    if (!QUARTERS.includes(q)) return;

    day.quarter = q;
    saveDay(day);
    setStatus(`${q} selected.`, "ok");
    render();
  }

  function undo() {
    if (!allowTap("undo")) return;
    if (day.finalized) return;

    const last = day.events.pop();
    if (!last) { setStatus("Nothing to undo.", "muted"); render(); return; }

    saveDay(day);
    setStatus(`Undid ${last.t}.`, "ok");
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

  function openReview() {
    if (!allowTap("review")) return;
    const s = summarizeLast7Finalized();
    rWorked.textContent = s.worked;
    rHurt.textContent = s.hurt;
    rTomorrow.textContent = s.tomorrow;
    overlayReview.classList.remove("hidden");
  }

  function closeReview() {
    if (!allowTap("closeReview")) return;
    overlayReview.classList.add("hidden");
  }

  function openExp() {
    if (!allowTap("openExp")) return;
    overlayExp.classList.remove("hidden");
    const exp = loadExp();
    [...expGrid.querySelectorAll("button[data-exp]")].forEach(btn => {
      const name = btn.getAttribute("data-exp");
      btn.classList.toggle("selected", exp && exp.name === name);
    });
  }

  function closeExp() {
    if (!allowTap("closeExp")) return;
    overlayExp.classList.add("hidden");
  }

  function chooseExp(name) {
    const key = `exp:${name}`;
    if (!allowTap(key)) return;
    saveExp(name, todayISOInHelsinki());
    setStatus(`EXP set: ${name} (Day 1).`, "ok");
    closeExp();
    render();
  }

  function clearExpTapped() {
    if (!allowTap("clearExp")) return;
    clearExp();
    setStatus("EXP cleared.", "ok");
    closeExp();
    render();
  }

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
    gotoIso(todayISOInHelsinki());
  });

  btnReview.addEventListener("click", openReview);
  btnCloseReview.addEventListener("click", closeReview);
  overlayReview.addEventListener("click", (e) => { if (e.target === overlayReview) closeReview(); });

  btnExp.addEventListener("click", openExp);
  btnCloseExp.addEventListener("click", closeExp);
  overlayExp.addEventListener("click", (e) => { if (e.target === overlayExp) closeExp(); });

  expGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-exp]");
    if (!btn) return;
    chooseExp(btn.getAttribute("data-exp"));
  });

  btnClearExp.addEventListener("click", clearExpTapped);

  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  render();
  setStatus("");
})();
