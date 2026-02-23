(() => {
  "use strict";

  const KEY = "personalOS.v3.3";

  // ===== Constraints =====
  const MAX_GOALS = 5;
  const EVT = Object.freeze(["DECISION", "DEFERRED", "AVOIDED", "EXECUTION", "CONTEXT", "DRAG"]);

  const HARDEN = Object.freeze({
    GLOBAL_MIN_INTERVAL_MS: 170,
    PER_KEY_COOLDOWN_MS: 260,
    LEDGER_MAX_EVENTS_PER_DAY: 18,
    LEDGER_MAX_PER_TYPE: 6,
    PCT_STEP: 10
  });

  const GOAL_CHIPS = ["Ship", "Body", "Money", "Study", "Brand"];
  const TASK_CHIPS = ["30m Deep Work", "Publish", "Train", "Write 200w", "Pitch", "Review"];

  const LOOT_LINES = [
    "Closed > perfect.",
    "Reality logged. Story denied.",
    "Day locked. No refunds.",
    "You didn’t win the day. You owned it.",
    "Ghost hates paperwork. Too bad.",
    "Clean close. Sharp mind."
  ];

  const QUIPS = {
    DECISION: ["✅ Decision made.", "🧠 You chose.", "⚡ Commitment detected."],
    EXECUTION: ["✅ Reality moved.", "🛠️ Work happened.", "📦 Progress delivered."],
    AVOIDED: ["🫥 Ghost spotted.", "🕳️ Avoidance logged.", "🪦 You saw it."],
    DEFERRED: ["⏳ Deferred.", "🗂️ Parked.", "🧊 Frozen loop logged."],
    CONTEXT: ["🧱 Constraints changed.", "🛰️ Environment updated.", "🧩 Structure improved."],
    DRAG: ["🧲 Drag logged.", "🫠 Entropy visited.", "📉 Friction detected."]
  };

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);

  const ticker = $("ticker");
  const mascot = $("mascot");
  const meta = $("meta");

  const mainView = $("mainView");
  const diagView = $("diagView");

  const btnDiag = $("btnDiag");
  const btnBack = $("btnBack");

  const goalChipsEl = $("goalChips");
  const btnAddGoalCustom = $("btnAddGoalCustom");
  const goalsEl = $("goals");

  const dateLabel = $("dateLabel");
  const ledgerButtons = $("ledgerButtons");
  const btnUndo = $("btnUndo");
  const btnFinalize = $("btnFinalize");
  const btnResetToday = $("btnResetToday");
  const ledgerStatus = $("ledgerStatus");
  const caps = $("caps");

  const lineMoved = $("lineMoved");
  const lineDrag = $("lineDrag");
  const lineNext = $("lineNext");
  const lockHint = $("lockHint");

  const pClosure = $("pClosure");
  const pDecideDo = $("pDecideDo");
  const pAvoid = $("pAvoid");
  const pDefer = $("pDefer");
  const pFriction = $("pFriction");
  const pStructure = $("pStructure");

  const btnReview = $("btnReview");
  const reviewSheet = $("reviewSheet");
  const btnCloseReview = $("btnCloseReview");
  const rMoved = $("rMoved");
  const rDrag = $("rDrag");
  const rNext = $("rNext");
  const rStrong = $("rStrong");
  const rWeak = $("rWeak");

  const btnExport = $("btnExport");
  const btnImport = $("btnImport");
  const ioSheet = $("ioSheet");
  const ioTitle = $("ioTitle");
  const ioText = $("ioText");
  const ioHint = $("ioHint");
  const btnDoIO = $("btnDoIO");
  const btnCloseIO = $("btnCloseIO");

  const promptSheet = $("promptSheet");
  const promptTitle = $("promptTitle");
  const promptInput = $("promptInput");
  const btnPromptOK = $("btnPromptOK");
  const btnClosePrompt = $("btnClosePrompt");

  const diagOutput = $("diagOutput");

  // ===== Tap hardening =====
  let lastAnyTap = 0;
  const lastKeyTap = new Map();

  function allowTap(key) {
    const now = Date.now();
    if (now - lastAnyTap < HARDEN.GLOBAL_MIN_INTERVAL_MS) return false;
    const last = lastKeyTap.get(key) || 0;
    if (now - last < HARDEN.PER_KEY_COOLDOWN_MS) return false;
    lastAnyTap = now;
    lastKeyTap.set(key, now);
    return true;
  }

  function haptic(kind = "tap") {
    if (!("vibrate" in navigator)) return;
    if (kind === "finalize") navigator.vibrate([18, 18, 24]);
    else navigator.vibrate(12);
  }

  function pulse(el) {
    if (!el) return;
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 160);
  }

  // ===== Time (Europe/Helsinki) =====
  function isoToday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function hhmm() {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());
  }

  // ===== Storage utils =====
  function safeParse(raw) { try { return JSON.parse(raw); } catch { return null; } }
  function uid() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
  function clampName(s) {
    const str = String(s ?? "").trim();
    if (!str) return "—";
    return str.length <= 42 ? str : (str.slice(0, 39) + "…");
  }
  function clampPct(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(100, Math.round(x)));
  }
  function clampLine(s) {
    const str = String(s ?? "—");
    return str.length <= 80 ? str : (str.slice(0, 77) + "…");
  }

  function emptyState() {
    return {
      v: 33,
      console: { goals: [] },
      ledger: { days: {} } // iso -> {events:[{t,ts,src}], finalized, close, profile}
    };
  }

  let state = loadState();
  let today = isoToday();

  function saveState(s = state) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function loadState() {
    const raw = localStorage.getItem(KEY);
    const s = raw ? safeParse(raw) : null;

    if (!s || typeof s !== "object") {
      const fresh = seed(emptyState());
      saveState(fresh);
      return fresh;
    }

    // migrate: accept older versions
    if (!("v" in s)) s.v = 33;
    if (!s.console || typeof s.console !== "object") s.console = { goals: [] };
    if (!Array.isArray(s.console.goals)) s.console.goals = [];
    if (!s.ledger || typeof s.ledger !== "object") s.ledger = { days: {} };
    if (!s.ledger.days || typeof s.ledger.days !== "object") s.ledger.days = {};

    // sanitize goals
    s.console.goals = s.console.goals
      .filter(g => g && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.tasks))
      .slice(0, MAX_GOALS)
      .map(g => ({
        id: g.id,
        name: clampName(g.name),
        tasks: g.tasks
          .filter(t => t && typeof t.id === "string" && typeof t.name === "string")
          .map(t => ({
            id: t.id,
            name: clampName(t.name),
            pct: clampPct(t.pct),
            updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : Date.now()
          }))
      }));

    // sanitize days
    for (const [iso, d] of Object.entries(s.ledger.days)) {
      if (!d || typeof d !== "object") { delete s.ledger.days[iso]; continue; }
      if (!Array.isArray(d.events)) d.events = [];
      d.events = d.events
        .filter(e => e && EVT.includes(e.t) && Number.isFinite(e.ts))
        .slice(0, HARDEN.LEDGER_MAX_EVENTS_PER_DAY);
      d.finalized = !!d.finalized;

      if (!d.close || typeof d.close !== "object") d.close = { moved: "—", drag: "—", next: "—" };
      d.close.moved = clampLine(d.close.moved);
      d.close.drag = clampLine(d.close.drag);
      d.close.next = clampLine(d.close.next);

      if (!("profile" in d)) d.profile = null;
    }

    // ensure current schema version
    s.v = 33;
    saveState(s);
    return s.console.goals.length ? s : seed(s);
  }

  function seed(s) {
    if (s.console.goals.length) return s;
    s.console.goals = [
      { id: uid(), name: "Ship", tasks: [
        { id: uid(), name: "30m Deep Work", pct: 0, updatedAt: Date.now() },
        { id: uid(), name: "Publish", pct: 0, updatedAt: Date.now() }
      ]},
      { id: uid(), name: "Body", tasks: [
        { id: uid(), name: "Train", pct: 0, updatedAt: Date.now() }
      ]}
    ];
    return s;
  }

  // ===== Day state =====
  function getDay(iso) {
    const d = state.ledger.days[iso];
    if (d) return d;
    state.ledger.days[iso] = {
      events: [],
      finalized: false,
      close: { moved: "—", drag: "—", next: "—" },
      profile: null
    };
    saveState();
    return state.ledger.days[iso];
  }

  function countsByType(events) {
    const c = Object.fromEntries(EVT.map(t => [t, 0]));
    for (const e of events) c[e.t] = (c[e.t] || 0) + 1;
    return c;
  }

  function canLog(day, t) {
    if (day.finalized) return "Locked.";
    if (day.events.length >= HARDEN.LEDGER_MAX_EVENTS_PER_DAY) return "Daily cap reached.";
    const per = day.events.filter(e => e.t === t).length;
    if (per >= HARDEN.LEDGER_MAX_PER_TYPE) return `${t} cap reached.`;
    return null;
  }

  function setLedgerStatus(msg, kind = "muted") {
    ledgerStatus.textContent = msg || "";
    ledgerStatus.style.color =
      kind === "ok" ? "var(--ok)" : kind === "danger" ? "var(--danger)" : "var(--muted)";
  }

  function say(kind, fallback = "…") {
    const arr = QUIPS[kind] || null;
    mascot.textContent = arr ? arr[Math.floor(Math.random() * arr.length)] : fallback;
  }

  function bridgeLog(t) {
    const day = getDay(today);
    const why = canLog(day, t);
    if (why) return;
    day.events.push({ t, ts: Date.now(), src: "bridge" });
    saveState();
  }

  function manualLog(t) {
    const day = getDay(today);
    const why = canLog(day, t);
    if (why) { setLedgerStatus(why, "danger"); return; }
    day.events.push({ t, ts: Date.now(), src: "ledger" });
    saveState();
    setLedgerStatus(`${t} logged.`, "ok");
    say(t, "Logged.");
  }

  // ===== Decision Profile =====
  function computeProfileForDay(day) {
    const c = countsByType(day.events);
    const decided = c.DECISION;
    const executed = c.EXECUTION;
    const avoided = c.AVOIDED;
    const deferred = c.DEFERRED;
    const drag = c.DRAG;
    const context = c.CONTEXT;

    const closure = day.finalized ? "✅ Closed" : "⚠️ Open";

    let decideDo = "—";
    if (decided === 0 && executed === 0) decideDo = "— No signal";
    else if (decided === 0 && executed > 0) decideDo = "⚠️ Doing without deciding";
    else if (decided > 0 && executed === 0) decideDo = "⚠️ Deciding without doing";
    else {
      const ratio = executed / decided;
      decideDo = ratio >= 1 ? "✅ Aligned" : ratio >= 0.5 ? "⚠️ Partial" : "❌ Weak";
    }

    const avoid = avoided === 0 ? "✅ Low" : avoided <= 1 ? "⚠️ Present" : "❌ Dominant";
    const defer = deferred === 0 ? "✅ Low" : deferred <= 2 ? "⚠️ Building" : "❌ Parking lot";
    const friction = drag === 0 ? "✅ Low" : drag <= 2 ? "⚠️ Noticeable" : "❌ High";

    const pain = avoided + drag;
    let structure = "—";
    if (context === 0 && pain === 0) structure = "✅ Stable";
    else if (context >= 1 && pain === 0) structure = "✅ Proactive";
    else if (context === 0 && pain >= 1) structure = "❌ Victim of constraints";
    else if (context >= pain) structure = "⚠️ Working the system";
    else structure = "⚠️ Under-structuring";

    return { closure, decideDo, avoid, defer, friction, structure };
  }

  function renderProfile(profile) {
    const p = profile || { closure: "—", decideDo: "—", avoid: "—", defer: "—", friction: "—", structure: "—" };
    pClosure.textContent = p.closure;
    pDecideDo.textContent = p.decideDo;
    pAvoid.textContent = p.avoid;
    pDefer.textContent = p.defer;
    pFriction.textContent = p.friction;
    pStructure.textContent = p.structure;
  }

  function axisScore(label) {
    if (label.startsWith("✅")) return 2;
    if (label.startsWith("⚠️")) return 1;
    if (label.startsWith("❌")) return 0;
    return 1;
  }

  function summarizeProfileLast7() {
    const days = Object.entries(state.ledger.days)
      .map(([iso, d]) => ({ iso, d }))
      .filter(x => x.d && x.d.finalized)
      .sort((a, b) => (a.iso < b.iso ? 1 : -1))
      .slice(0, 7)
      .map(x => x.d);

    if (days.length === 0) return { strong: "—", weak: "—" };

    const axes = [
      ["Closure", "closure"],
      ["Decide→Do", "decideDo"],
      ["Avoidance", "avoid"],
      ["Deferral", "defer"],
      ["Friction", "friction"],
      ["Structure", "structure"]
    ];

    const results = axes.map(([name, key]) => {
      let sum = 0;
      for (const d of days) {
        const prof = d.profile || computeProfileForDay(d);
        sum += axisScore(prof[key]);
      }
      return { name, avg: sum / days.length };
    });

    results.sort((a, b) => b.avg - a.avg);
    const strong = results.slice(0, 2).map(x => x.name).join(" · ");
    const weak = results.slice(-2).reverse().map(x => x.name).join(" · ");

    return { strong: clampLine(strong || "—"), weak: clampLine(weak || "—") };
  }

  // ===== Close + finalize =====
  function finalizeDay() {
    const day = getDay(today);
    if (day.finalized) { setLedgerStatus("Already finalized.", "muted"); return; }

    const c = countsByType(day.events);

    const moved = [];
    if (c.DECISION > 0) moved.push("DECISIONS");
    if (c.EXECUTION > 0) moved.push("EXECUTION");
    if (c.CONTEXT > 0) moved.push("CONTEXT");

    const hurt = [];
    if (c.AVOIDED > 0) hurt.push("AVOIDED");
    if (c.DEFERRED > 0) hurt.push("DEFERRED");
    if (c.DRAG > 0) hurt.push("DRAG");

    let next = "Make one irreversible decision.";
    if (c.AVOIDED > 0) next = "Face the avoided thing first.";
    else if (c.DEFERRED > 0) next = "Close one deferred loop.";
    else if (c.DECISION === 0) next = "Decide one thing, execute one step.";

    day.close = {
      moved: clampLine(moved.length ? moved.join(" · ") : "—"),
      drag: clampLine(hurt.length ? hurt.join(" · ") : "—"),
      next: clampLine(next)
    };

    day.profile = computeProfileForDay({ ...day, finalized: true });
    day.finalized = true;
    saveState();

    mascot.textContent = LOOT_LINES[Math.floor(Math.random() * LOOT_LINES.length)];
    setLedgerStatus("Finalized. Locked.", "ok");
    haptic("finalize");
  }

  // ===== Diagnostic =====
  function computePresence01() {
    let opened = 0, finalized = 0, avoided = 0;
    for (const d of Object.values(state.ledger.days)) {
      if (!d) continue;
      if (d.events.length > 0) opened++;
      if (d.finalized) finalized++;
      avoided += d.events.filter(e => e && e.t === "AVOIDED").length;
    }
    if (opened === 0) return null;
    return Math.max(0, Math.min(1, finalized / (opened + avoided * 0.5)));
  }

  function presenceBar(score01) {
    if (score01 === null) return "No signal yet.\nLog and close days.";
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

  // ===== Review =====
  function summarizeLast7FinalizedClose() {
    const days = Object.entries(state.ledger.days)
      .map(([iso, d]) => ({ iso, d }))
      .filter(x => x.d && x.d.finalized)
      .sort((a, b) => (a.iso < b.iso ? 1 : -1))
      .slice(0, 7)
      .map(x => x.d);

    if (days.length === 0) return { moved: "—", drag: "—", next: "—" };

    const tally = (arr) => {
      const m = new Map();
      for (const x of arr) {
        const parts = String(x || "—").split("·").map(p => p.trim()).filter(Boolean);
        for (const p of parts) m.set(p, (m.get(p) || 0) + 1);
      }
      return m;
    };

    const top = (m, n) =>
      [...m.entries()].filter(([k]) => k !== "—")
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k]) => k);

    const movedTop = top(tally(days.map(d => d.close?.moved)), 4);
    const hurtTop = top(tally(days.map(d => d.close?.drag)), 4);

    let next = "Close one loop per day.";
    if (hurtTop.includes("AVOIDED")) next = "Face the avoided thing first.";
    else if (hurtTop.includes("DEFERRED")) next = "Close one deferred loop daily.";

    return {
      moved: clampLine(movedTop.length ? movedTop.join(" · ") : "—"),
      drag: clampLine(hurtTop.length ? hurtTop.join(" · ") : "—"),
      next: clampLine(next)
    };
  }

  // ===== Console mutations =====
  function addGoal(name) {
    if (state.console.goals.length >= MAX_GOALS) {
      mascot.textContent = "Goal limit reached. Delete something.";
      return;
    }
    state.console.goals.unshift({ id: uid(), name: clampName(name), tasks: [] });
    saveState();
    bridgeLog("CONTEXT");
    say("CONTEXT");
  }

  function deleteGoal(goalId) {
    state.console.goals = state.console.goals.filter(g => g.id !== goalId);
    saveState();
    bridgeLog("DECISION");
    say("DECISION");
  }

  function addTask(goalId, name) {
    const g = state.console.goals.find(x => x.id === goalId);
    if (!g) return;
    g.tasks.push({ id: uid(), name: clampName(name), pct: 0, updatedAt: Date.now() });
    saveState();
    bridgeLog("CONTEXT");
    say("CONTEXT");
  }

  function deleteTask(goalId, taskId) {
    const g = state.console.goals.find(x => x.id === goalId);
    if (!g) return;
    g.tasks = g.tasks.filter(t => t.id !== taskId);
    saveState();
    bridgeLog("DEFERRED");
    say("DEFERRED");
  }

  function adjustPct(goalId, taskId, delta) {
    const g = state.console.goals.find(x => x.id === goalId);
    if (!g) return;
    const t = g.tasks.find(x => x.id === taskId);
    if (!t) return;

    const before = t.pct;
    t.pct = clampPct(t.pct + delta);
    t.updatedAt = Date.now();
    saveState();

    if (t.pct !== before) {
      bridgeLog("EXECUTION");
      say("EXECUTION");
    }
  }

  // ===== Rendering =====
  function renderGoalChips() {
    goalChipsEl.innerHTML = "";
    for (const name of GOAL_CHIPS) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = name;
      b.dataset.action = "addGoalChip";
      b.dataset.name = name;
      goalChipsEl.appendChild(b);
    }
  }

  function renderGoals() {
    goalsEl.innerHTML = "";
    const goals = state.console.goals;
    meta.textContent = `${goals.length}/${MAX_GOALS} goals · ${Object.keys(state.ledger.days).length} days`;
    for (const g of goals) goalsEl.appendChild(renderGoal(g));
  }

  function renderGoal(goal) {
    const wrap = document.createElement("div");
    wrap.className = "goal";
    wrap.dataset.goalId = goal.id;

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.gap = "10px";

    const left = document.createElement("div");
    left.className = "goalName";
    left.textContent = goal.name;

    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "Delete";
    del.dataset.action = "deleteGoal";
    del.dataset.goalId = goal.id;

    header.appendChild(left);
    header.appendChild(del);
    wrap.appendChild(header);

    const chipRow = document.createElement("div");
    chipRow.className = "chipRow";
    chipRow.style.marginTop = "10px";

    for (const tname of TASK_CHIPS) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = tname;
      b.dataset.action = "addTaskChip";
      b.dataset.goalId = goal.id;
      b.dataset.name = tname;
      chipRow.appendChild(b);
    }

    const custom = document.createElement("button");
    custom.className = "chip ghost";
    custom.textContent = "Custom…";
    custom.dataset.action = "addTaskCustom";
    custom.dataset.goalId = goal.id;
    chipRow.appendChild(custom);

    wrap.appendChild(chipRow);

    for (const t of goal.tasks) wrap.appendChild(renderTask(goal, t));
    return wrap;
  }

  function renderTask(goal, task) {
    const row = document.createElement("div");
    row.className = "task";

    const name = document.createElement("div");
    name.className = "taskName";
    name.textContent = `${task.name} (${task.pct}%)`;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.dataset.action = "pct";
    minus.dataset.delta = String(-HARDEN.PCT_STEP);
    minus.dataset.goalId = goal.id;
    minus.dataset.taskId = task.id;

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.dataset.action = "pct";
    plus.dataset.delta = String(HARDEN.PCT_STEP);
    plus.dataset.goalId = goal.id;
    plus.dataset.taskId = task.id;

    const barWrap = document.createElement("div");
    barWrap.className = "barWrap";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${task.pct}%`;
    barWrap.appendChild(bar);

    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "x";
    del.dataset.action = "deleteTask";
    del.dataset.goalId = goal.id;
    del.dataset.taskId = task.id;

    right.appendChild(minus);
    right.appendChild(plus);
    right.appendChild(barWrap);
    right.appendChild(del);

    row.appendChild(name);
    row.appendChild(right);
    return row;
  }

  function renderLedgerButtons() {
    ledgerButtons.innerHTML = "";
    for (const t of EVT) {
      const b = document.createElement("button");
      b.textContent = t;
      b.dataset.action = "ledger";
      b.dataset.t = t;
      ledgerButtons.appendChild(b);
    }
  }

  function updateTicker() {
    ticker.textContent = `I believe: — · Evidence: — · ${hhmm()}`;
  }

  function renderLedger() {
    today = isoToday();
    dateLabel.textContent = `Today · ${today}`;

    const day = getDay(today);
    const c = countsByType(day.events);

    caps.textContent = `Remaining: ${Math.max(0, HARDEN.LEDGER_MAX_EVENTS_PER_DAY - day.events.length)}`;
    lockHint.textContent = day.finalized ? "Locked day. No edits after finalize." : "";

    lineMoved.textContent = day.close?.moved ?? "—";
    lineDrag.textContent = day.close?.drag ?? "—";
    lineNext.textContent = day.close?.next ?? "—";

    renderProfile(day.profile || computeProfileForDay(day));

    btnUndo.disabled = day.finalized || day.events.length === 0;
    btnFinalize.disabled = day.finalized;

    [...ledgerButtons.querySelectorAll("button[data-action='ledger']")].forEach(b => {
      const t = b.dataset.t;
      const per = c[t] || 0;
      b.disabled =
        day.finalized ||
        day.events.length >= HARDEN.LEDGER_MAX_EVENTS_PER_DAY ||
        per >= HARDEN.LEDGER_MAX_PER_TYPE;
    });
  }

  function renderAll() {
    renderGoalChips();
    renderGoals();
    renderLedgerButtons();
    renderLedger();
    updateTicker();
    saveState();
  }

  // ===== Event wiring (re-render safe) =====
  goalChipsEl.addEventListener("click", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.action !== "addGoalChip") return;

    pulse(el); haptic("tap");
    const name = el.dataset.name;
    if (!name || !allowTap(`addGoalChip:${name}`)) return;

    addGoal(name);
    renderAll();
  });

  btnAddGoalCustom.addEventListener("click", () => {
    pulse(btnAddGoalCustom); haptic("tap");
    if (!allowTap("addGoalCustom")) return;
    openPrompt({ kind: "goal" }, "Custom Goal");
  });

  goalsEl.addEventListener("click", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const action = el.dataset.action;
    if (!action) return;

    pulse(el); haptic("tap");

    if (action === "deleteGoal") {
      const gid = el.dataset.goalId;
      if (!gid || !allowTap(`delGoal:${gid}`)) return;
      deleteGoal(gid);
      renderAll();
      return;
    }

    if (action === "addTaskChip") {
      const gid = el.dataset.goalId;
      const name = el.dataset.name;
      if (!gid || !name || !allowTap(`addTaskChip:${gid}:${name}`)) return;
      addTask(gid, name);
      renderAll();
      return;
    }

    if (action === "addTaskCustom") {
      const gid = el.dataset.goalId;
      if (!gid || !allowTap(`addTaskCustom:${gid}`)) return;
      openPrompt({ kind: "task", goalId: gid }, "Custom Task");
      return;
    }

    if (action === "deleteTask") {
      const gid = el.dataset.goalId;
      const tid = el.dataset.taskId;
      if (!gid || !tid || !allowTap(`delTask:${gid}:${tid}`)) return;
      deleteTask(gid, tid);
      renderAll();
      return;
    }

    if (action === "pct") {
      const gid = el.dataset.goalId;
      const tid = el.dataset.taskId;
      const delta = Number(el.dataset.delta);
      if (!gid || !tid || !Number.isFinite(delta) || !allowTap(`pct:${gid}:${tid}:${delta}`)) return;
      adjustPct(gid, tid, delta);
      renderAll();
      return;
    }
  });

  ledgerButtons.addEventListener("click", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.action !== "ledger") return;

    pulse(el); haptic("tap");
    const t = el.dataset.t;
    if (!t || !EVT.includes(t) || !allowTap(`ledger:${t}`)) return;

    manualLog(t);
    renderAll();
  });

  btnUndo.addEventListener("click", () => {
    pulse(btnUndo); haptic("tap");
    if (!allowTap("undo")) return;

    const day = getDay(today);
    if (day.finalized) return;

    const last = day.events.pop();
    saveState();

    if (last) {
      setLedgerStatus(`Undid ${last.t}.`, "ok");
      mascot.textContent = "Undo. Timeline adjusted.";
    } else {
      setLedgerStatus("Nothing to undo.", "muted");
      mascot.textContent = "No undo available.";
    }

    renderAll();
  });

  btnFinalize.addEventListener("click", () => {
    pulse(btnFinalize);
    if (!allowTap("finalize")) return;
    finalizeDay();
    renderAll();
  });

  btnResetToday.addEventListener("click", () => {
    pulse(btnResetToday); haptic("finalize");
    if (!allowTap("resetToday")) return;

    delete state.ledger.days[today];
    saveState();

    setLedgerStatus("Today reset.", "ok");
    mascot.textContent = "Clean slate. No drama.";
    renderAll();
  });

  // Review
  btnReview.addEventListener("click", () => {
    pulse(btnReview); haptic("tap");
    if (!allowTap("review")) return;

    const closeSum = summarizeLast7FinalizedClose();
    const profSum = summarizeProfileLast7();

    rMoved.textContent = closeSum.moved;
    rDrag.textContent = closeSum.drag;
    rNext.textContent = closeSum.next;
    rStrong.textContent = profSum.strong;
    rWeak.textContent = profSum.weak;

    reviewSheet.classList.remove("hidden");
  });

  btnCloseReview.addEventListener("click", () => {
    if (!allowTap("closeReview")) return;
    reviewSheet.classList.add("hidden");
  });

  reviewSheet.addEventListener("click", (e) => {
    if (e.target === reviewSheet && allowTap("bgReview")) reviewSheet.classList.add("hidden");
  });

  // Diagnostic
  btnDiag.addEventListener("click", () => {
    pulse(btnDiag); haptic("tap");
    if (!allowTap("diag")) return;

    diagOutput.textContent = presenceBar(computePresence01());
    mainView.classList.add("hidden");
    diagView.classList.remove("hidden");
  });

  btnBack.addEventListener("click", () => {
    if (!allowTap("back")) return;
    diagView.classList.add("hidden");
    mainView.classList.remove("hidden");
  });

  // ===== IO =====
  let ioMode = "export";

  function openIO(mode) {
    ioMode = mode;
    ioSheet.classList.remove("hidden");
    ioText.value = "";

    if (mode === "export") {
      ioTitle.textContent = "Export";
      ioHint.textContent = "Copy JSON. Use it to move devices / backup.";
      ioText.value = JSON.stringify(state, null, 2);
      btnDoIO.textContent = "Copy";
      setTimeout(() => { ioText.focus(); ioText.select(); }, 20);
    } else {
      ioTitle.textContent = "Import";
      ioHint.textContent = "Paste JSON export. This overwrites local data.";
      btnDoIO.textContent = "Import";
      setTimeout(() => ioText.focus(), 20);
    }
  }

  function closeIO() { ioSheet.classList.add("hidden"); }

  function doIO() {
    if (ioMode === "export") {
      try {
        ioText.select();
        document.execCommand("copy");
        mascot.textContent = "Export copied (if clipboard allowed).";
      } catch {
        mascot.textContent = "Copy manually. Clipboard blocked.";
      }
      return;
    }

    const raw = ioText.value.trim();
    if (!raw) { mascot.textContent = "Paste JSON first."; return; }

    try {
      const incoming = JSON.parse(raw);
      if (!incoming || typeof incoming !== "object") throw new Error("bad");

      // migration/compat: ensure required shape
      if (!incoming.console || typeof incoming.console !== "object") incoming.console = { goals: [] };
      if (!Array.isArray(incoming.console.goals)) incoming.console.goals = [];
      if (!incoming.ledger || typeof incoming.ledger !== "object") incoming.ledger = { days: {} };
      if (!incoming.ledger.days || typeof incoming.ledger.days !== "object") incoming.ledger.days = {};

      // force version to current so it won't be wiped
      incoming.v = 33;

      localStorage.setItem(KEY, JSON.stringify(incoming));
      state = loadState(); // sanitize again
      mascot.textContent = "Imported.";
      closeIO();
      renderAll();
    } catch {
      mascot.textContent = "Invalid JSON.";
    }
  }

  btnExport.addEventListener("click", () => {
    pulse(btnExport); haptic("tap");
    if (!allowTap("export")) return;
    openIO("export");
  });

  btnImport.addEventListener("click", () => {
    pulse(btnImport); haptic("tap");
    if (!allowTap("import")) return;
    openIO("import");
  });

  btnCloseIO.addEventListener("click", () => {
    if (!allowTap("closeIO")) return;
    closeIO();
  });

  btnDoIO.addEventListener("click", () => {
    if (!allowTap("doIO")) return;
    doIO();
  });

  ioSheet.addEventListener("click", (e) => {
    if (e.target === ioSheet && allowTap("bgIO")) closeIO();
  });

  // ===== Prompt =====
  let promptMode = null;

  function openPrompt(mode, title) {
    promptMode = mode;
    promptTitle.textContent = title;
    promptInput.value = "";
    promptSheet.classList.remove("hidden");
    setTimeout(() => promptInput.focus(), 20);
  }

  function closePrompt() {
    promptSheet.classList.add("hidden");
    promptMode = null;
  }

  function submitPrompt() {
    const v = promptInput.value.trim();
    if (!v) { mascot.textContent = "Name required."; return; }
    const m = promptMode;
    closePrompt();
    if (!m) return;

    if (m.kind === "goal") addGoal(v);
    if (m.kind === "task") addTask(m.goalId, v);
    renderAll();
  }

  btnClosePrompt.addEventListener("click", () => {
    if (!allowTap("closePrompt")) return;
    closePrompt();
  });

  btnPromptOK.addEventListener("click", () => {
    if (!allowTap("promptOK")) return;
    submitPrompt();
  });

  promptSheet.addEventListener("click", (e) => {
    if (e.target === promptSheet && allowTap("bgPrompt")) closePrompt();
  });

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitPrompt(); }
  });

  // Defensive
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  // Ticker update (no continuous animation)
  updateTicker();
  setInterval(updateTicker, 60_000);

  // Init
  renderAll();
  mascot.textContent = "Ready. Tap truth. Close day.";
})();
