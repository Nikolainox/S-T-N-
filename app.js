const KEY = "panic_os_full_v1";
const MAX_DAYS = 540;
const MAX_EVENTS_PER_DAY = 5000;
const BINS = 70;
const LONG_PRESS_MS = 520;
const MIN_FINAL_FOR_PROB = 7;
const FORECAST_DAYS = 30;
const MC_RUNS = 700;

const COLORS = [
  { id:"mind",  label:"Mind",    hex:"#5ee7ff" },
  { id:"deep",  label:"Deep",    hex:"#ffd84d" },
  { id:"cult",  label:"Culture", hex:"#ff5bd6" },
  { id:"body",  label:"Body",    hex:"#ff4d4d" },
  { id:"food",  label:"Food",    hex:"#44ff9a" },
  { id:"rest",  label:"Rest",    hex:"#ffffff" },
  { id:"bad",   label:"Bad",     hex:"#0b0f17" },
];

const POS_W = { mind:2.2, deep:2.6, cult:1.6, body:2.0, food:1.4, rest:2.4, bad:-3.0 };
const RESTORE = new Set(["mind","rest","deep"]);

const $ = id => document.getElementById(id);
const $all = sel => [...document.querySelectorAll(sel)];
const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
const isoToday = () => new Date().toISOString().slice(0,10);
const now = () => Date.now();
const safeParse = s => { try { return JSON.parse(s); } catch { return null; } };
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}) : "—";

let app = { v:1, days:[], coachPins:{}, llm:{} };
let selectedDate = isoToday();
let calCursor = (()=>{ const d=new Date(); return { y:d.getFullYear(), m:d.getMonth() }; })();
let trajRange = 30;

function toast(msg){
  const el = $("toast");
  if(!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.style.display="none", 900);
}

function load(){
  const raw = localStorage.getItem(KEY);
  const p = raw ? safeParse(raw) : null;
  if(p && typeof p==="object"){
    app = { v:1, days:[], coachPins:{}, llm:{}, ...p };
  } else {
    app = { v:1, days:[], coachPins:{}, llm:{} };
  }
  normalizeAll();
}

function save(){
  app.days = app.days.slice(-MAX_DAYS);
  localStorage.setItem(KEY, JSON.stringify(app));
}

function normalizeAll(){
  if(!Array.isArray(app.days)) app.days = [];
  if(!app.coachPins || typeof app.coachPins!=="object") app.coachPins = {};
  if(!app.llm || typeof app.llm!=="object") app.llm = {};

  for(const d of app.days){
    if(typeof d.date!=="string") d.date = isoToday();
    if(!Array.isArray(d.events)) d.events = [];
    d.finalized = !!d.finalized;
    d.wakeTs = (typeof d.wakeTs==="number" && Number.isFinite(d.wakeTs)) ? d.wakeTs : null;
    d.finalTs = (typeof d.finalTs==="number" && Number.isFinite(d.finalTs)) ? d.finalTs : null;
    d.score = (typeof d.score==="number" && Number.isFinite(d.score)) ? d.score : 0;
    d.insight = (typeof d.insight==="string") ? d.insight : null;
    d.coach = (d.coach && typeof d.coach==="object") ? d.coach : null;
    d.events = d.events.filter(e=>e && typeof e.t==="number" && typeof e.c==="string").slice(-MAX_EVENTS_PER_DAY);
  }
  app.days.sort((a,b)=>a.date<b.date?-1:1);
}

function getDay(date){
  let d = app.days.find(x=>x.date===date);
  if(!d){
    d = { date, finalized:false, wakeTs:null, finalTs:null, events:[], insight:null, score:0, coach:null };
    app.days.push(d);
    app.days.sort((a,b)=>a.date<b.date?-1:1);
  }
  return d;
}

function dayIndex(){
  const first = app.days[0]?.date || isoToday();
  const start = new Date(first+"T00:00:00Z").getTime();
  const t = new Date(isoToday()+"T00:00:00Z").getTime();
  return Math.round((t-start)/86400000)+1;
}

function scoreDay(day){
  const counts = Object.fromEntries(COLORS.map(x=>[x.id,0]));
  for(const e of day.events||[]) if(counts[e.c]!=null) counts[e.c]++;

  const total = Math.max(1, (day.events||[]).length);
  let raw = 0;
  for(const k in counts){
    const frac = counts[k]/total;
    raw += (POS_W[k]||0) * (0.65*frac + 0.35*Math.sqrt(frac));
  }

  const badFrac = counts.bad/total;
  const restFrac = counts.rest/total;
  const mindFrac = counts.mind/total;
  const deepFrac = counts.deep/total;

  const good = (raw > 0.70) && (badFrac <= 0.22) && (restFrac + mindFrac >= 0.20) && (deepFrac >= 0.05);

  return { score:Number(raw.toFixed(3)), counts, total, good, badFrac, restFrac, mindFrac, deepFrac };
}

