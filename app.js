const STORAGE_KEY="personalOS.v1";

function load(){
  const raw=localStorage.getItem(STORAGE_KEY);
  if(!raw)return {goals:[],days:{}};
  try{return JSON.parse(raw)}catch{return {goals:[],days:{}}}
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}

let state=load();
let currentDate=todayISO();

function todayISO(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Helsinki"}).format(new Date());
}

function getDay(d){
  if(!state.days[d])state.days[d]={events:[],finalized:false,close:{}};
  return state.days[d];
}

function render(){
  renderConsole();
  renderLedger();
  updateTicker();
  save();
}

function updateTicker(){
  document.getElementById("ticker").textContent=
    "I believe: Focus · Evidence: — · "+
    new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit"}).format(new Date());
}

/* Console */

function renderConsole(){
  const el=document.getElementById("goals");
  el.innerHTML="";
  state.goals.forEach((g,i)=>{
    const div=document.createElement("div");
    div.className="card";
    div.innerHTML=`<b>${g.name}</b>`;
    el.appendChild(div);
  });
  document.getElementById("meta").textContent=
    state.goals.length+" goals";
}

document.getElementById("btnAddGoal").onclick=()=>{
  const name=prompt("Goal name");
  if(!name)return;
  state.goals.push({name});
  render();
};

/* Ledger */

const EVENTS=["DECISION_MADE","EXECUTION","DRAG","DEFERRED","AVOIDED"];

function renderLedger(){
  const grid=document.getElementById("eventGrid");
  grid.innerHTML="";
  EVENTS.forEach(e=>{
    const b=document.createElement("button");
    b.textContent=e;
    b.onclick=()=>logEvent(e);
    grid.appendChild(b);
  });

  document.getElementById("dateLabel").textContent=currentDate;
  const day=getDay(currentDate);
  document.getElementById("lineMoved").textContent=day.close.moved||"—";
  document.getElementById("lineDrag").textContent=day.close.drag||"—";
  document.getElementById("lineNext").textContent=day.close.next||"—";
}

function logEvent(t){
  const day=getDay(currentDate);
  if(day.finalized)return;
  day.events.push({t});
  render();
}

document.getElementById("btnUndo").onclick=()=>{
  const day=getDay(currentDate);
  day.events.pop();
  render();
};

document.getElementById("btnFinalize").onclick=()=>{
  const day=getDay(currentDate);
  if(day.finalized)return;
  const moved=day.events.filter(e=>e.t==="EXECUTION").length;
  const drag=day.events.filter(e=>e.t==="DRAG").length;
  day.close={
    moved:moved?"EXECUTION":"—",
    drag:drag?"DRAG":"—",
    next:"Make one clear decision."
  };
  day.finalized=true;
  render();
};

/* Tabs */

document.getElementById("tabConsole").onclick=()=>{
  document.getElementById("viewConsole").classList.remove("hidden");
  document.getElementById("viewLedger").classList.add("hidden");
};

document.getElementById("tabLedger").onclick=()=>{
  document.getElementById("viewLedger").classList.remove("hidden");
  document.getElementById("viewConsole").classList.add("hidden");
};

render();
