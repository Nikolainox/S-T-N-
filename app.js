const KEY="panic90";
const COLORS=["mind","body","food","rest","bad","deep","cult"];
let app={days:[]};

const $=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);

function load(){
  const d=localStorage.getItem(KEY);
  if(d) app=JSON.parse(d);
}
function save(){localStorage.setItem(KEY,JSON.stringify(app));}

function getDay(date){
  let d=app.days.find(x=>x.date===date);
  if(!d){d={date,events:[],final:false,wake:null};app.days.push(d);}
  return d;
}

function tap(c){
  const d=getDay(today());
  if(!d.wake) d.wake=Date.now();
  d.events.push({c,t:Date.now()});
  render(); save();
}

function finalize(){
  const d=getDay(today());
  d.final=true; save(); render();
}

function draw(d){
  const c=$("holoCanvas");
  const ctx=c.getContext("2d");
  c.width=c.clientWidth;
  c.height=c.clientHeight;
  ctx.clearRect(0,0,c.width,c.height);
  d.events.forEach((e,i)=>{
    ctx.strokeStyle="#5ee7ff";
    ctx.beginPath();
    ctx.moveTo(140,i*10);
    ctx.lineTo(160,i*10+10);
    ctx.stroke();
  });
}

function renderCalendar(){
  const g=$("calendarGrid"); g.innerHTML="";
  app.days.forEach(d=>{
    const cell=document.createElement("div");
    cell.className="dayCell";
    g.appendChild(cell);
  });
}

function render(){
  const d=getDay(today());
  $("hudDate").textContent=d.date;
  $("hudWake").textContent=d.wake?new Date(d.wake).toLocaleTimeString():"—";
  $("hudTaps").textContent=d.events.length;
  $("hudDayIdx").textContent=app.days.length;
  draw(d); renderCalendar();
  $("jarvisLine").textContent=d.final
    ? "Jarvis: päivä lukittu."
    : "Jarvis: paina väriä.";
}

document.querySelectorAll(".panic").forEach(b=>{
  b.onclick=()=>tap(b.dataset.c);
});
$("finalizeBtn").onclick=finalize;

load(); render();