function buildGhostDay(realDay){
  if(!realDay || !(realDay.events||[]).length) return null;
  const ghost = {
    date: realDay.date, finalized:true,
    wakeTs: realDay.wakeTs, finalTs: realDay.finalTs,
    events: []
  };
  for(const e of realDay.events){
    if(!RESTORE.has(e.c)) ghost.events.push({ t:e.t, c:e.c });
  }

  const hist = app.days.filter(d=>d.finalized && (d.events||[]).length);
  if(hist.length){
    const badRate = hist.reduce((s,d)=>{
      const r = scoreDay(d);
      return s + (r.counts.bad||0) / Math.max(1,(d.events||[]).length);
    },0)/hist.length;

    const extra = Math.round(badRate * 4);
    const lastT = ghost.events.at(-1)?.t || realDay.wakeTs || now();
    for(let i=0;i<extra;i++) ghost.events.push({ t:lastT + (i+1)*60000, c:"bad" });
  }
  return ghost;
}

function finalizedDays(span){
  const finals = app.days.filter(d=>d.finalized);
  return span ? finals.slice(-span) : finals;
}

function betaPosteriorGood(days){
  let a=1,b=1;
  for(const d of days){
    const r = scoreDay(d);
    if(r.good) a++; else b++;
  }
  return { a,b,mean:a/(a+b) };
}

function pGood(){
  const days = finalizedDays();
  if(days.length < MIN_FINAL_FOR_PROB) return null;
  return Math.round(betaPosteriorGood(days).mean * 100);
}

function pDrift7(){
  const last7 = finalizedDays(7);
  if(last7.length < MIN_FINAL_FOR_PROB) return null;
  const neg = last7.filter(d=>scoreDay(d).score < 0).length;
  const a=1,b=1;
  return Math.round(((neg+a) / (last7.length+a+b)) * 100);
}

function pYouBeatsGhost(){
  const days = finalizedDays(30);
  if(days.length < MIN_FINAL_FOR_PROB) return null;
  let win=0, n=0;
  for(const d of days){
    const g = buildGhostDay(d);
    if(!g) continue;
    const you = scoreDay(d).score;
    const ghost = scoreDay(g).score;
    n++;
    if(you > ghost) win++;
  }
  if(n===0) return null;
  const a=1,b=1;
  return Math.round(((win+a)/(n+a+b))*100);
}

function leverageMoveForTomorrow(){
  const days = finalizedDays(120);
  if(days.length < MIN_FINAL_FOR_PROB) return null;

  const base = betaPosteriorGood(days).mean;

  let best = { id:null, delta:-999, p:null, trials:0 };
  for(const c of COLORS){
    if(c.id==="bad") continue;
    const sub = [];
    for(const d of days){
      const r = scoreDay(d);
      if((r.counts[c.id]||0) > 0) sub.push(d);
    }
    if(sub.length < 5) continue;
    const p = betaPosteriorGood(sub).mean;
    const delta = p - base;
    if(delta > best.delta){
      best = { id:c.id, delta, p, trials:sub.length };
    }
  }

  if(!best.id) return null;
  return {
    id: best.id,
    label: COLORS.find(x=>x.id===best.id)?.label || best.id,
    delta: Math.round(best.delta*100),
    p: Math.round(best.p*100),
    base: Math.round(base*100),
    trials: best.trials
  };
}

function dailyJarvis(day){
  const s = scoreDay(day);
  const ghost = buildGhostDay(day);
  const gScore = ghost ? scoreDay(ghost).score : null;
  const pg = pGood();
  const pd = pDrift7();
  const py = pYouBeatsGhost();

  if(!day.finalized){
    return "Jarvis: tap. sulje app. totuus tallentuu vasta finalize jälkeen.";
  }

  if(pg==null){
    return "Jarvis: kerää 7 finalized päivää → prosentit herää eloon.";
  }

  if(gScore!=null && gScore > s.score){
    return `Jarvis: Ghost olisi voittanut. P(good) ${pg}% · P(drift7) ${pd ?? "—"}%.`;
  }
  if(pd!=null && pd > 45){
    return `Jarvis: drift-riski ${pd}%. Pidä palautus aikaisemmin.`;
  }
  return `Jarvis: suunta elossa. P(good) ${pg}% · You>Ghost ${py ?? "—"}%.`;
}

function coachGenerateForDate(date){
  const day = getDay(date);
  const lev = leverageMoveForTomorrow();
  const pg = pGood();
  const pd = pDrift7();
  const py = pYouBeatsGhost();

  const s = scoreDay(day);
  const has = id => (s.counts[id]||0) > 0;

  const plan = [];
  if(lev){
    plan.push(`${lev.label} nyt. (Δ P(good) ~${lev.delta >= 0 ? "+" : ""}${lev.delta}%)`);
  } else {
    plan.push(`Mind tai Rest nyt. (palaa rytmiin nopeasti)`);
  }

  if((s.counts.bad||0) > 0 && !has("rest")){
    plan.push(`Rest ensimmäiseksi palautukseksi (katkaise bad-ketju).`);
  } else if(!has("deep")){
    plan.push(`Deep 10 min ennen kuin päivä karkaa (pieni voitto).`);
  } else if(!has("mind")){
    plan.push(`Mind 2 min: hengitys / hiljaisuus / kylmä. (yksi painallus riittää)`);
  } else {
    plan.push(`Pidä linja: yksi Body tai Food ennen iltaa.`);
  }

  if((s.counts.bad||0) >= 2){
    plan.push(`IF bad-impulssi → THEN Rest tai Mind ensin.`);
  } else {
    plan.push(`IF “ei jaksa” → THEN Rest + sulje app.`);
  }

  const meta = (pg==null)
    ? `Learning… need ${MIN_FINAL_FOR_PROB} finalized days`
    : `P(good) ${pg}% · P(drift7) ${pd}% · You>Ghost ${py}%`;

  const line = (pg==null)
    ? "Coach: kerää 7 päivää finalize → sitten ohjaus on oikeasti sinua varten."
    : `Coach: ${meta}. Tee seuraava teko ja sulje sovellus.`;

  return { date, oddsGood:pg, oddsDrift:pd, oddsGhost:py, leverage:lev, plan, line, meta };
}

function coachRender(date){
  const day = getDay(date);
  const pinned = !!app.coachPins[date];
  let coach = day.coach;

  if(!coach || !pinned){
    coach = coachGenerateForDate(date);
    if(pinned){
      day.coach = coach;
      save();
    }
  }

  $("coachMeta").textContent = coach.meta;

  $("coachOdds").textContent = coach.oddsGood==null ? "—" : `${coach.oddsGood}%`;
  $("coachOddsNote").textContent = coach.oddsGood==null
    ? `Finalize ${MIN_FINAL_FOR_PROB} päivää, sitten prosentit.`
    : `P(drift7) ${coach.oddsDrift}% · päivittyy finalize jälkeen`;

  $("coachLeverage").textContent = coach.leverage ? coach.leverage.label : "—";
  $("coachLeverageNote").textContent = coach.leverage
    ? `Base ${coach.leverage.base}% → ${coach.leverage.p}% (Δ ${coach.leverage.delta >= 0 ? "+" : ""}${coach.leverage.delta}%, n=${coach.leverage.trials})`
    : `Leverage aktivoituu kun dataa kertyy.`;

  $("coachGhost").textContent = coach.oddsGhost==null ? "—" : `${coach.oddsGhost}%`;
  $("coachGhostNote").textContent = coach.oddsGhost==null
    ? `Ghost vaatii finalize-historiaa.`
    : `You>Ghost lasketaan 30 päivästä (beta-stabiloitu).`;

  $("plan1").textContent = coach.plan[0] || "—";
  $("plan2").textContent = coach.plan[1] || "—";
  $("plan3").textContent = coach.plan[2] || "—";

  $("coachJarvis").textContent = coach.line;
}

function fitCanvas(canvas){
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if(canvas.width !== w || canvas.height !== h){
    canvas.width = w; canvas.height = h;
  }
  return { w, h, dpr };
}

function buildBins(day){
  const bins = {};
  for(const c of COLORS) bins[c.id] = new Array(BINS).fill(0);

  if(!day.wakeTs || !(day.events||[]).length) return { bins, start:null, end:null };

  const start = day.wakeTs;
  const end = (day.finalized && day.finalTs) ? day.finalTs : Math.max(now(), day.events.at(-1).t);
  const span = Math.max(1, end - start);

  for(const e of day.events){
    const pos = clamp((e.t - start)/span, 0, 0.999999);
    const i = Math.floor(pos * BINS);
    if(bins[e.c]) bins[e.c][i] += 1;
  }

  for(const k in bins){
    const a = bins[k];
    for(let i=1;i<a.length-1;i++) a[i] = (a[i-1]*0.25 + a[i]*0.5 + a[i+1]*0.25);
  }
  for(const k in bins){
    const a = bins[k];
    const m = Math.max(1e-6, Math.max(...a));
    for(let i=0;i<a.length;i++) a[i] = a[i]/m;
  }

  return { bins, start, end };
}

function hexToRgba(hex, a){
  if(hex==="#0b0f17") return `rgba(234,240,255,${a*0.28})`;
  const c = hex.replace("#","");
  const r=parseInt(c.slice(0,2),16);
  const g=parseInt(c.slice(2,4),16);
  const b=parseInt(c.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawHolo(day){
  const canvas = $("holoCanvas");
  const ctx = canvas.getContext("2d");
  const { w, h } = fitCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(94,231,255,0.12)";
  ctx.lineWidth = 1;
  const gx = Math.max(26, Math.round(w/10));
  const gy = Math.max(26, Math.round(h/10));
  for(let x=0;x<w;x+=gx){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=gy){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();

  const pad = Math.round(Math.min(w,h)*0.05);
  const iw = w - pad*2;
  const ih = h - pad*2;
  const spineX = Math.round(pad + iw*0.52);

  ctx.save();
  ctx.strokeStyle = "rgba(94,231,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(spineX,pad); ctx.lineTo(spineX,pad+ih); ctx.stroke();
  ctx.restore();

  const { bins, start, end } = buildBins(day);
  const ghost = day.finalized ? buildGhostDay(day) : null;

  const offsets = { mind:-34, deep:-18, cult:0, body:26, food:12, rest:-12, bad:40 };
  const yAt = i => pad + (i/(BINS-1))*ih;

  if(ghost){
    const gBins = buildBins(ghost).bins;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.setLineDash([8,10]);

    for(const c of COLORS){
      const a = gBins[c.id];
      const off = offsets[c.id] ?? 0;
      if(!a) continue;
      ctx.strokeStyle = hexToRgba(c.hex, 0.34);
      ctx.lineWidth = 2;
      ctx.lineCap="round"; ctx.lineJoin="round";
      ctx.beginPath();
      for(let i=0;i<a.length;i++){
        const x = spineX + off + (a[i]-0.5)*30;
        const y = yAt(i);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  for(const c of COLORS){
    const a = bins[c.id];
    const off = offsets[c.id] ?? 0;

    ctx.save();
    ctx.strokeStyle = hexToRgba(c.hex, 0.18);
    ctx.lineWidth = 10;
    ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.beginPath();
    for(let i=0;i<BINS;i++){
      const x = spineX + off + (a[i]-0.5)*44;
      const y = yAt(i);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = hexToRgba(c.hex, c.id==="rest" ? 0.86 : 0.78);
    ctx.lineWidth = 3;
    ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.beginPath();
    for(let i=0;i<BINS;i++){
      const x = spineX + off + (a[i]-0.5)*44;
      const y = yAt(i);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.restore();
  }

  const total = (day.events||[]).length;
  const t0 = start ? new Date(start) : null;
  const t1 = end ? new Date(end) : null;
  $("holoMeta").textContent = total
    ? `${total} taps · ${t0 ? t0.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"} → ${t1 ? t1.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}`
    : "No taps yet";
}

function ewma(values, alpha){
  let m = null;
  for(const v of values) m = (m==null) ? v : (alpha*v + (1-alpha)*m);
  return m==null ? 0 : m;
}

function patRileyDriftIndex(days){
  const vals = days.map(d=>scoreDay(d).score);
  const fast = ewma(vals, 0.35);
  const slow = ewma(vals, 0.12);
  return Number((fast - slow).toFixed(3));
}

function mcForecastFromHistory(days, horizon){
  if(days.length < 7) return null;

  const freq = Object.fromEntries(COLORS.map(c=>[c.id,0]));
  let totalEv = 0;
  for(const d of days){
    for(const e of d.events||[]){
      if(freq[e.c]!=null){ freq[e.c]++; totalEv++; }
    }
  }
  const keys = COLORS.map(c=>c.id);
  let sum = keys.reduce((a,k)=>a+freq[k],0);
  if(sum<=0) sum=1;
  const baseP = Object.fromEntries(keys.map(k=>[k,freq[k]/sum]));

  const lens = days.map(d=>(d.events||[]).length).filter(n=>n>0);
  const avgLen = Math.max(6, Math.round(lens.reduce((a,b)=>a+b,0)/Math.max(1,lens.length)));

  function sample(){
    let r = Math.random(), s=0;
    for(const k of keys){
      s += baseP[k];
      if(r <= s) return k;
    }
    return keys.at(-1);
  }

  const tracks = [];
  for(let r=0;r<MC_RUNS;r++){
    const futureScores = [];
    for(let i=0;i<horizon;i++){
      const counts = Object.fromEntries(keys.map(k=>[k,0]));
      for(let j=0;j<avgLen;j++) counts[sample()]++;
      const fake = { events: Object.entries(counts).flatMap(([k,n])=>Array.from({length:n},(_,t)=>({c:k,t}))) };
      futureScores.push(scoreDay(fake).score);
    }
    tracks.push(futureScores);
  }

  const median = [], p10 = [], p90 = [];
  for(let i=0;i<horizon;i++){
    const col = tracks.map(t=>t[i]).sort((a,b)=>a-b);
    median.push(col[Math.floor(col.length*0.50)]);
    p10.push(col[Math.floor(col.length*0.10)]);
    p90.push(col[Math.floor(col.length*0.90)]);
  }

  return { median, p10, p90 };
}

function drawTrajectory(){
  const canvas = $("trajCanvas");
  const ctx = canvas.getContext("2d");
  const { w, h } = fitCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const finals = finalizedDays(trajRange);
  if(!finals.length){
    $("insMeta").textContent = `Need ${MIN_FINAL_FOR_PROB} finalized days`;
    $("insJarvis").textContent = "Jarvis: finalize 7 päivää → trajectory herää.";
    ctx.fillStyle="rgba(94,231,255,0.10)";
    ctx.fillRect(0,0,w,h);
    return;
  }

  const scores = finals.map(d=>scoreDay(d).score);
  const ghosts = finals.map(d=>{
    const g = buildGhostDay(d);
    return g ? scoreDay(g).score : null;
  });

  const forecast = mcForecastFromHistory(finals, FORECAST_DAYS);
  const post = betaPosteriorGood(finals);
  const drift = patRileyDriftIndex(finals);
  const driftWord = drift > 0.06 ? "up" : (drift < -0.06 ? "down" : "flat");

  const pg = Math.round(post.mean*100);
  const pd = pDrift7();
  const py = pYouBeatsGhost();

  $("insMeta").textContent = `P(good) ${pg}% · P(drift7) ${pd ?? "—"}% · You>Ghost ${py ?? "—"}% · Drift ${driftWord}`;
  $("insJarvis").textContent = driftWord==="up"
    ? "Jarvis: suunta nousee. Pidä palautus aikaisena."
    : driftWord==="down"
      ? "Jarvis: suunta laskee. Tee yksi palauttava teko aikaisemmin."
      : "Jarvis: tasainen. Pieni rytmimuutos tekee eron.";

  const all = [...scores, ...ghosts.filter(x=>x!=null)];
  if(forecast) all.push(...forecast.p10, ...forecast.p90);
  const minS = Math.min(-2.8, ...all, 0);
  const maxS = Math.max( 3.2, ...all, 0);

  const pad = Math.round(Math.min(w,h)*0.08);
  const iw = w - pad*2;
  const ih = h - pad*2;
  const axisX = Math.round(pad + iw*0.56);
  const baseY = pad + ih;

  const mapX = s => axisX + ((s - (minS+maxS)/2) / (maxS-minS)) * (iw*0.46);
  const mapY = i => baseY - (i / Math.max(1, (scores.length-1))) * (ih*0.82);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "rgba(94,231,255,0.12)";
  ctx.lineWidth = 1;
  const gx = Math.max(28, Math.round(w/9));
  const gy = Math.max(28, Math.round(h/12));
  for(let x=0;x<w;x+=gx){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=gy){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(94,231,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(axisX,pad); ctx.lineTo(axisX,pad+ih); ctx.stroke();
  ctx.restore();

  if(forecast){
    const startY = mapY(scores.length-1);
    const fMapY = j => startY - ((j+1)/FORECAST_DAYS) * (ih*0.30);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "rgba(94,231,255,0.30)";
    ctx.beginPath();
    for(let j=0;j<FORECAST_DAYS;j++){
      const y = fMapY(j);
      const x = mapX(forecast.p10[j]);
      if(j===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    for(let j=FORECAST_DAYS-1;j>=0;j--){
      const y = fMapY(j);
      const x = mapX(forecast.p90[j]);
      ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([8,10]);
    ctx.strokeStyle = "rgba(94,231,255,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for(let j=0;j<FORECAST_DAYS;j++){
      const y = fMapY(j);
      const x = mapX(forecast.median[j]);
      if(j===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.setLineDash([7,9]);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for(let i=0;i<ghosts.length;i++){
    const gs = ghosts[i];
    if(gs==null) continue;
    const x = mapX(gs), y = mapY(i);
    if(i===0 || ghosts[i-1]==null) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(94,231,255,0.18)";
  ctx.lineWidth = 12;
  ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.beginPath();
  for(let i=0;i<scores.length;i++){
    const x = mapX(scores[i]), y = mapY(i);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(94,231,255,0.88)";
  ctx.lineWidth = 3;
  ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.beginPath();
  for(let i=0;i<scores.length;i++){
    const x = mapX(scores[i]), y = mapY(i);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.restore();

  const last = scores.at(-1) ?? 0;
  ctx.save();
  ctx.fillStyle = "rgba(255,216,77,0.90)";
  ctx.beginPath();
  ctx.arc(mapX(last), mapY(scores.length-1), 5, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function renderMonthCalendar(year, month){
  const grid = $("calendarGrid");
  grid.innerHTML = "";

  const base = new Date(year, month, 1);
  $("calTitle").textContent = base.toLocaleDateString(undefined,{month:"long",year:"numeric"});

  const first = new Date(year, month, 1);
  const startDay = (first.getDay()+6)%7;
  const daysInMonth = new Date(year, month+1, 0).getDate();

  for(let i=0;i<startDay;i++){
    const ph = document.createElement("div");
    ph.className = "dayCell dim";
    grid.appendChild(ph);
  }

  const todayIso = isoToday();

  for(let d=1; d<=daysInMonth; d++){
    const cell = document.createElement("div");
    cell.className = "dayCell";

    const num = document.createElement("div");
    num.className = "dayNum";
    num.textContent = d;

    const bars = document.createElement("div");
    bars.className = "dayBars";

    const iso = new Date(year, month, d).toISOString().slice(0,10);
    const day = app.days.find(x=>x.date===iso);

    if(iso === todayIso) cell.classList.add("today");
    if(iso === selectedDate) cell.classList.add("selected");

    if(day && (day.events||[]).length){
      const counts = scoreDay(day).counts;
      for(const c of COLORS){
        const v = counts[c.id] || 0;
        if(v>0){
          const dot = document.createElement("div");
          dot.className = "dot";
          dot.style.background = c.hex;
          dot.style.opacity = Math.min(1, 0.35 + v*0.10);
          bars.appendChild(dot);
        }
      }
    }

    cell.appendChild(num);
    cell.appendChild(bars);

    cell.addEventListener("click", ()=>{
      selectedDate = iso;
      setView("today");
      renderAll();
    });

    grid.appendChild(cell);
  }

  $("calHint").textContent = "Tap päivä → näet sen päivän flow. Back → palaa tähän päivään.";
}

function setView(v){
  $("viewToday").style.display = (v==="today") ? "" : "none";
  $("viewCoach").style.display = (v==="coach") ? "" : "none";
  $("viewTrajectory").style.display = (v==="traj") ? "" : "none";
  $("viewCalendar").style.display = (v==="cal") ? "" : "none";

  $("tabToday").setAttribute("aria-pressed", v==="today" ? "true":"false");
  $("tabCoach").setAttribute("aria-pressed", v==="coach" ? "true":"false");
  $("tabTrajectory").setAttribute("aria-pressed", v==="traj" ? "true":"false");
  $("tabCalendar").setAttribute("aria-pressed", v==="cal" ? "true":"false");
}

function renderHeader(day, isToday){
  $("hudDate").textContent = day.date;
  $("hudWake").textContent = `Wake ${fmtTime(day.wakeTs)}`;
  $("hudTaps").textContent = `Taps ${(day.events||[]).length}`;
  $("hudState").textContent = day.finalized ? "LOCKED" : "LIVE";

  const pg = pGood();
  const py = pYouBeatsGhost();
  $("hudOdds").textContent = pg==null ? "Odds —" : `P(good) ${pg}%`;
  $("hudGhost").textContent = py==null ? "Ghost —" : `You>Ghost ${py}%`;

  $("finalizeBtn").disabled = !isToday || day.finalized;
  $("finalizeBtn").style.opacity = (!isToday || day.finalized) ? "0.45" : "1";

  $("subLine").textContent = isToday
    ? (day.finalized ? "Locked. Truth saved." : "TODAY — Tap what you actually did. Close app.")
    : "History view. Read-only.";

  $("holoTitle").textContent = isToday ? "Today Flow" : `Day Flow · ${day.date}`;
  $("backToTodayBtn").style.display = isToday ? "none" : "inline-flex";
}

function addEvent(colorId){
  const day = getDay(isoToday());
  if(day.finalized) return;
  const t = now();
  if(!day.wakeTs) day.wakeTs = t;
  day.events.push({ t, c:colorId });
  day.events = day.events.slice(-MAX_EVENTS_PER_DAY);
  save();
  renderAll();
  toast(colorId.toUpperCase());
}

function undoLast(){
  const day = getDay(isoToday());
  if(day.finalized) return;
  if(!day.events.length) return;
  day.events.pop();
  if(!day.events.length){ day.wakeTs = null; day.finalTs = null; }
  save();
  renderAll();
  toast("UNDO");
}

function finalizeDay(){
  const day = getDay(isoToday());
  if(day.finalized) return;
  day.finalTs = now();
  day.score = scoreDay(day).score;
  day.insight = dailyJarvis(day);
  day.finalized = true;
  if(app.coachPins[day.date]) day.coach = coachGenerateForDate(day.date);
  save();
  renderAll();
  toast("FINALIZED");
}

function renderJarvis(day){
  $("jarvisLine").textContent = day.finalized ? (day.insight || dailyJarvis(day)) : dailyJarvis(day);
}

function renderAll(){
  const isToday = (selectedDate === isoToday());
  const day = getDay(selectedDate);

  renderHeader(day, isToday);
  renderJarvis(day);
  drawHolo(day);

  coachRender(isoToday());

  renderMonthCalendar(calCursor.y, calCursor.m);
  drawTrajectory();

  save();
}

function bindCards(){
  $all(".card").forEach(btn=>{
    const c = btn.dataset.c;
    let pressTimer = null;
    let longPressed = false;

    btn.addEventListener("pointerdown", ()=>{
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(()=>{
        longPressed = true;
        undoLast();
      }, LONG_PRESS_MS);
    }, {passive:true});

    const cancel = ()=>{ clearTimeout(pressTimer); pressTimer=null; };
    btn.addEventListener("pointerup", cancel, {passive:true});
    btn.addEventListener("pointercancel", cancel, {passive:true});
    btn.addEventListener("pointerleave", cancel, {passive:true});

    btn.addEventListener("click", ()=>{
      if(longPressed) return;
      addEvent(c);
    });
  });

  $("finalizeBtn").addEventListener("click", finalizeDay);

  $("backToTodayBtn").addEventListener("click", ()=>{
    selectedDate = isoToday();
    setView("today");
    renderAll();
  });

  window.addEventListener("resize", ()=>{
    drawHolo(getDay(selectedDate));
    drawTrajectory();
  }, {passive:true});
}

function bindTabs(){
  $("tabToday").addEventListener("click", ()=>{ setView("today"); renderAll(); });
  $("tabCoach").addEventListener("click", ()=>{ setView("coach"); renderAll(); });
  $("tabTrajectory").addEventListener("click", ()=>{ setView("traj"); renderAll(); });
  $("tabCalendar").addEventListener("click", ()=>{ setView("cal"); renderAll(); });
}

function bindCalendarNav(){
  $("calPrev").addEventListener("click", ()=>{
    calCursor.m--;
    if(calCursor.m<0){ calCursor.m=11; calCursor.y--; }
    renderAll();
  });
  $("calNext").addEventListener("click", ()=>{
    calCursor.m++;
    if(calCursor.m>11){ calCursor.m=0; calCursor.y++; }
    renderAll();
  });
}

function bindRange(){
  $("range30").addEventListener("click", ()=>{
    trajRange = 30;
    $("range30").setAttribute("aria-pressed","true");
    $("range90").setAttribute("aria-pressed","false");
    renderAll();
  });
  $("range90").addEventListener("click", ()=>{
    trajRange = 90;
    $("range30").setAttribute("aria-pressed","false");
    $("range90").setAttribute("aria-pressed","true");
    renderAll();
  });
}

function bindCoach(){
  $("coachRefresh").addEventListener("click", ()=>{
    const day = getDay(isoToday());
    day.coach = null;
    save();
    renderAll();
    toast("REFRESH");
  });

  $("coachPin").addEventListener("click", ()=>{
    const d = isoToday();
    app.coachPins[d] = !app.coachPins[d];
    const day = getDay(d);
    if(app.coachPins[d]) day.coach = coachGenerateForDate(d);
    save();
    renderAll();
    toast(app.coachPins[d] ? "PINNED" : "UNPIN");
  });
}

function bindLLM(){
  const endpointEl = $("llmEndpoint");
  const modelEl = $("llmModel");
  const keyEl = $("llmKey");
  const rememberEl = $("llmRemember");

  endpointEl.value = app.llm.endpoint || "";
  modelEl.value = app.llm.model || "";
  keyEl.value = "";
  rememberEl.checked = !!app.llm.remember;

  function persist(){
    if(rememberEl.checked){
      app.llm.endpoint = endpointEl.value.trim();
      app.llm.model = modelEl.value.trim();
      app.llm.remember = true;
    } else {
      app.llm.remember = false;
      delete app.llm.endpoint;
      delete app.llm.model;
    }
    save();
  }

  rememberEl.addEventListener("change", persist);
  endpointEl.addEventListener("change", persist);
  modelEl.addEventListener("change", persist);

  $("llmRun").addEventListener("click", async ()=>{
    const endpoint = endpointEl.value.trim();
    const model = modelEl.value.trim();
    const key = keyEl.value.trim();
    if(!endpoint || !model || !key){
      $("llmOut").textContent = "LLM: tarvitset endpoint + model + api key.";
      return;
    }

    const payload = buildLLMCoachPayload();
    const prompt = buildLLMCoachPrompt(payload);

    $("llmOut").textContent = "LLM: running…";
    try{
      const res = await fetch(endpoint, {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages:[
            { role:"system", content:"You are a calm, precise coach. Output max 3 sentences. No fluff. No praise. No shame." },
            { role:"user", content: prompt }
          ],
          temperature: 0.3
        })
      });

      if(!res.ok){
        const t = await res.text();
        $("llmOut").textContent = `LLM error: ${res.status} ${t.slice(0,200)}`;
        return;
      }

      const json = await res.json();
      const text =
        json?.choices?.[0]?.message?.content ??
        json?.choices?.[0]?.text ??
        null;

      $("llmOut").textContent = text ? text.trim() : "LLM: empty response.";
      if(rememberEl.checked) persist();
    }catch(e){
      $("llmOut").textContent = `LLM failed: ${String(e).slice(0,180)}`;
    }
  });
}

function buildLLMCoachPayload(){
  const finals = finalizedDays(30);
  const last7 = finalizedDays(7);
  const pg = pGood();
  const pd = pDrift7();
  const py = pYouBeatsGhost();
  const drift = patRileyDriftIndex(finals);

  const aggCounts = Object.fromEntries(COLORS.map(c=>[c.id,0]));
  for(const d of finals){
    const r = scoreDay(d);
    for(const k in r.counts) aggCounts[k] += r.counts[k] || 0;
  }

  const top = Object.entries(aggCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
  const missing = COLORS.map(c=>c.id).filter(id=>aggCounts[id]===0);

  const driftSignals = [];
  const negLast7 = last7.filter(d=>scoreDay(d).score<0).length;
  if(negLast7>=3) driftSignals.push("many negative days recently");
  const badRate = finals.length ? finals.reduce((s,d)=>s+scoreDay(d).badFrac,0)/finals.length : 0;
  if(badRate>0.22) driftSignals.push("bad habits appear frequently");
  if(drift < -0.06) driftSignals.push("trend drifting down");

  return {
    windowDays: finals.length,
    goodProbability: pg,
    drift7: pd,
    youBeatsGhost: py,
    driftIndex: drift,
    dominantActions: top,
    missingActions: missing.slice(0,4),
    driftSignals
  };
}

function buildLLMCoachPrompt(payload){
  return [
    "Here is behavior summary JSON. Create a 3-sentence coach brief:",
    "1) Dominant pattern (truthful, calm)",
    "2) Smallest leverage action",
    "3) Warning if drift signals exist",
    "No fluff. No generic advice. Reference probabilities if present.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function finalDiagnostic(){
  const ids = ["finalizeBtn","holoCanvas","trajCanvas","tabToday","tabCoach","tabTrajectory","tabCalendar","calendarGrid","coachRefresh","coachPin","llmRun","llmEndpoint","llmModel","llmKey","llmRemember"];
  const miss = ids.filter(id=>!$(id));
  if(miss.length) return { ok:false, msg:`Missing DOM: ${miss[0]}` };
  try{
    const t="__pb_test__";
    localStorage.setItem(t,"1");
    localStorage.removeItem(t);
  }catch{
    return { ok:false, msg:"LocalStorage not available" };
  }
  normalizeAll();
  return { ok:true, msg:"READY" };
}

function init(){
  load();
  bindTabs();
  bindCalendarNav();
  bindRange();
  bindCoach();
  bindLLM();
  bindCards();

  selectedDate = isoToday();
  setView("today");
  renderAll();

  const diag = finalDiagnostic();
  toast(diag.msg);
}

window.addEventListener("load", init);
