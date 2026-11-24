/* Project Pulse — real app. Data lives in the Google Sheet behind window.PULSE_API (Apps Script). */
"use strict";
const DAY=864e5, H=36e5, GOAL=10;
const TAGC=["tw1","tw2","twp","twb"];
const BLOCKERS=["MEP","Structure","Client","Project manager"];
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};

let TOKEN=store.get("pulse-token"), ME=null, TEAMS=[], TEAM=null, ROLE="team", PROJECTS=[], PEOPLE=[], INVITES=[];
const S={tasks:[],updates:[],log:[],ms:[],cur:store.get("pulse-project"),tab:"main",open:null,filter:null};
let lastInvite=null, authMode="in", authErr="", LOGO="", EDIT=null, CONFIRM=null;

/* ---------- api ---------- */
async function api(action,body,tries){
  tries=tries==null?2:tries;let j;
  try{
    const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),30000);
    const r=await fetch(window.PULSE_API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(Object.assign({action,token:TOKEN},body||{})),signal:ctl.signal});
    clearTimeout(tm);j=await r.json();
  }catch(e){
    const safe=/^(me|load|login)$/.test(action);
    if(safe&&tries>1)return api(action,body,tries-1);
    throw new Error("Can't reach the server. Check your internet and try again.");
  }
  if(!j.ok){if(/sign in/i.test(j.error||"")&&action!=="login"&&action!=="signup")signOut(true);throw new Error(j.error||"Something went wrong")}
  return j;
}
let saving=0, WRITES_N=0;
function busy(d){saving+=d;const el=document.getElementById("saving");if(el)el.textContent=saving>0?"Saving…":"Saved"}
async function send(action,body,okMsg){
  busy(1);
  try{const j=await api(action,body);WRITES_N++;busy(-1);if(okMsg)toast(okMsg);return j}
  catch(e){busy(-1);toast(e.message);await reload();throw e}
}

/* ---------- helpers ---------- */
const P=id=>PEOPLE.find(p=>p.id===id);
const me=()=>P(ME.id)||{id:ME.id,name:ME.name,mgr:ROLE==="mgr",color:"#141b2b"};
const team=()=>PEOPLE.filter(p=>!p.mgr);
const assignees=()=>{const m=me();return m.mgr?[...team(),m]:team()};
function dstr(ms){const d=new Date(ms);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function midnight(ms){const d=new Date(ms);d.setHours(0,0,0,0);return d.getTime()}
const daysTo=iso=>Math.round((midnight(new Date(iso+"T12:00").getTime())-midnight(Date.now()))/DAY);
const longDate=iso=>new Date(iso+"T12:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nm=id=>P(id)?.name||"Someone";
const av=(id,sm)=>{const p=P(id);if(!p)return `<span class="av ${sm?"sm":""}" style="background:var(--muted)">?</span>`;return `<span class="av ${sm?"sm":""}" style="background:${esc(p.color)}" title="${esc(p.name)}">${esc((p.name||"?")[0].toUpperCase())}${p.mgr&&!sm?'<span class="mgr"></span>':""}</span>`};
function tagc(s){let h=0;for(const c of String(s).toLowerCase())h=(h*31+c.charCodeAt(0))>>>0;return TAGC[h%TAGC.length]}
const aboutTag=s=>s?`<span class="tag ${tagc(s)}">${esc(s)}</span>`:`<span class="tag due">Whole project</span>`;
function allTags(){const m=new Map();[...S.tasks,...S.updates].forEach(x=>{if(x.about){const k=x.about.toLowerCase();m.set(k,{n:(m.get(k)||{n:0}).n+1,v:x.about})}});return [...m.values()].sort((a,b)=>b.n-a.n).map(x=>x.v)}
function dueInfo(due){if(!due)return{c:"",t:"No due date"};const diff=daysTo(due);
  if(diff<0)return{c:"late",t:`${-diff} day${diff<-1?"s":""} late`};if(diff===0)return{c:"today",t:"Due today"};if(diff===1)return{c:"",t:"Due tomorrow"};
  return{c:"",t:"Due "+new Date(due+"T12:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}}
function ago(ms){if(!ms)return"";const m=Math.round((Date.now()-ms)/6e4);if(m<1)return"just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+"h ago";const d=Math.round(h/24);return d===1?"yesterday":d+" days ago"}
function fmtWhen(ms){return new Date(ms).toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
function toast(t){const el=document.getElementById("toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),3200)}
const weekDone=()=>S.tasks.filter(k=>k.status==="done"&&k.doneAt>Date.now()-7*DAY);
const MS=id=>S.ms.find(m=>m.id===id);
const upcoming=()=>S.ms.filter(m=>daysTo(m.date)>=0).sort((a,b)=>a.date.localeCompare(b.date));
const isLate=k=>k.status!=="done"&&(k.dueAt?Date.now()>k.dueAt:!!k.due&&daysTo(k.due)<0);
const onTimeK=k=>k.doneAt<=(k.dueAt||new Date(k.due+"T23:59").getTime());
const fullT=ms=>ms?dShort(ms)+" "+tShort(ms):"";
const hm=ms=>new Date(ms).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
function durTxt(ms){const m=Math.round(Math.abs(ms)/6e4),d=Math.floor(m/1440),h=Math.floor(m%1440/60),mi=m%60;if(m<1)return"under a minute";return d?`${d}d${h?" "+h+"h":""}`:h?`${h}h${mi?" "+mi+"m":""}`:`${mi} min`}
const dayWord=ms=>{const d=daysTo(dstr(ms));return d===0?"today":d===1?"tomorrow":d===-1?"yesterday":new Date(ms).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})};
const shortWhen=ms=>dayWord(ms)+" "+hm(ms);
function dueK(k){if(!k.dueAt)return dueInfo(k.due);const left=k.dueAt-Date.now();
  if(left<0)return{c:"late",t:`${durTxt(left)} late`};return{c:left<24*H?"today":"",t:`⏱ ${durTxt(left)} left · by ${shortWhen(k.dueAt)}`}}
function tline(k){const s=[`Given ${shortWhen(k.at)}`];
  if(k.seenAt)s.push(`<b>${k.startedAt&&Math.abs(k.startedAt-k.seenAt)<=6e4?"Got it &amp; started":"Got it"} ${shortWhen(k.seenAt)}</b> <i>(${durTxt(k.seenAt-k.at)} after)</i>`);else s.push(`<b class="no">Not opened yet</b>`);
  if(k.startedAt&&Math.abs(k.startedAt-(k.seenAt||0))>6e4)s.push(`Started ${shortWhen(k.startedAt)}`);if(k.status==="done"&&k.doneAt)s.push(`Done ${shortWhen(k.doneAt)}`);
  return `<div class="tline">${s.join(" → ")}</div>`}
const fmtDue=(due,at)=>at?shortWhen(at):due?new Date(due+"T12:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"no date";
const dueCell=k=>k.dueAt?new Date(k.dueAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})+" "+hm(k.dueAt):k.due?new Date(k.due+"T12:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"}):"";
function logLocal(txt){S.log.push({at:Date.now(),who:ME.id,txt})}

/* ---------- milestones & warnings ---------- */
function msInfo(m){
  const ts=S.tasks.filter(k=>k.ms===m.id),done=ts.filter(k=>k.status==="done").length,ready=m.items.filter(i=>i.ok).length;
  const total=ts.length+m.items.length,got=done+ready,pct=total?Math.round(got/total*100):0;
  const late=ts.filter(isLate).length,stuck=ts.filter(k=>k.status==="stuck").length,left=daysTo(m.date);
  const risk=left<0?"":(late||stuck)&&left<=7?"red":(left<=7&&pct<70)?"amber":"";
  return{ts,done,ready,total,got,pct,late,stuck,left,risk};
}
function countdown(m,i){if(i.left<0)return `<div class="count">✓<small>${-i.left} days ago</small></div>`;
  return `<div class="count ${i.risk}">${i.left===0?"Today":i.left}<small>${i.left===0?"delivery day":i.left===1?"day left":"days left"}</small></div>`}
function bar(i){return `<div class="pbar ${i.risk}" role="img" aria-label="${i.pct}% ready"><span style="width:${i.pct}%"></span></div>`}
function myWarnings(uid){
  const out=[];
  S.tasks.filter(k=>k.to===uid&&k.status!=="done"&&k.due).forEach(k=>{
    const d=daysTo(k.due),m=MS(k.ms),ml=m?daysTo(m.date):null;
    if(k.dueAt){const left=k.dueAt-Date.now(),ms2=m&&ml>=0?` ${m.name} is ${ml===0?"today":ml===1?"tomorrow":"in "+ml+" days"}.`:"";
      if(left<0)out.push({c:"red",b:`“${k.title}” is ${durTxt(left)} late.`,t:`${ms2} Finish it, or tap “I'm stuck” so ${nm(k.by)} can help.`});
      else if(left<24*H)out.push({c:"amber",b:`“${k.title}”: ${durTxt(left)} left (by ${shortWhen(k.dueAt)}).`,t:ms2||" Keep going!"});return}
    const msTxt=m&&ml>=0?` ${m.name} is ${ml===0?"today":ml===1?"tomorrow":"in "+ml+" days"}.`:"";
    if(d<0)out.push({c:"red",b:`“${k.title}” is ${-d} day${d<-1?"s":""} late.`,t:`${msTxt} Finish it, or tap “I'm stuck” so ${nm(k.by)} can help.`});
    else if(d<=1)out.push({c:"amber",b:`“${k.title}” is due ${d===0?"today":"tomorrow"}.`,t:msTxt||" Keep going!"});
    else if(m&&ml>=0&&ml<=3&&k.status==="new")out.push({c:"amber",b:`You haven't started “${k.title}”.`,t:msTxt});
  });
  return out.sort((a,b)=>(a.c==="red"?0:1)-(b.c==="red"?0:1));
}
function mgrWarnings(){
  return upcoming().map(m=>({m,i:msInfo(m)})).filter(x=>x.i.risk&&x.i.left<=10).map(({m,i})=>({c:i.risk,b:`${m.name} is ${i.left===0?"today":"in "+i.left+" day"+(i.left>1?"s":"")} and only ${i.pct}% is ready.`,
    t:` ${i.late?i.late+" task"+(i.late>1?"s":"")+" late. ":""}${i.stuck?i.stuck+" stuck. ":""}${i.total-i.got} items left.`}));
}
const warnBox=ws=>ws.length?`<div class="warns">${ws.slice(0,4).map(w=>`<div class="warn ${w.c}" role="alert"><span class="ic">${w.c==="red"?"!":"⏱"}</span><div class="tx"><b>${esc(w.b)}</b>${esc(w.t)}</div></div>`).join("")}</div>`:"";

function confetti(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const c=document.getElementById("fx"),x=c.getContext("2d");c.width=innerWidth;c.height=innerHeight;
  const cols=["#ff5a36","#0f9d8c","#f5b100","#6b4fd8","#2f6fe0","#e0478a"];
  const ps=Array.from({length:120},()=>({x:innerWidth/2+(Math.random()-.5)*160,y:innerHeight*.55,vx:(Math.random()-.5)*14,vy:-Math.random()*15-6,r:Math.random()*6+4,c:cols[Math.random()*cols.length|0],a:Math.random()*6,s:(Math.random()-.5)*.3}));
  let f=0;(function tick(){x.clearRect(0,0,c.width,c.height);ps.forEach(p=>{p.vy+=.45;p.x+=p.vx;p.y+=p.vy;p.vx*=.99;p.a+=p.s;x.save();x.translate(p.x,p.y);x.rotate(p.a);x.fillStyle=p.c;x.fillRect(-p.r/2,-p.r/4,p.r,p.r/2);x.restore()});
    if(++f<110)requestAnimationFrame(tick);else x.clearRect(0,0,c.width,c.height)})();
}

/* ---------- celebrations & trophies ---------- */
const wins=()=>S.ms.filter(m=>{const i=msInfo(m);return i.total>0&&i.pct===100}).sort((a,b)=>b.date.localeCompare(a.date));
function celebrate(o){
  document.querySelectorAll(".celebrate").forEach(e=>e.remove());
  const el=document.createElement("div");el.className="celebrate"+(o.team?" team":"");el.setAttribute("role","dialog");el.setAttribute("aria-label",o.title);
  el.innerHTML=`<div class="cbox"><div class="cicon">${o.team?"🏆":"🎉"}</div><h2>${esc(o.title)}</h2><p>${esc(o.sub||"")}</p>${o.team?`<div class="cteam">${PEOPLE.map(p=>av(p.id)).join("")}</div>`:""}<button class="btn go" type="button">${o.team?"Yes, team!":"Thanks!"}</button></div>`;
  const close=()=>{el.classList.add("out");setTimeout(()=>el.remove(),250)};
  el.addEventListener("click",e=>{if(e.target===el||e.target.tagName==="BUTTON")close()});
  document.body.appendChild(el);confetti();if(o.team)setTimeout(confetti,700);
  if(!o.team)setTimeout(close,4200);
}
function teamWin(m){
  const key="pulse-wins-"+ME.id;let seen=[];try{seen=JSON.parse(store.get(key)||"[]")}catch(e){}
  if(seen.includes(m.id))return;seen.push(m.id);store.set(key,JSON.stringify(seen));
  celebrate({team:true,title:`${m.name} is delivered!`,sub:`Every item and every task is done. Great work, ${TEAM.name}! A new trophy is on the shelf.`});
}
function checkWins(){const w=wins().find(m=>{try{return !JSON.parse(store.get("pulse-wins-"+ME.id)||"[]").includes(m.id)}catch(e){return true}});if(w)teamWin(w)}
function trophyShelf(){const w=wins();
  return `<div class="panel"><h2>Trophy shelf <span class="n">${w.length}</span></h2>${w.length?`<div class="trophies">${w.map(m=>`<div class="trophy" title="${esc(m.name)} · ${longDate(m.date)}"><span>🏆</span><b>${esc(m.name)}</b><small>${new Date(m.date+"T12:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</small></div>`).join("")}</div>`
    :`<div class="hint">Finish every item and task of a delivery to win the team a trophy.</div>`}</div>`}

/* ---------- auth ---------- */
function renderAuth(){
  const inv=new URLSearchParams(location.search).get("invite")||"";
  if(inv&&authMode==="in"&&!renderAuth.seen){authMode="up";renderAuth.seen=1}
  document.getElementById("tabs").innerHTML="";document.getElementById("who").innerHTML="";
  ["teamsel","projsel"].forEach(i=>document.getElementById(i).hidden=true);
  document.getElementById("view").innerHTML=`<div class="auth">
    <h1 style="text-align:center">${authMode==="in"?"Welcome back":"Join your team"}</h1>
    <form class="panel" id="authform">
      <div class="seg" style="align-self:center"><button type="button" data-act="authmode" data-v="in" aria-pressed="${authMode==="in"}">Sign in</button><button type="button" data-act="authmode" data-v="up" aria-pressed="${authMode==="up"}">Create account</button></div>
      ${authMode==="up"?`<label>Your name<input id="a-name" autocomplete="name" required></label>`:""}
      <label>Email<input id="a-email" type="email" autocomplete="email" required></label>
      <label>Password<input id="a-pass" type="password" autocomplete="${authMode==="in"?"current-password":"new-password"}" minlength="${authMode==="up"?8:1}" required></label>
      ${authMode==="up"?`<label>Invite code from your manager<input id="a-invite" value="${esc(inv)}" placeholder="e.g. K7M2QX9P" style="text-transform:uppercase"></label>
        <div class="or">No code? Start a new team and invite people later.</div>
        <label>New team or company name<input id="a-team" placeholder="e.g. Dewan Architects"></label>`:""}
      ${authErr?`<div class="err">${esc(authErr)}</div>`:""}
      <button class="btn go" type="submit" id="a-go" style="justify-content:center">${authMode==="in"?"Sign in":"Create account"}</button>
    </form>
    <p class="hint" style="text-align:center">Each team only ever sees its own projects.</p></div>`;
}
async function doAuth(){
  const v=id=>(document.getElementById(id)||{}).value||"";const btn=document.getElementById("a-go");btn.disabled=true;btn.textContent="One moment…";
  try{
    const j=authMode==="in"?await api("login",{email:v("a-email"),password:v("a-pass")})
      :await api("signup",{name:v("a-name"),email:v("a-email"),password:v("a-pass"),invite:v("a-invite").trim(),teamName:v("a-invite").trim()?"":v("a-team")});
    TOKEN=j.token;store.set("pulse-token",TOKEN);authErr="";history.replaceState(null,"",location.pathname);await boot();
  }catch(e){authErr=e.message;renderAuth()}
}
function signOut(silent){if(TOKEN&&!silent)api("logout").catch(()=>{});TOKEN=null;store.set("pulse-token",null);ME=null;authMode="in";if(!silent)toast("Signed out");renderAuth()}

/* ---------- loading ---------- */
async function boot(){
  if(!TOKEN)return renderAuth();
  try{const j=await api("me");ME=j.user;TEAMS=j.teams}catch(e){if(TOKEN)document.getElementById("view").innerHTML=`<div class="auth"><div class="panel empty">${esc(e.message)}<button class="btn go" data-act="retry" style="justify-content:center;margin-top:10px">Try again</button></div></div>`;return}
  if(!TEAMS.length){renderNoTeam();return}
  TEAM=TEAMS.find(t=>t.id===store.get("pulse-team"))||TEAMS[0];
  await reload();
}
async function reload(depth){
  if(!TOKEN||!TEAM)return;
  try{
    const v=WRITES_N;
    const j=await api("load",{teamId:TEAM.id,projectId:S.cur});
    if(v!==WRITES_N||saving>0){if((depth||0)<3)return reload((depth||0)+1);return}
    PEOPLE=j.members;ROLE=j.role;LOGO=j.team.logo||"";TEAM.name=j.team.name||TEAM.name;PROJECTS=j.projects;INVITES=j.invites||[];S.cur=j.projectId;
    S.tasks=j.tasks||[];S.updates=j.updates||[];S.ms=j.milestones||[];S.log=j.log||[];
    store.set("pulse-team",TEAM.id);store.set("pulse-project",S.cur);render();checkWins();
  }catch(e){toast(e.message)}
}
function renderNoTeam(){
  document.getElementById("view").innerHTML=`<div class="auth"><h1 style="text-align:center">Join a team</h1><div class="panel">
    <label>Invite code<input id="j-code" placeholder="e.g. K7M2QX9P" style="text-transform:uppercase"></label>
    <button class="btn go" data-act="jointeam" style="justify-content:center">Join</button></div>
    <button class="linkbtn" data-act="signout">Sign out</button></div>`;
}

/* ---------- top ---------- */
function renderTop(){
  const m=me(),ts=document.getElementById("teamsel"),ps=document.getElementById("projsel");
  ts.hidden=TEAMS.length<2;ts.innerHTML=TEAMS.map(t=>`<option value="${t.id}" ${t.id===TEAM.id?"selected":""}>${esc(t.name)}</option>`).join("");
  ps.hidden=!PROJECTS.length&&!m.mgr;
  ps.innerHTML=PROJECTS.map(p=>`<option value="${p.id}" ${p.id===S.cur?"selected":""}>${esc(p.name)}</option>`).join("")+(m.mgr?`<option value="__new" ${!S.cur?"selected":""}>+ New project…</option>`:"");
  document.getElementById("who").innerHTML=`<span class="saving" id="saving"></span><span class="mechip">${av(ME.id)}${esc(ME.name)}</span><button class="linkbtn" data-act="signout">Sign out</button>`;
  const un=S.updates.filter(u=>!u.seenBy.includes(ME.id)).length;
  const t=(k,l)=>`<button class="tab" data-act="tab" data-t="${k}" aria-pressed="${S.tab===k}">${l}</button>`;
  document.getElementById("tabs").innerHTML=S.cur?t("main",m.mgr?"Control room":"My day")+t("schedule","Schedule")+t("updates",`Updates${un?` <span class="dotn">${un}</span>`:""}`)+t("history","Report")+t("people",m.mgr?"Team &amp; settings":"Settings")+`<span class="spacer"></span><button class="linkbtn" data-act="refresh">Refresh</button>`:t("people",m.mgr?"Team &amp; settings":"Settings");
  document.getElementById("aboutlist").innerHTML=allTags().map(x=>`<option value="${esc(x)}">`).join("");
}

/* ---------- team view ---------- */
function taskCard(k){
  const d=dueK(k),open=S.open&&S.open.id===k.id?S.open.kind:null,m=MS(k.ms);
  let acts="";
  if(k.to===ME.id){
    if(k.status==="new")acts=`<button class="btn go" data-act="start" data-id="${k.id}">Start</button>`;
    if(k.status==="doing")acts=`<button class="btn teal" data-act="open" data-kind="done" data-id="${k.id}">Mark done</button><button class="btn" data-act="open" data-kind="stuck" data-id="${k.id}">I'm stuck</button>`;
    if(k.status==="stuck")acts=`<button class="btn go" data-act="unstuck" data-id="${k.id}">Unstuck, back on it</button>`;
  }
  let drawer="";
  if(open==="done")drawer=`<div class="drawer"><div class="q">When did you finish?</div><div class="chips">
     <button class="chip" data-act="done" data-id="${k.id}" data-w="now">Just now</button><button class="chip" data-act="done" data-id="${k.id}" data-w="morning">This morning</button><button class="chip" data-act="done" data-id="${k.id}" data-w="yesterday">Yesterday</button>
     <input type="date" id="dd-${k.id}" aria-label="Pick finish date" max="${dstr(Date.now())}"><button class="chip" data-act="done" data-id="${k.id}" data-w="pick">Use date</button></div></div>`;
  if(open==="stuck")drawer=`<div class="drawer"><div class="q">Who are you waiting on?</div><div class="chips">${[...BLOCKERS,...PEOPLE.filter(p=>p.mgr).map(p=>p.name)].map(b=>`<button class="chip" data-act="stuckon" data-id="${k.id}" data-b="${esc(b)}">${esc(b)}</button>`).join("")}</div>
     <input type="text" id="sn-${k.id}" placeholder="One line on what you need (optional)" aria-label="What you need"></div>`;
  return `<article class="task ${k.status==="done"?"isdone":""}">
    <div class="thead">${av(k.by,1)}<span><b style="color:var(--ink)">${esc(nm(k.by))}</b> · ${ago(k.at)}</span><span style="margin-left:auto" class="st ${k.status}">${{new:"New",doing:"Doing",stuck:"Stuck",done:"Done"}[k.status]}</span></div>
    <div class="ttl">${esc(k.title)}</div>
    <div class="tags">${aboutTag(k.about)}${m?`<span class="tag due">For ${esc(m.name)}</span>`:""}${k.status!=="done"?`<span class="tag due ${d.c}">${d.t}</span>`:""}
      ${k.status==="done"?`<span class="donewhen">Finished ${fmtWhen(k.doneAt)}${k.due&&onTimeK(k)?" · on time":""}</span>`:""}
      ${k.status==="stuck"?`<span class="note">Waiting on ${esc(k.stuckOn)}${k.stuckNote?": "+esc(k.stuckNote):""}</span>`:""}
      ${k.kudos.map(x=>`<span class="kudo">👏 ${esc(nm(x))}</span>`).join("")}</div>
    ${tline(k)}
    ${acts?`<div class="acts">${acts}</div>`:""}${drawer}</article>`;
}
function nextDelivery(){const m=upcoming()[0];if(!m)return `<div class="hint">No upcoming deliveries.</div>`;const i=msInfo(m);
  return `<div class="nextdel"><div class="mtop"><div><b>${esc(m.name)}</b><div class="hint">${longDate(m.date)}</div></div>${countdown(m,i)}</div>${bar(i)}<div class="hint"><b style="color:var(--ink)">${i.pct}% ready</b> · ${i.got} of ${i.total} items · ${i.total-i.got} left</div>
  <button class="linkbtn" data-act="tab" data-t="schedule" style="margin-top:6px;padding:0">Open schedule</button></div>`}
function towerBox(n){
  const floors=Math.min(n,GOAL),W=78,fh=11,base=GOAL*fh+26;
  let s=`<svg width="${W+30}" height="${base+4}" viewBox="0 0 ${W+30} ${base+4}" aria-hidden="true"><line x1="0" y1="${base}" x2="${W+30}" y2="${base}" stroke="var(--muted)" stroke-width="2"/>`;
  for(let i=0;i<GOAL;i++){const y=base-(i+1)*fh,on=i<floors;
    s+=`<rect x="14" y="${y}" width="${W-28}" height="${fh-2}" rx="2" fill="${on?(i%2?"var(--accent)":"var(--ink)"):"none"}" stroke="${on?"none":"var(--line)"}" stroke-dasharray="3 3"/>`;
    if(on)for(let w=0;w<4;w++)s+=`<rect x="${19+w*10}" y="${y+2.5}" width="5" height="4" fill="var(--sun)" opacity=".9"/>`}
  const top=base-floors*fh;
  if(floors<GOAL)s+=`<g stroke="var(--sun)" stroke-width="2" fill="none"><line x1="${W-6}" y1="${base}" x2="${W-6}" y2="${top-18}"/><line x1="8" y1="${top-18}" x2="${W+24}" y2="${top-18}"/><line x1="20" y1="${top-18}" x2="20" y2="${top-6}"/></g><rect x="16" y="${top-6}" width="8" height="5" fill="var(--sun)"/>`;
  else s+=`<line x1="${W/2}" y1="${top}" x2="${W/2}" y2="${top-20}" stroke="var(--ink)" stroke-width="2"/><path d="M${W/2} ${top-20}h16l-4 5 4 5h-16z" fill="var(--accent)"/>`;
  return `<div class="towerbox">${s}</svg><div><div class="big">${floors}/${GOAL}</div><div class="hint">floors this week. Every finished task adds a floor.</div><div class="hint" style="margin-top:8px;font-weight:600;color:var(--ink)">${floors>=GOAL?"Topped out! Great week, team.":`${GOAL-floors} more to top out`}</div></div></div>`;
}
function renderTeam(){
  const m=me(),mine=S.tasks.filter(k=>k.to===m.id);
  const unseen=mine.filter(k=>!k.seenAt),active=mine.filter(k=>k.seenAt&&k.status!=="done").sort((a,b)=>(a.due||"9").localeCompare(b.due||"9"));
  const done=mine.filter(k=>k.status==="done").sort((a,b)=>b.doneAt-a.doneAt).slice(0,4);
  const myWeek=weekDone().filter(k=>k.to===m.id),onTime=myWeek.filter(onTimeK).length,kud=mine.reduce((n,k)=>n+k.kudos.length,0);
  const hr=new Date().getHours(),greet=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening",next=active[0];
  const updates=S.updates.slice().sort((a,b)=>b.at-a.at).slice(0,3);
  const badges=[];if(onTime>=3)badges.push(`${onTime} on time this week`);if(kud)badges.push(`${kud} kudos`);if(myWeek.length&&onTime===myWeek.length)badges.push("All on time");
  return `
  <h1>${greet}, ${esc(m.name)}.</h1>
  <p class="sub">${next?`Next up: <b>${esc(next.title)}</b> · ${dueK(next).t.toLowerCase()}.`:"Nothing open. Enjoy the calm."} ${unseen.length?`<b>${unseen.length} new</b> from your managers.`:""}</p>
  <div class="layout"><div class="stack">
    ${warnBox(myWarnings(m.id))}
    ${unseen.length?`<section class="inbox"><h2>New for you <span class="n">${unseen.length}</span></h2>
      ${unseen.map(k=>`<div class="nitem">${av(k.by)}<div class="tx"><b>${esc(k.title)}</b><span>${esc(nm(k.by))} · ${ago(k.at)} · ${esc(k.about||"Whole project")} · ${dueK(k).t}</span></div><button class="btn go" data-act="got" data-id="${k.id}">Got it</button></div>`).join("")}</section>`:""}
    <h2 style="margin-top:6px">My tasks <span class="n">${active.length}</span></h2>
    ${active.length?active.map(taskCard).join(""):`<div class="panel empty">All clear. New tasks from your managers show up here.</div>`}
    ${done.length?`<h2 style="margin-top:10px">Recently finished</h2>${done.map(taskCard).join("")}`:""}
  </div>
  <aside class="rail">
    <div class="panel"><h2>Next delivery</h2>${nextDelivery()}</div>
    <div class="panel"><h2>Your week</h2><div class="stats"><div><b>${myWeek.length}</b><span>done</span></div><div><b>${onTime}</b><span>on time</span></div><div><b>${kud}</b><span>kudos</span></div></div>
      ${badges.length?`<div class="badges">${badges.map(b=>`<span class="badge">★ ${b}</span>`).join("")}</div>`:""}</div>
    <div class="panel"><h2>Team tower</h2>${towerBox(weekDone().length)}</div>
    ${trophyShelf()}
    <div class="panel"><h2>Latest updates <button class="linkbtn" data-act="tab" data-t="updates" style="margin-left:auto">See all</button></h2>
      ${updates.map(u=>`<div class="upd">${av(u.by,1)}<div class="tx">${esc(u.text)}<div class="meta">${esc(nm(u.by))} · ${ago(u.at)}
        ${u.seenBy.includes(m.id)?`<span style="color:var(--teal);font-weight:600">✓ Seen</span>`:`<button class="btn sm go" data-act="seenupd" data-id="${u.id}">👍 Seen</button>`}</div></div></div>`).join("")||`<div class="hint">No updates yet.</div>`}</div>
  </aside></div>`;
}

/* ---------- manager view ---------- */
const newDraft=()=>({mode:"task",text:"",to:null,due:null,finH:null,time:"",about:"",ms:(upcoming()[0]||{}).id||"",man:{},lineTo:{}});
let draft=null;
const draftLines=()=>draft.text.split("\n").map(s=>s.trim()).filter(Boolean);
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const cleanTitle=(text,to)=>{const n=P(to)?.name;return (n?text.replace(new RegExp("^"+reEsc(n)+"\\s*[,:\\-–]?\\s*","i"),""):text).replace(/^./,c=>c.toUpperCase())};
function parseDraft(t){
  const r={};const first=assignees().find(p=>new RegExp("^\\s*"+reEsc(p.name.split(" ")[0])+"\\b","i").test(t))||assignees().find(p=>new RegExp("\\b"+reEsc(p.name.split(" ")[0])+"\\b","i").test(t));if(first)r.to=first.id;
  const base=new Date();let off=null;
  if(/\b(today|tonight|asap)\b/i.test(t))off=0;else if(/\btomorrow\b/i.test(t))off=1;else if(/\bnext week\b/i.test(t))off=7;
  else{const days=["sun","mon","tue","wed","thu","fri","sat"];const m=t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);if(m)off=(days.indexOf(m[1].toLowerCase())-base.getDay()+7)%7||7}
  if(off!==null)r.due=dstr(Date.now()+off*DAY);
  const known=allTags().find(tg=>t.toLowerCase().includes(tg.toLowerCase()));
  const tw=t.match(/\b(tower|block|building|villa)\s*[0-9a-z]\b|\b(podium|basement|lobby|facade|roof|parking|landscape|clubhouse)\b/i);
  if(known)r.about=known;else if(tw)r.about=tw[0].replace(/\b\w/g,c=>c.toUpperCase());
  return r;
}
const FINOPTS=[["2 hours",2],["4 hours",4],["1 day",24],["2 days",48]];
const finBy=()=>draft.finH?`Deadline: ${shortWhen(Date.now()+draft.finH*H)}`:draft.time&&draft.due?`Deadline: ${shortWhen(new Date(draft.due+"T"+draft.time).getTime())}`:"";
const DUEOPTS=()=>{const d=new Date(),fri=(5-d.getDay()+7)%7||7;return[["Today",0],["Tomorrow",1],["Friday",fri],["Next week",7]].map(([l,o])=>[l,dstr(Date.now()+o*DAY)])};
function msSelect(id){return `<select id="${id}" aria-label="Delivery"><option value="">No delivery</option>${upcoming().map(m=>`<option value="${m.id}" ${draft.ms===m.id?"selected":""}>${esc(m.name)} · ${dueInfo(m.date).t.replace("Due ","")}</option>`).join("")}</select>`}
const inviteLink=`<button class="chip" data-act="tab" data-t="people">+ Invite someone</button>`;
function bulkChips(){
  const ls=draftLines();
  return `<div class="bulkhead"><b>${ls.length} tasks</b> · one per line. Check who gets each one:</div>
   ${ls.map((l,i)=>{const r=parseDraft(l);const to=draft.lineTo[i]||r.to||"";const d=r.due?dueInfo(r.due).t:"Due in 3 days";
     return `<div class="brow">${to?av(to,1):`<span class="av sm" style="background:var(--line);color:var(--muted)">?</span>`}<span class="bt">${esc(to?cleanTitle(l,to):l)}</span>
       <select data-line="${i}" aria-label="Who gets line ${i+1}"><option value="">Pick person</option>${assignees().map(p=>`<option value="${p.id}" ${p.id===to?"selected":""}>${esc(p.name)}</option>`).join("")}</select>
       ${r.about?aboutTag(r.about):""}<span class="tag due">${d}</span></div>`}).join("")}
   <div class="crow"><span class="lbl">For</span>${msSelect("dms")}<span class="hint">All these tasks count toward this delivery.</span></div>`;
}
function composerChips(){
  const auto=f=>!draft.man[f]&&draft[f];
  if(draft.mode==="update")return "";
  if(draftLines().length>1)return bulkChips();
  return `
   <div class="crow"><span class="lbl">Who</span>${assignees().map(p=>`<button class="pick" data-act="dto" data-id="${p.id}" aria-pressed="${draft.to===p.id}" aria-label="Assign to ${esc(p.name)}" title="${esc(p.id===ME.id?"Me ("+p.name+")":p.name)}">${av(p.id)}</button>`).join("")||`<span class="hint">No team members yet.</span>`}
     ${inviteLink}${draft.to?`<span class="chip ${auto("to")?"auto":""}" style="cursor:default">For ${esc(draft.to===ME.id?"me":nm(draft.to))}${auto("to")?" · picked from text":""}</span>`:""}</div>
   <div class="crow"><span class="lbl">Due</span>${DUEOPTS().map(([l,v])=>`<button class="chip ${auto("due")&&draft.due===v?"auto":""}" data-act="ddue" data-v="${v}" aria-pressed="${draft.due===v&&!auto("due")}">${l}</button>`).join("")}<input type="date" id="dduedate" aria-label="Other date" value="${draft.due&&!DUEOPTS().some(o=>o[1]===draft.due)?draft.due:""}"><span class="hint">at</span><input type="time" id="dduetime" aria-label="Time (optional)" value="${draft.time||""}"></div>
   <div class="crow"><span class="lbl">Finish in</span>${FINOPTS.map(([l,h])=>`<button class="chip" data-act="dfin" data-h="${h}" aria-pressed="${draft.finH===h}">${l}</button>`).join("")}
     <input type="number" min="0" max="90" id="dfd" class="numin" placeholder="0" value="${draft.finH?Math.floor(draft.finH/24)||"":""}" aria-label="Days"><span class="hint">days</span>
     <input type="number" min="0" max="23" id="dfh" class="numin" placeholder="0" value="${draft.finH?draft.finH%24||"":""}" aria-label="Hours"><span class="hint">hours</span>
     <span class="hint" id="dfinby" style="color:var(--accent)">${finBy()}</span></div>
   <div class="crow"><span class="lbl">About</span><input type="text" class="aboutin" id="dabout" list="aboutlist" placeholder="Anything: Tower 4, lobby ceiling, client comments…" value="${esc(draft.about)}" aria-label="What it's about">${auto("about")?`<span class="hint" style="color:var(--accent)">picked from text</span>`:""}</div>
   <div class="crow"><span class="lbl">For</span>${msSelect("dms")}</div>`;
}
function renderMgr(){
  if(!draft)draft=newDraft();
  const m=me(),t=S.tasks,now=Date.now();
  const stuck=t.filter(k=>k.status==="stuck"),late=t.filter(isLate),unseen=t.filter(k=>!k.seenAt&&now-k.at>12*H),fin=t.filter(k=>k.status==="done"&&now-k.doneAt<2*DAY&&!k.kudos.includes(m.id));
  const match=k=>!S.filter||(S.filter==="stuck"&&k.status==="stuck")||(S.filter==="late"&&isLate(k))||(S.filter==="unseen"&&!k.seenAt&&now-k.at>12*H)||(S.filter==="fin"&&fin.includes(k));
  const col=(st,title)=>{const list=t.filter(k=>k.status===st&&(st!=="done"||now-k.doneAt<7*DAY)).sort((a,b)=>st==="done"?b.doneAt-a.doneAt:(a.due||"9").localeCompare(b.due||"9"));
    return `<div class="col"><h3>${title}<span class="hint">${list.length}</span></h3><div class="colbody">${list.map(k=>miniCard(k,match(k))).join("")||`<div class="hint" style="padding:8px">Nothing here</div>`}</div></div>`};
  const updates=S.updates.slice().sort((a,b)=>b.at-a.at).slice(0,3);
  return `
  <h1>Hi ${esc(m.name)}. ${stuck.length+late.length?`${stuck.length+late.length} things need you.`:"Team is moving."}</h1>
  <p class="sub">Give out tasks in the box below: write the task, tap the person, send. It lands on their screen right away.</p>
  <div class="layout"><div class="stack">
    ${warnBox(mgrWarnings())}
    <section class="composer">
      <div class="ctop"><span class="ctitle">${draft.mode==="task"?"Give out tasks":"Tell everyone"}</span><div class="seg"><button data-act="mode" data-v="task" aria-pressed="${draft.mode==="task"}">Task</button><button data-act="mode" data-v="update" aria-pressed="${draft.mode==="update"}">Update</button></div></div>
      <textarea id="ctext" rows="3" placeholder="${draft.mode==="task"?"Ahmed: revise the Tower 4 lobby ceiling by Friday\nSara: B2 parking markup tomorrow":"e.g. Client approved the new podium height"}" aria-label="Write it">${esc(draft.text)}</textarea>
      ${draft.mode==="update"?`<div class="crow"><span class="lbl">About</span><input type="text" class="aboutin" id="cuabout" list="aboutlist" placeholder="Whole project, or anything: Tower 4, parking…" value="${esc(draft.about)}" aria-label="What it's about"></div>`:""}
      <div id="cchips">${composerChips()}</div>
      <div class="cfoot"><span class="hint">${draft.mode==="task"?"One line = one task. Start the line with the name. Ctrl+Enter sends.":"The whole team sees it and taps “Seen”. Ctrl+Enter sends."}</span><button class="btn go" data-act="post" id="postbtn">${draft.mode==="task"?(draftLines().length>1?`Send ${draftLines().length} tasks`:"Send task"):"Post update"}</button></div>
    </section>
    <div class="alerts">
      <button class="alert red" data-act="filter" data-v="stuck" aria-pressed="${S.filter==="stuck"}"><b>${stuck.length}</b><span>Stuck, waiting on someone</span></button>
      <button class="alert sun" data-act="filter" data-v="late" aria-pressed="${S.filter==="late"}"><b>${late.length}</b><span>Past due date</span></button>
      <button class="alert blue" data-act="filter" data-v="unseen" aria-pressed="${S.filter==="unseen"}"><b>${unseen.length}</b><span>Not opened in 12h</span></button>
      <button class="alert teal" data-act="filter" data-v="fin" aria-pressed="${S.filter==="fin"}"><b>${fin.length}</b><span>Just finished, say thanks</span></button>
    </div>
    <div class="boardwrap"><div class="board">${col("new","Sent")}${col("doing","Doing")}${col("stuck","Stuck")}${col("done","Done this week")}</div></div>
  </div>
  <aside class="rail">
    <div class="panel"><h2>Next delivery</h2>${nextDelivery()}</div>
    ${trophyShelf()}
    <div class="panel"><h2>Team today</h2>
      ${team().map(p=>{const mine=t.filter(k=>k.to===p.id&&k.status!=="done");const cur=mine.find(k=>k.status==="stuck")||mine.find(isLate)||mine.find(k=>k.status==="doing");
        return `<div class="upd">${av(p.id)}<div class="tx"><b>${esc(p.name)}</b> <span class="hint">· ${mine.length} open</span><div class="meta">${cur?(cur.status==="stuck"?`<span class="note">Stuck: ${esc(cur.title)}</span>`:isLate(cur)?`<span class="note">Late: ${esc(cur.title)}</span>`:`Working on: ${esc(cur.title)}`):"Free for a new task"}</div></div></div>`}).join("")||`<div class="hint">No team members yet. ${inviteLink}</div>`}</div>
    <div class="panel"><h2>Latest updates <button class="linkbtn" data-act="tab" data-t="updates" style="margin-left:auto">See all</button></h2>
      ${updates.map(u=>{const o=u.seenBy.filter(id=>id!==u.by&&P(id));return `<div class="upd">${av(u.by,1)}<div class="tx">${esc(u.text)}<div class="meta">${esc(nm(u.by))} · ${ago(u.at)}<span class="seen">${o.map(id=>av(id,1)).join("")}</span><span>Seen by ${o.length} of ${Math.max(PEOPLE.length-1,0)}</span></div></div></div>`}).join("")||`<div class="hint">No updates yet.</div>`}</div>
  </aside></div>`;
}
/* ---------- editing ---------- */
const isEd=(kind,id,j)=>EDIT&&EDIT.kind===kind&&EDIT.id===id&&(j===undefined||EDIT.j===j);
const delBtn=(act,key,attrs,label)=>`<button class="btn sm danger" data-act="${act}" ${attrs}>${CONFIRM===key?"Yes, delete":(label||"Delete")}</button>`;
function taskEditor(k){
  const who=PEOPLE.filter(p=>!p.mgr||p.id===k.to||p.id===ME.id);
  return `<div class="editbox">
    <label>Task<input id="et-title" value="${esc(k.title)}"></label>
    <div class="erow"><label>Who<select id="et-to">${who.map(p=>`<option value="${p.id}" ${p.id===k.to?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label>Due<input type="date" id="et-due" value="${k.due||""}"></label>
      <label>Time <span style="font-weight:400">(optional)</span><input type="time" id="et-time" value="${k.dueAt?hm(k.dueAt):""}"></label></div>
    <div class="erow"><label>About<input id="et-about" list="aboutlist" value="${esc(k.about)}" placeholder="Whole project"></label>
      <label>Delivery<select id="et-ms"><option value="">No delivery</option>${S.ms.map(x=>`<option value="${x.id}" ${x.id===k.ms?"selected":""}>${esc(x.name)}</option>`).join("")}</select></label></div>
    <div class="acts"><button class="btn sm go" data-act="savetask" data-id="${k.id}">Save</button><button class="btn sm quiet" data-act="canceledit">Cancel</button><span class="spacer"></span>${delBtn("deltask","t"+k.id,`data-id="${k.id}"`)}</div></div>`;
}
const editLink=(kind,id,extra)=>`<button class="linkbtn edl" data-act="edit" data-kind="${kind}" data-id="${id}" ${extra||""} title="Edit">✎ Edit</button>`;
function miniCard(k,on){
  if(isEd("task",k.id))return `<div class="mini">${taskEditor(k)}</div>`;
  const m=me(),d=dueK(k);let a="";
  if(k.status==="stuck")a=`<button class="btn sm" data-act="nudge" data-id="${k.id}" data-to="${esc(k.stuckOn)}">Chase ${esc(k.stuckOn)}</button>`;
  if(k.status==="new"&&!k.seenAt&&k.to!==ME.id)a=`<button class="btn sm" data-act="nudge" data-id="${k.id}" data-to="${esc(nm(k.to))}">Nudge ${esc(nm(k.to))}</button>`;
  if(k.to===ME.id&&k.status==="new")a=`<button class="btn sm go" data-act="got" data-id="${k.id}">Got it</button>`;
  if(k.to===ME.id&&(k.status==="doing"||k.status==="stuck"))a=`<button class="btn sm teal" data-act="done" data-id="${k.id}" data-w="now">Mark done</button>`;
  if(k.status==="done"&&k.to!==ME.id)a=k.kudos.includes(m.id)?`<span class="kudo">👏 Sent</span>`:`<button class="btn sm go" data-act="kudos" data-id="${k.id}">👏 Kudos</button><button class="btn sm quiet" data-act="reopen" data-id="${k.id}">Reopen</button>`;
  return `<div class="mini ${on?"":"dim"}">
    <div class="row">${av(k.to,1)}<b style="color:var(--ink)">${esc(nm(k.to))}</b><span style="margin-left:auto">${aboutTag(k.about)}</span></div>
    <div class="t">${esc(k.title)}</div>
    <div class="row">${k.status==="done"?`<span class="donewhen">Done ${ago(k.doneAt)}</span>`:`<span class="tag due ${d.c}">${d.t}</span>`}
      ${k.status==="stuck"?`<span class="note">on ${esc(k.stuckOn)}</span>`:""}</div>
    ${tline(k)}
    <div class="acts">${a}<span class="spacer"></span>${editLink("task",k.id)}</div></div>`;
}

/* ---------- schedule ---------- */
let msForm={name:"",date:"",items:""};
function personSelect(id,optional){return `<select id="${id}" aria-label="Who does it"><option value="">${optional?"No one yet":"Pick person"}</option>${team().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`}

/* ---------- delivery checklist ---------- */
const PICK={};
const defDue=x=>dstr(Math.min(Date.now()+3*DAY,new Date(x.date+"T12:00").getTime()));
function parseItems(text,g0){let g=(g0||"").trim();const out=[];
  text.split("\n").map(s=>s.trim()).filter(Boolean).forEach(l=>{if(/:$/.test(l)){g=l.slice(0,-1).trim();return}const mm=l.match(/^[-•*]\s*(.*)$/);const t=(mm?mm[1]:l).trim();if(t)out.push({t:t.slice(0,200),ok:false,g:g.slice(0,60)})});return out}
function delivGroups(x,i){const ts=i.ts.filter(k=>k.deliv),order=[];const add=g=>{if(!order.includes(g))order.push(g)};
  x.items.forEach(it=>add(it.g||""));ts.forEach(k=>add(k.about||""));order.sort((a,b)=>a===""?-1:b===""?1:0);
  return order.map(g=>({g,ts:ts.filter(k=>(k.about||"")===g),items:x.items.map((it,j)=>({it,j})).filter(o=>(o.it.g||"")===g)}))}
function pickCount(msId){return Object.keys(PICK).filter(k=>k.startsWith(msId+"|")&&PICK[k]).length}
function delivBlock(x,i,m){
  const gs=delivGroups(x,i),ts=i.ts.filter(k=>k.deliv);
  const by={};ts.forEach(k=>{(by[k.to]=by[k.to]||{n:0,d:0}).n++;if(k.status==="done")by[k.to].d++});
  const who=Object.keys(by).length?`<div class="whohas"><span class="lbl">Who has what</span>${Object.entries(by).map(([id,v])=>`<span class="whochip">${av(id,1)}${esc(nm(id))} <b>${v.d}/${v.n}</b></span>`).join("")}</div>`:"";
  const taskRow=k=>isEd("task",k.id)?taskEditor(k):`<div class="ditem">${av(k.to,1)}<span class="x ${k.status==="done"?"dn":""}">${esc(k.title)}</span><span class="hint">${esc(nm(k.to))} · ${k.status==="done"?"done "+ago(k.doneAt):dueK(k).t.replace("Due ","")}</span>${isLate(k)?`<span class="tag due late">Late</span>`:`<span class="st ${k.status}">${{new:"New",doing:"Doing",stuck:"Stuck",done:"Done"}[k.status]}</span>`}${m.mgr?editLink("task",k.id):""}</div>`;
  const itemRow=({it,j})=>{
    if(isEd("item",x.id,j))return `<div class="crow assignrow"><input id="ei-text" value="${esc(it.t)}" aria-label="Item name"><button class="btn sm go" data-act="saveitem" data-ms="${x.id}" data-j="${j}">Save</button><button class="btn sm quiet" data-act="canceledit">Cancel</button>${delBtn("delitem","i"+x.id+j,`data-ms="${x.id}" data-j="${j}"`,"Remove")}</div>`;
    const key=x.id+"|"+j,pk=PICK[key]||"";
    return `<div class="ditem irow"><label class="${it.ok?"ok":""}" title="Tick when it's ready without giving it to anyone"><input type="checkbox" data-act="tick" data-ms="${x.id}" data-j="${j}" ${it.ok?"checked":""} ${m.mgr?"":"disabled"}><span>${esc(it.t)}</span></label>
      ${it.ok?"":m.mgr?`<select class="pickp" data-pick="${key}" aria-label="Who does ${esc(it.t)}"><option value="">No one yet</option>${assignees().map(p=>`<option value="${p.id}" ${p.id===pk?"selected":""}>${esc(p.id===ME.id?"Me":p.name)}</option>`).join("")}</select><input type="date" class="pickd" id="pd-${x.id}-${j}" aria-label="Due date" max="${x.date}" value="${defDue(x)}">`:`<span class="hint">No one yet</span>`}
      ${m.mgr?editLink("item",x.id,`data-j="${j}"`):""}</div>`};
  const body=gs.map(G=>{const tot=G.ts.length+G.items.length,dn=G.ts.filter(k=>k.status==="done").length+G.items.filter(o=>o.it.ok).length;
    return `${G.g?`<div class="dgroup">${esc(G.g)}<span class="hint">${dn}/${tot}</span></div>`:""}${G.ts.map(taskRow).join("")}${G.items.map(itemRow).join("")}`}).join("");
  const n=pickCount(x.id),groups=[...new Set(gs.map(G=>G.g).filter(Boolean))];
  return `<div><h4>What we deliver</h4>${who}<div class="dl">${body||`<span class="hint">Nothing listed yet.${m.mgr?" Add the drawings and documents below.":""}</span>`}</div>
    ${m.mgr&&x.items.some(it=>!it.ok)?`<div class="sendbar"><button class="btn go" id="sendpicks-${x.id}" data-act="sendpicks" data-ms="${x.id}" ${n?"":"disabled"}>${n?`Send ${n} task${n>1?"s":""}`:"Pick people, then send"}</button><span class="hint">Each person gets their items in their tasks, linked to ${esc(x.name)}.</span></div>`:""}
    ${m.mgr?`<div class="additem"><div class="crow"><input type="text" id="ng-${x.id}" list="grp-${x.id}" placeholder="Group (optional), e.g. Plans" aria-label="Group"><datalist id="grp-${x.id}">${groups.map(g=>`<option value="${esc(g)}">`).join("")}</datalist></div>
      <textarea id="ni-${x.id}" rows="3" placeholder="One item per line, e.g.&#10;Ground floor plan&#10;Typical floor plan&#10;Elevations:   ← a line ending with : starts a new group&#10;North elevation" aria-label="New items"></textarea>
      <div class="crow"><button class="btn sm go" data-act="additems" data-ms="${x.id}">Add to list</button><span class="hint">Then pick who does each one.</span></div></div>`:`<div class="hint" style="margin-top:4px">Everyone sees who has each item.</div>`}</div>`;
}
function renderSchedule(){
  const m=me(),list=S.ms.slice().sort((a,b)=>a.date.localeCompare(b.date));
  let track="";
  if(list.length){const t0=Math.min(new Date(list[0].date).getTime(),Date.now()-7*DAY),t1=Math.max(new Date(list[list.length-1].date).getTime(),Date.now()+7*DAY),pos=ms=>((ms-t0)/(t1-t0)*80+10).toFixed(1);
    track=`<div class="panel"><div class="trackwrap"><div class="track"><div class="line"></div><div class="done" style="width:${pos(Date.now())}%"></div>
      <div class="today" style="left:${pos(Date.now())}%"><span>Today</span></div>
      ${list.map(x=>{const i=msInfo(x);return `<div class="mk ${i.left<0||i.pct===100?"ok":i.risk==="red"?"risk":""}" style="left:${pos(new Date(x.date+"T12:00").getTime())}%"><i></i><b>${esc(x.name.split(" · ")[0])}</b><span>${new Date(x.date+"T12:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})} · ${i.pct}%</span></div>`}).join("")}
    </div></div></div>`}
  const card=x=>{const i=msInfo(x);
    const head=isEd("ms",x.id)?`<div class="editbox"><div class="erow"><label>Delivery name<input id="em-name" value="${esc(x.name)}"></label><label>Date<input type="date" id="em-date" value="${x.date}"></label></div>
        <div class="acts"><button class="btn sm go" data-act="savems" data-id="${x.id}">Save</button><button class="btn sm quiet" data-act="canceledit">Cancel</button><span class="spacer"></span>${delBtn("delms","m"+x.id,`data-id="${x.id}"`,"Delete delivery")}</div>
        <span class="hint">Deleting a delivery keeps its tasks; they just stop counting toward it.</span></div>`
      :`<div class="mtop"><div><div class="mname">${esc(x.name)} ${m.mgr?editLink("ms",x.id):""}</div><div class="hint">${longDate(x.date)}</div></div>${countdown(x,i)}</div>`;
    return `<article class="mcard ${i.left<0?"past":""}">
      ${head}
      ${bar(i)}
      <div class="tags"><b>${i.pct}% ready</b><span class="hint">· ${i.got} of ${i.total} items · ${i.total-i.got} left</span>${i.late?`<span class="tag due late">${i.late} late</span>`:""}${i.stuck?`<span class="tag due late">${i.stuck} stuck</span>`:""}</div>
      <div class="mgrid">
        ${delivBlock(x,i,m)}
        <div><h4>Other tasks for this delivery</h4><div class="tl">${i.ts.filter(k=>!k.deliv).map(k=>isEd("task",k.id)?taskEditor(k):`<div>${av(k.to,1)}<span class="x">${esc(k.title)}</span>${isLate(k)?`<span class="tag due late">Late</span>`:`<span class="st ${k.status}">${{new:"New",doing:"Doing",stuck:"Stuck",done:"Done"}[k.status]}</span>`}${m.mgr?editLink("task",k.id):""}</div>`).join("")||`<span class="hint">No tasks linked yet. Pick this delivery when you give out a task.</span>`}</div></div>
      </div></article>`};
  return `<h1>Schedule &amp; deliveries</h1>
  <p class="sub">Every delivery, its date, and how much is ready. Everyone sees the same bar, so the whole team knows how close we are.</p>
  <div class="layout"><div class="stack">${track}${[...list.filter(x=>daysTo(x.date)>=0),...list.filter(x=>daysTo(x.date)<0).reverse()].map(card).join("")||`<div class="panel empty">No deliveries yet.${m.mgr?" Add the first one on the right.":""}</div>`}</div>
  <aside class="rail">
    ${trophyShelf()}
    ${m.mgr?`<div class="panel"><h2>Add a delivery</h2><div class="form">
      <label>Name<input type="text" id="msname" placeholder="e.g. Tender package" value="${esc(msForm.name)}"></label>
      <label>Date<input type="date" id="msdate" value="${msForm.date}"></label>
      <label>What gets delivered (one per line; a line ending with : starts a group)<textarea id="msitems" rows="6" placeholder="Plans:&#10;Ground floor plan&#10;Typical floor plan&#10;Elevations:&#10;North + South&#10;Reports:&#10;Area statement">${esc(msForm.items)}</textarea></label>
      <button class="btn go" data-act="addms">Add delivery</button></div></div>`:""}
    <div class="panel"><h2>How the bar works</h2><div class="stack" style="gap:8px;font-size:14px">
      <div><b>Ready %</b> counts finished tasks for this delivery plus the items managers ticked as ready.</div>
      <div><b>Warnings</b> use today's date on your device. Late tasks before a close delivery show in red on that person's screen and the manager's.</div></div></div>
  </aside></div>`;
}

/* ---------- updates ---------- */
let uf={q:"",about:"all"},udraft={text:"",about:""};
function updCard(u){
  const m=me(),others=u.seenBy.filter(id=>id!==u.by&&P(id));
  if(isEd("upd",u.id))return `<article class="ucard"><div class="editbox"><label>Update<textarea id="eu-text" rows="3">${esc(u.text)}</textarea></label>
    <label>About<input id="eu-about" list="aboutlist" value="${esc(u.about)}" placeholder="Whole project"></label>
    <div class="acts"><button class="btn sm go" data-act="saveupd" data-id="${u.id}">Save</button><button class="btn sm quiet" data-act="canceledit">Cancel</button><span class="spacer"></span>${delBtn("delupd","u"+u.id,`data-id="${u.id}"`)}</div></div></article>`;
  return `<article class="ucard ${u.pinned?"pinned":""}">
    <div class="thead">${av(u.by,1)}<span><b style="color:var(--ink)">${esc(nm(u.by))}</b> · ${new Date(u.at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})} · ${ago(u.at)}</span>${u.pinned?`<span class="pin">Pinned</span>`:""}<span style="margin-left:auto">${aboutTag(u.about)}</span></div>
    <div class="utext">${esc(u.text)}</div>
    <div class="meta"><span class="seen">${others.map(id=>av(id,1)).join("")}</span><span class="hint">Seen by ${others.length} of ${Math.max(PEOPLE.length-1,0)}</span>
      <span style="margin-left:auto;display:flex;gap:6px">${u.seenBy.includes(m.id)?`<span style="color:var(--teal);font-weight:600;font-size:13px">✓ Seen</span>`:`<button class="btn sm go" data-act="seenupd" data-id="${u.id}">👍 Seen</button>`}
      ${m.mgr?`<button class="btn sm quiet" data-act="pin" data-id="${u.id}">${u.pinned?"Unpin":"Pin"}</button>${editLink("upd",u.id)}`:""}</span></div></article>`;
}
function updList(){
  const q=uf.q.toLowerCase().trim();
  const list=S.updates.filter(u=>(uf.about==="all"||(uf.about==="__project"?!u.about:(u.about||"").toLowerCase()===uf.about.toLowerCase()))&&(!q||u.text.toLowerCase().includes(q)||(u.about||"").toLowerCase().includes(q)||nm(u.by).toLowerCase().includes(q)));
  const pins=list.filter(u=>u.pinned).sort((a,b)=>b.at-a.at),rest=list.filter(u=>!u.pinned).sort((a,b)=>b.at-a.at);
  let html=pins.length?`<div class="day">Pinned · always on top</div>${pins.map(updCard).join("")}`:"",mon="";
  rest.forEach(u=>{const mo=new Date(u.at).toLocaleDateString("en-GB",{month:"long",year:"numeric"});if(mo!==mon){mon=mo;html+=`<div class="day">${mo}</div>`}html+=updCard(u)});
  return html||`<div class="panel empty">${S.updates.length?`No updates match${q?` “${esc(uf.q)}”`:""}. Try another word.`:"No updates yet."}</div>`;
}
function renderUpdates(){
  const m=me(),tags=[...new Set(S.updates.map(u=>u.about).filter(Boolean))].slice(0,10);
  return `<h1>Project updates</h1>
  <p class="sub">Every decision and piece of news for this project, old and new, in one place. Search it any time instead of digging through emails.</p>
  <div class="layout"><div class="stack">
    ${m.mgr?`<section class="composer"><div class="ctop"><span class="ctitle">Tell everyone</span></div>
      <textarea id="utext" rows="2" placeholder="e.g. Client approved the new podium height of 18.5 m" aria-label="Write an update">${esc(udraft.text)}</textarea>
      <div class="crow"><span class="lbl">About</span><input type="text" class="aboutin" id="uabout" list="aboutlist" placeholder="Leave empty for the whole project, or type anything" value="${esc(udraft.about)}" aria-label="What it's about"></div>
      <div class="suggest">${allTags().slice(0,8).map(x=>`<button data-act="sugg" data-target="uabout" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      <div class="cfoot"><span class="hint">Type any topic. Ones you used before are suggested.</span><button class="btn go" data-act="upost">Post update</button></div></section>`:""}
    <div class="ufilters">
      <input type="search" id="usearch" placeholder="Search updates, e.g. HV room, lifts, naming" value="${esc(uf.q)}" aria-label="Search updates">
      <div class="chips"><button class="chip" data-act="uf" data-v="all" aria-pressed="${uf.about==="all"}">All</button><button class="chip" data-act="uf" data-v="__project" aria-pressed="${uf.about==="__project"}">Whole project</button>${tags.map(x=>`<button class="chip" data-act="uf" data-v="${esc(x)}" aria-pressed="${uf.about===x}">${esc(x)}</button>`).join("")}</div>
    </div>
    <div id="ulist" class="stack">${updList()}</div>
  </div>
  <aside class="rail"><div class="panel"><h2>How updates work</h2><div class="stack" style="gap:8px;font-size:14px">
    <div><b>Managers</b> post news and decisions here and type what it's about, anything at all.</div>
    <div><b>Everyone</b> sees them and taps “Seen”, so managers know who read it.</div>
    <div><b>Pinned</b> rules stay on top. Nothing gets deleted, so you can always go back.</div></div></div></aside></div>`;
}

/* ---------- report ---------- */
const R={from:dstr(Date.now()-29*DAY),to:dstr(Date.now()),scope:"project",who:"all",data:null,key:"",loading:false};
const RANGES=()=>{const n=new Date(),y=n.getFullYear(),mo=n.getMonth(),f=d=>dstr(d.getTime());
  return [["Last 7 days",dstr(Date.now()-6*DAY),dstr(Date.now())],["Last 30 days",dstr(Date.now()-29*DAY),dstr(Date.now())],
    ["This month",f(new Date(y,mo,1)),dstr(Date.now())],["Last month",f(new Date(y,mo-1,1)),f(new Date(y,mo,0))],["This year",f(new Date(y,0,1)),dstr(Date.now())]]};
const repKey=()=>[TEAM.id,R.scope==="project"?S.cur:"all",R.from,R.to].join("|");
async function loadReport(){
  R.loading=true;render();
  try{const j=await api("report",{teamId:TEAM.id,projectId:R.scope==="project"?S.cur:"",from:new Date(R.from+"T00:00").getTime(),to:new Date(R.to+"T23:59:59").getTime()});R.data=j;R.key=repKey()}
  catch(e){toast(e.message)}
  R.loading=false;render();
}
function repModel(){
  const d=R.data,f=new Date(R.from+"T00:00").getTime(),t=new Date(R.to+"T23:59:59").getTime(),inR=x=>x&&x>=f&&x<=t,pn=id=>(d.projects.find(p=>p.id===id)||{}).name||"";
  const n=P(R.who)?.name,whoOk=e=>R.who==="all"||e.who===R.who||(n&&e.txt.includes(" "+n));
  const log=d.log.filter(whoOk).sort((a,b)=>a.at-b.at);
  const tasks=d.tasks.filter(k=>R.who==="all"||k.to===R.who);
  const given=tasks.filter(k=>inR(k.at)),fin=tasks.filter(k=>k.status==="done"&&inR(k.doneAt)),ontime=fin.filter(k=>!k.due||onTimeK(k));
  const lateNow=tasks.filter(isLate),stuckNow=tasks.filter(k=>k.status==="stuck");
  const ms=d.milestones.map(m=>{const ts=d.tasks.filter(k=>k.ms===m.id),done=ts.filter(k=>k.status==="done").length,ready=m.items.filter(i=>i.ok).length,total=ts.length+m.items.length,pct=total?Math.round((done+ready)/total*100):0,left=daysTo(m.date);
    return{name:m.name,project:pn(m.projectId),date:m.date,pct,state:pct===100&&total?"Delivered":left<0?"Overdue":(left<=7&&pct<70)?"At risk":"On track"}}).sort((a,b)=>a.date.localeCompare(b.date));
  const title=R.scope==="project"?(pn(S.cur)||(PROJECTS.find(p=>p.id===S.cur)||{}).name||"Project"):"All projects";
  return{title,range:`${longDate(R.from)} – ${longDate(R.to)}`,person:n||"",log,given,fin,ontime,lateNow,stuckNow,ms,updates:d.updates.length,pn,multi:R.scope!=="project",
    tasks:tasks.slice().sort((a,b)=>(a.due||"9").localeCompare(b.due||"9"))};
}
const stLabel=k=>isLate(k)?"Late":{new:"New",doing:"Doing",stuck:"Stuck",done:"Done"}[k.status];
function reportHTML(M){
  const pct=M.fin.length?Math.round(M.ontime.length/M.fin.length*100):0;
  const tile=(n,l,c)=>`<div class="rtile ${c||""}"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="report" id="report">
    <div class="rhead">${LOGO?`<img src="${LOGO}" alt="Company logo" class="rlogo">`:""}<div class="rtitle"><div class="rteam">${esc(TEAM.name)}</div><h2>${esc(M.title)} · Progress report</h2>
      <div class="rmeta">${M.range}${M.person?` · ${esc(M.person)}`:""} · Prepared by ${esc(ME.name)} on ${longDate(dstr(Date.now()))}</div></div></div>
    <div class="rtiles">${tile(M.given.length,"Tasks given")}${tile(M.fin.length,"Tasks finished","ok")}${tile(pct+"%","Finished on time")}${tile(M.lateNow.length,"Late now",M.lateNow.length?"bad":"")}${tile(M.stuckNow.length,"Stuck now",M.stuckNow.length?"bad":"")}${tile(M.updates,"Updates posted")}</div>
    ${M.ms.length?`<h3>Deliveries</h3><table class="rtable"><thead><tr><th>Delivery</th>${M.multi?"<th>Project</th>":""}<th>Date</th><th>Ready</th><th>Status</th></tr></thead><tbody>
      ${M.ms.map(x=>`<tr><td>${esc(x.name)}</td>${M.multi?`<td>${esc(x.project)}</td>`:""}<td>${longDate(x.date)}</td><td><span class="rbar"><i style="width:${x.pct}%"></i></span> ${x.pct}%</td><td><span class="rst ${x.state.replace(" ","").toLowerCase()}">${x.state}</span></td></tr>`).join("")}</tbody></table>`:""}
    <h3>List of changes <span class="rcount">${M.log.length}</span></h3>
    ${M.log.length?`<table class="rtable"><thead><tr><th style="width:92px">Date</th><th style="width:52px">Time</th>${M.multi?"<th>Project</th>":""}<th style="width:120px">Who</th><th>What changed</th></tr></thead><tbody>
      ${M.log.map(e=>`<tr><td>${dShort(e.at)}</td><td>${tShort(e.at)}</td>${M.multi?`<td>${esc(M.pn(e.projectId))}</td>`:""}<td>${esc(nm(e.who))}</td><td>${esc(e.txt)}</td></tr>`).join("")}</tbody></table>`:`<p class="hint">Nothing changed in these dates.</p>`}
    <h3>Task status today</h3>
    ${M.tasks.length?`<table class="rtable"><thead><tr><th>Task</th>${M.multi?"<th>Project</th>":""}<th>Who</th><th>Got it</th><th>Due</th><th>Status</th><th>Finished</th></tr></thead><tbody>
      ${M.tasks.map(k=>`<tr><td>${esc(k.title)}</td>${M.multi?`<td>${esc(M.pn(k.projectId))}</td>`:""}<td>${esc(nm(k.to))}</td><td>${k.seenAt?dShort(k.seenAt)+" "+tShort(k.seenAt):"Not yet"}</td><td>${dueCell(k)}</td><td><span class="rst ${stLabel(k).toLowerCase()}">${stLabel(k)}</span></td><td>${k.doneAt?new Date(k.doneAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})+(k.due?(onTimeK(k)?" · on time":" · late"):""):""}</td></tr>`).join("")}</tbody></table>`:`<p class="hint">No tasks yet.</p>`}
    <div class="rfoot">Generated with Project Pulse · ${new Date().toLocaleString("en-GB")}</div></div>`;
}
function renderHistory(){
  if(R.data&&R.key!==repKey())R.data=null;
  if(!R.data&&!R.loading)setTimeout(loadReport,0);
  const M=R.data?repModel():null;
  return `<h1>Reports</h1>
  <p class="sub">Every change is saved with its time. Pick the dates and download a report with your logo as PDF, Word or Excel.</p>
  <div class="panel rcontrols">
    <div class="chips">${RANGES().map(([l,a,b])=>`<button class="chip" data-act="rrange" data-a="${a}" data-b="${b}" aria-pressed="${R.from===a&&R.to===b}">${l}</button>`).join("")}</div>
    <div class="hfilters">
      <label>From<input type="date" id="rfrom" value="${R.from}" max="${R.to}"></label><label>To<input type="date" id="rto" value="${R.to}" min="${R.from}"></label>
      <label>Projects<select id="rscope"><option value="project" ${R.scope==="project"?"selected":""}>This project</option><option value="all" ${R.scope==="all"?"selected":""}>All projects</option></select></label>
      <label>Person<select id="rwho"><option value="all">Everyone</option>${PEOPLE.map(p=>`<option value="${p.id}" ${R.who===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
    </div>
    <div class="rbtns"><button class="btn go" data-act="export" data-f="pdf" ${M?"":"disabled"}>⬇ PDF</button><button class="btn" data-act="export" data-f="docx" ${M?"":"disabled"}>⬇ Word</button><button class="btn" data-act="export" data-f="xlsx" ${M?"":"disabled"}>⬇ Excel</button>
      ${!LOGO&&me().mgr?`<button class="linkbtn" data-act="tab" data-t="people">+ Add your company logo</button>`:""}</div>
  </div>
  <div class="rwrap">${R.loading||!M?`<div class="panel empty">Building the report…</div>`:reportHTML(M)}</div>`;
}
/* ---------- exports ---------- */
const LIBS={pdf:"https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js",xlsx:"https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",docx:"https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"};
const libP={};
function lib(f){return libP[f]||(libP[f]=new Promise((ok,no)=>{const sc=document.createElement("script");sc.src=LIBS[f];sc.onload=ok;sc.onerror=()=>{delete libP[f];no(new Error("Could not load the export tool. Check your internet."))};document.head.appendChild(sc)}))}
function saveBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
const fileBase=M=>("Project-Pulse_"+M.title+"_"+R.from+"_to_"+R.to).replace(/[^\w\-]+/g,"-").replace(/-+/g,"-");
function logoInfo(){return new Promise(ok=>{if(!LOGO)return ok(null);const im=new Image();im.onload=()=>ok({w:im.naturalWidth,h:im.naturalHeight,b64:LOGO.split(",")[1],ext:/jpeg/.test(LOGO)?"jpeg":"png"});im.onerror=()=>ok(null);im.src=LOGO})}
const fit=(l,maxW,maxH)=>{const r=Math.min(maxW/l.w,maxH/l.h,1);return{w:Math.round(l.w*r),h:Math.round(l.h*r)}};
function dShort(ms){return new Date(ms).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
function tShort(ms){return new Date(ms).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}
async function exportPDF(M){
  await lib("pdf");const el=document.getElementById("report"),sy=window.scrollY;window.scrollTo(0,0);el.classList.add("printing");
  try{await html2pdf().set({margin:[10,10,12,10],filename:fileBase(M)+".pdf",image:{type:"jpeg",quality:.96},html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff",scrollX:0,scrollY:0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"],avoid:["tr",".rtiles",".rhead","h3"]}}).from(el).save()}
  finally{el.classList.remove("printing");window.scrollTo(0,sy)}
}
async function exportXLSX(M){
  await lib("xlsx");const wb=new ExcelJS.Workbook();wb.creator="Project Pulse";const L=await logoInfo();
  const head={font:{bold:true,color:{argb:"FFFFFFFF"}},fill:{type:"pattern",pattern:"solid",fgColor:{argb:"FF141B2B"}},alignment:{vertical:"middle"}};
  const ws=wb.addWorksheet("Report",{views:[{showGridLines:false}]});
  const cols=M.multi?["Date","Time","Project","Who","What changed"]:["Date","Time","Who","What changed"];
  ws.columns=(M.multi?[14,8,22,20,80]:[14,8,20,90]).map(w=>({width:w}));
  let r=1;
  if(L){const id=wb.addImage({base64:L.b64,extension:L.ext});const s=fit(L,220,70);ws.addImage(id,{tl:{col:0,row:0},ext:{width:s.w,height:s.h}});r=5}
  ws.getCell(r,1).value=TEAM.name;ws.getCell(r,1).font={size:11,color:{argb:"FF6B7280"}};r++;
  ws.getCell(r,1).value=M.title+" · Progress report";ws.getCell(r,1).font={size:16,bold:true};r++;
  ws.getCell(r,1).value=M.range+(M.person?" · "+M.person:"")+" · Prepared by "+ME.name;ws.getCell(r,1).font={color:{argb:"FF6B7280"}};r+=2;
  const pct=M.fin.length?Math.round(M.ontime.length/M.fin.length*100):0;
  [["Tasks given",M.given.length],["Tasks finished",M.fin.length],["Finished on time",pct+"%"],["Late now",M.lateNow.length],["Stuck now",M.stuckNow.length],["Updates posted",M.updates]].forEach(([a,b])=>{ws.getCell(r,1).value=a;ws.getCell(r,2).value=b;ws.getCell(r,2).font={bold:true};ws.getCell(r,2).alignment={horizontal:"left"};r++});
  r++;ws.getCell(r,1).value="List of changes";ws.getCell(r,1).font={size:13,bold:true};r++;
  const hr=ws.getRow(r);cols.forEach((c,i)=>{const cell=hr.getCell(i+1);cell.value=c;cell.font=head.font;cell.fill=head.fill;cell.alignment=head.alignment});hr.height=20;const top=r;r++;
  M.log.forEach(e=>{const row=ws.getRow(r++);row.values=M.multi?[dShort(e.at),tShort(e.at),M.pn(e.projectId),nm(e.who),e.txt]:[dShort(e.at),tShort(e.at),nm(e.who),e.txt];row.getCell(cols.length).alignment={wrapText:true,vertical:"top"}});
  ws.autoFilter={from:{row:top,column:1},to:{row:Math.max(top,r-1),column:cols.length}};
  const styleHead=sh=>sh.getRow(1).eachCell(c=>{c.font=head.font;c.fill=head.fill;c.alignment=head.alignment});
  const t2=wb.addWorksheet("Tasks");const tc=["Task",...(M.multi?["Project"]:[]),"Who","About","Given","Got it","Started","Due","Status","Finished","On time"];
  t2.columns=tc.map(c=>({header:c,width:c==="Task"?50:c==="Project"?22:14}));styleHead(t2);
  M.tasks.forEach(k=>t2.addRow([k.title,...(M.multi?[M.pn(k.projectId)]:[]),nm(k.to),k.about||"Whole project",fullT(k.at),fullT(k.seenAt),fullT(k.startedAt),dueCell(k),stLabel(k),fullT(k.doneAt),k.doneAt&&k.due?(onTimeK(k)?"Yes":"No"):""]));
  t2.autoFilter={from:{row:1,column:1},to:{row:1,column:tc.length}};
  if(M.ms.length){const t3=wb.addWorksheet("Deliveries");t3.columns=[{header:"Delivery",width:30},...(M.multi?[{header:"Project",width:22}]:[]),{header:"Date",width:14},{header:"Ready %",width:10},{header:"Status",width:12}];styleHead(t3);
    M.ms.forEach(x=>t3.addRow([x.name,...(M.multi?[x.project]:[]),x.date,x.pct,x.state]))}
  saveBlob(new Blob([await wb.xlsx.writeBuffer()],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),fileBase(M)+".xlsx");
}
async function exportDOCX(M){
  await lib("docx");const D=window.docx,L=await logoInfo();
  const txt=(t,o)=>new D.TextRun(Object.assign({text:String(t??""),font:"Calibri",size:20},o||{}));
  const para=(t,o,po)=>new D.Paragraph(Object.assign({children:[txt(t,o)]},po||{}));
  const bdr={style:D.BorderStyle.SINGLE,size:4,color:"DDDDDD"},borders={top:bdr,bottom:bdr,left:bdr,right:bdr,insideHorizontal:bdr,insideVertical:bdr};
  const table=(cols,rows,widths)=>new D.Table({width:{size:100,type:D.WidthType.PERCENTAGE},borders,rows:[
    new D.TableRow({tableHeader:true,children:cols.map((c,i)=>new D.TableCell({width:{size:widths[i],type:D.WidthType.PERCENTAGE},shading:{fill:"141B2B",type:D.ShadingType.CLEAR,color:"auto"},children:[para(c,{bold:true,color:"FFFFFF",size:18})]}))}),
    ...rows.map(r=>new D.TableRow({cantSplit:true,children:r.map((c,i)=>new D.TableCell({width:{size:widths[i],type:D.WidthType.PERCENTAGE},children:[para(c,{size:18})]}))}))]});
  const kids=[];
  if(L){const s=fit(L,200,64);const bin=Uint8Array.from(atob(L.b64),c=>c.charCodeAt(0));kids.push(new D.Paragraph({children:[new D.ImageRun({data:bin,transformation:{width:s.w,height:s.h}})]}))}
  kids.push(para(TEAM.name,{color:"6B7280"}),para(M.title+" · Progress report",{bold:true,size:36},{spacing:{after:80}}),para(M.range+(M.person?" · "+M.person:"")+" · Prepared by "+ME.name+" on "+longDate(dstr(Date.now())),{color:"6B7280"},{spacing:{after:240}}));
  const pct=M.fin.length?Math.round(M.ontime.length/M.fin.length*100):0;
  kids.push(table(["Tasks given","Tasks finished","On time","Late now","Stuck now","Updates"],[[M.given.length,M.fin.length,pct+"%",M.lateNow.length,M.stuckNow.length,M.updates].map(String)],[17,17,16,16,17,17]));
  const h=t=>para(t,{bold:true,size:26},{spacing:{before:300,after:120}});
  if(M.ms.length){kids.push(h("Deliveries"),table(["Delivery",...(M.multi?["Project"]:[]),"Date","Ready","Status"],M.ms.map(x=>[x.name,...(M.multi?[x.project]:[]),longDate(x.date),x.pct+"%",x.state]),M.multi?[30,22,22,10,16]:[40,28,12,20]))}
  kids.push(h("List of changes ("+M.log.length+")"));
  if(M.log.length)kids.push(table(["Date","Time",...(M.multi?["Project"]:[]),"Who","What changed"],M.log.map(e=>[dShort(e.at),tShort(e.at),...(M.multi?[M.pn(e.projectId)]:[]),nm(e.who),e.txt]),M.multi?[13,8,16,15,48]:[14,9,17,60]));
  else kids.push(para("Nothing changed in these dates.",{color:"6B7280"}));
  kids.push(h("Task status today"));
  if(M.tasks.length)kids.push(table(["Task",...(M.multi?["Project"]:[]),"Who","Got it","Due","Status","Finished"],M.tasks.map(k=>[k.title,...(M.multi?[M.pn(k.projectId)]:[]),nm(k.to),fullT(k.seenAt)||"Not yet",dueCell(k),stLabel(k),k.doneAt?dShort(k.doneAt):""]),M.multi?[26,14,13,13,12,9,13]:[32,15,15,14,10,14]));
  const doc=new D.Document({creator:"Project Pulse",title:M.title+" report",sections:[{properties:{page:{margin:{top:900,bottom:900,left:900,right:900}}},
    footers:{default:new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.CENTER,children:[txt("Project Pulse · page ",{size:16,color:"9CA3AF"}),new D.TextRun({children:[D.PageNumber.CURRENT],size:16,color:"9CA3AF"})]})]})},children:kids}]});
  saveBlob(await D.Packer.toBlob(doc),fileBase(M)+".docx");
}

/* ---------- team & settings ---------- */
let newRole="team";
function shrinkLogo(file){return new Promise((ok,no)=>{
  if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type))return no(new Error("Pick a PNG or JPG image"));
  const fr=new FileReader();fr.onerror=()=>no(new Error("Could not read the image"));
  fr.onload=()=>{const im=new Image();im.onerror=()=>no(new Error("Could not read the image"));im.onload=()=>{
    for(const max of [420,340,260,200,150]){const r=Math.min(max/im.width,(max*.45)/im.height,1),c=document.createElement("canvas");c.width=Math.max(1,Math.round(im.width*r));c.height=Math.max(1,Math.round(im.height*r));
      c.getContext("2d").drawImage(im,0,0,c.width,c.height);let u=c.toDataURL("image/png");if(u.length<=46000)return ok(u);
      const c2=document.createElement("canvas");c2.width=c.width;c2.height=c.height;const x=c2.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c2.width,c2.height);x.drawImage(c,0,0);u=c2.toDataURL("image/jpeg",.85);if(u.length<=46000)return ok(u)}
    no(new Error("That image is too detailed. Try a simpler logo"))};im.src=fr.result};fr.readAsDataURL(file)})}
function renderPeople(){
  const m=me(),mgrs=PEOPLE.filter(p=>p.mgr).length,link=lastInvite?`${location.origin}${location.pathname}?invite=${lastInvite.code}`:"";
  const proj=PROJECTS.find(p=>p.id===S.cur);
  const row=p=>`<div class="prow">${av(p.id)}<div class="pinfo"><b>${esc(p.name)}${p.id===ME.id?' <span class="hint">(you)</span>':""}</b><span class="hint">${p.mgr?"Gives out tasks, posts updates, plans deliveries":"Gets tasks, marks them done"}</span></div>
      ${m.mgr?`<div class="seg"><button data-act="setrole" data-id="${p.id}" data-v="mgr" aria-pressed="${!!p.mgr}">Manager</button><button data-act="setrole" data-id="${p.id}" data-v="team" aria-pressed="${!p.mgr}">Team</button></div>`:`<span class="tag due">${p.mgr?"Manager":"Team"}</span>`}</div>`;
  return `<h1>${m.mgr?"Team &amp; settings":"Settings"}</h1>
  <p class="sub">${m.mgr?"Rename things, add your company logo for reports, and choose who is a manager.":"Change how your name shows to the team."}</p>
  <div class="layout"><div class="stack">
    <div class="panel"><h2>Names</h2><div class="form">
      <label>Your name<span class="inl"><input id="set-me" value="${esc(ME.name)}"><button class="btn sm go" data-act="saveme">Save</button></span></label>
      ${m.mgr?`<label>Company / team name<span class="inl"><input id="set-team" value="${esc(TEAM.name)}"><button class="btn sm go" data-act="saveteam">Save</button></span></label>
      ${proj?`<label>This project's name<span class="inl"><input id="set-proj" value="${esc(proj.name)}"><button class="btn sm go" data-act="saveproj">Save</button></span></label>`:""}`:""}
    </div></div>
    ${m.mgr?`<div class="panel"><h2>Company logo</h2><div class="logobox">${LOGO?`<img src="${LOGO}" alt="Company logo">`:`<span class="hint">No logo yet</span>`}</div>
      <div class="crow"><label class="btn go" style="cursor:pointer">${LOGO?"Change logo":"Upload logo"}<input type="file" id="set-logo" accept="image/png,image/jpeg,image/webp" hidden></label>${LOGO?`<button class="btn quiet" data-act="dellogo">Remove</button>`:""}</div>
      <span class="hint">It shows at the top of every PDF, Word and Excel report.</span></div>`:""}
    <div class="panel"><h2>Managers <span class="n">${mgrs}</span></h2>${PEOPLE.filter(p=>p.mgr).map(row).join("")}</div>
    <div class="panel"><h2>Team <span class="n">${PEOPLE.length-mgrs}</span></h2>${team().map(row).join("")||`<div class="empty">No team members yet.${m.mgr?" Invite someone on the right.":""}</div>`}</div>
  </div>
  <aside class="rail">${m.mgr?`<div class="panel"><h2>Invite someone</h2><div class="stack" style="gap:10px">
      <div class="seg"><button data-act="newrole" data-v="team" aria-pressed="${newRole==="team"}">As team</button><button data-act="newrole" data-v="mgr" aria-pressed="${newRole==="mgr"}">As manager</button></div>
      <button class="btn go" data-act="invite">Make an invite code</button>
      ${lastInvite?`<div class="invite"><code>${lastInvite.code}</code><button class="btn sm" data-act="copylink" data-v="${esc(link)}">Copy link</button></div><span class="hint">Send the link on WhatsApp or email. It works once, for one person, as ${lastInvite.role==="mgr"?"a manager":"a team member"}.</span>`:`<span class="hint">Each code works once. The person opens the link, creates an account and lands in this team.</span>`}
      ${INVITES.length?`<div class="hint">Unused codes: ${INVITES.map(i=>`<code>${esc(i.code)}</code> (${i.role==="mgr"?"manager":"team"})`).join(", ")}</div>`:""}
    </div></div>`:""}
    <div class="panel"><h2>Your account</h2><div class="hint">${esc(ME.email)}</div><button class="btn quiet" data-act="signout" style="margin-top:8px">Sign out</button></div></aside></div>`;
}
function renderNewProject(){
  return `<h1>${PROJECTS.length?"New project":"Create your first project"}</h1><p class="sub">The same team can run as many projects as you like. Switch between them from the menu at the top.</p>
  <div class="panel" style="max-width:520px"><div class="form">
    <label>Project name<input type="text" id="npname" placeholder="e.g. Downtown Offices · Concept"></label>
    <label>First delivery (optional)<input type="text" id="npms" placeholder="e.g. Concept presentation"></label>
    <label>Delivery date<input type="date" id="npdate"></label>
    <div class="crow"><button class="btn go" data-act="npcreate">Create project</button>${PROJECTS.length?`<button class="btn quiet" data-act="tab" data-t="main">Cancel</button>`:""}</div>
  </div></div>`;
}

/* ---------- render ---------- */
function render(){
  if(!ME)return;
  const m=me();
  if(S.tab==="newproj"&&!m.mgr)S.tab="main";
  renderTop();
  let html;
  if(S.tab==="people")html=renderPeople();
  else if(S.tab==="newproj"||(!S.cur&&m.mgr))html=renderNewProject();
  else if(!S.cur)html=`<div class="panel empty" style="margin-top:20px">No projects yet. Your manager will add one soon.</div>`;
  else html=({history:renderHistory,updates:renderUpdates,schedule:renderSchedule}[S.tab]||(m.mgr?renderMgr:renderTeam))();
  document.getElementById("view").innerHTML=html;
}

/* ---------- actions ---------- */
const T=id=>S.tasks.find(k=>k.id===id);
const reChips=()=>{document.getElementById("cchips").innerHTML=composerChips()};
function saveMs(x,logTxt){return send("saveMilestone",{projectId:S.cur,id:x.id,items:x.items,logTxt})}
async function giveTasks(list){
  const j=await send("createTasks",{projectId:S.cur,tasks:list});
  S.tasks.push(...j.tasks);render();return j;
}
document.addEventListener("submit",e=>{if(e.target.id==="authform"){e.preventDefault();doAuth()}});
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-act]");if(!b)return;const a=b.dataset.act,k=b.dataset.id?T(b.dataset.id):null,m=ME?me():null;
  const taskDo=(t,doWhat,extra,logTxt,msg)=>send("taskAction",Object.assign({id:t.id,do:doWhat,logTxt},extra||{}),msg).then(j=>{Object.assign(t,j.task);render()}).catch(()=>{});
  if(!/^(del|edit$)/.test(a))CONFIRM=null;
  const fmtD=v=>v?new Date(v+"T12:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"no date";
  const confirmOr=key=>{if(CONFIRM!==key){CONFIRM=key;render();return false}CONFIRM=null;return true};
  switch(a){
    case"edit":EDIT={kind:b.dataset.kind,id:b.dataset.id,j:b.dataset.j!==undefined?+b.dataset.j:undefined};CONFIRM=null;S.open=null;break;
    case"canceledit":EDIT=null;CONFIRM=null;break;
    case"savetask":{const v=id=>document.getElementById(id).value.trim();const nt={title:v("et-title"),to:v("et-to"),due:v("et-due"),about:v("et-about"),ms:v("et-ms")};const tm=v("et-time");nt.dueAt=tm&&nt.due?new Date(nt.due+"T"+tm).getTime():"";
      if(!nt.title){toast("The task needs a title");return}
      const ch=[];if(nt.title!==k.title)ch.push(`renamed it to “${nt.title}”`);if(nt.to!==k.to)ch.push(`moved it from ${nm(k.to)} to ${nm(nt.to)}`);
      if(nt.due!==(k.due||"")||String(nt.dueAt||"")!==String(k.dueAt||""))ch.push(`due ${fmtDue(k.due,k.dueAt)} → ${fmtDue(nt.due,nt.dueAt)}`);if(nt.about!==(k.about||""))ch.push(`about “${nt.about||"Whole project"}”`);
      if(nt.ms!==(k.ms||""))ch.push(nt.ms?`linked to ${MS(nt.ms).name}`:"removed from its delivery");
      if(!ch.length){EDIT=null;break}
      try{const j=await send("editTask",Object.assign({id:k.id,logTxt:`edited “${k.title}”: ${ch.join(", ")}`},nt),"Task updated");Object.assign(k,j.task);EDIT=null}catch(err){return}break}
    case"deltask":{if(!confirmOr("t"+k.id))return;try{await send("deleteTask",{id:k.id},"Task deleted");S.tasks=S.tasks.filter(x=>x.id!==k.id);EDIT=null}catch(err){return}break}
    case"saveupd":{const u=S.updates.find(x=>x.id===b.dataset.id),text=document.getElementById("eu-text").value.trim(),about=document.getElementById("eu-about").value.trim();
      if(!text){toast("The update cannot be empty");return}
      try{const j=await send("editUpdate",{id:u.id,text,about},"Update saved");Object.assign(u,j.update);EDIT=null}catch(err){return}break}
    case"delupd":{if(!confirmOr("u"+b.dataset.id))return;try{await send("deleteUpdate",{id:b.dataset.id},"Update deleted");S.updates=S.updates.filter(x=>x.id!==b.dataset.id);EDIT=null}catch(err){return}break}
    case"savems":{const x=MS(b.dataset.id),name=document.getElementById("em-name").value.trim(),date=document.getElementById("em-date").value;
      if(!name||!date){toast("Add a name and a date");return}
      const ch=[];if(name!==x.name)ch.push(`renamed ${x.name} to ${name}`);if(date!==x.date)ch.push(`moved ${name} from ${longDate(x.date)} to ${longDate(date)}`);
      if(!ch.length){EDIT=null;break}
      try{const j=await send("saveMilestone",{projectId:S.cur,id:x.id,name,date,items:x.items,logTxt:ch.join("; ")},"Delivery updated");Object.assign(x,j.milestone);EDIT=null}catch(err){return}break}
    case"delms":{const x=MS(b.dataset.id);if(!confirmOr("m"+x.id))return;
      try{await send("deleteMilestone",{id:x.id},`${x.name} removed`);S.ms=S.ms.filter(m=>m.id!==x.id);S.tasks.forEach(t=>{if(t.ms===x.id)t.ms=""});EDIT=null}catch(err){return}break}
    case"saveitem":{const x=MS(b.dataset.ms),j=+b.dataset.j,v=document.getElementById("ei-text").value.trim();if(!v){toast("Type the item");return}
      const old=x.items[j].t;if(v!==old){x.items[j].t=v;try{await saveMs(x,`renamed “${old}” to “${v}” in ${x.name}`)}catch(err){return}}EDIT=null;break}
    case"delitem":{const x=MS(b.dataset.ms),j=+b.dataset.j;if(!confirmOr("i"+x.id+j))return;const it=x.items.splice(j,1)[0];EDIT=null;
      try{await saveMs(x,`removed “${it.t}” from ${x.name}`);toast("Item removed")}catch(err){return}break}
    case"saveme":{const v=document.getElementById("set-me").value.trim();if(!v){toast("Type your name");return}
      try{await send("editMe",{name:v},"Name saved");ME.name=v;const p=P(ME.id);if(p)p.name=v}catch(err){return}break}
    case"saveteam":{const v=document.getElementById("set-team").value.trim();if(!v){toast("Type the team name");return}
      try{await send("editTeam",{teamId:TEAM.id,name:v},"Team name saved");TEAM.name=v;const t=TEAMS.find(x=>x.id===TEAM.id);if(t)t.name=v}catch(err){return}break}
    case"saveproj":{const v=document.getElementById("set-proj").value.trim(),pr=PROJECTS.find(x=>x.id===S.cur);if(!v){toast("Give the project a name");return}
      if(v===pr.name)return;try{await send("renameProject",{projectId:S.cur,name:v},"Project renamed");pr.name=v;R.data=null}catch(err){return}break}
    case"dellogo":{try{await send("editTeam",{teamId:TEAM.id,logo:""},"Logo removed");LOGO=""}catch(err){return}break}
    case"rrange":R.from=b.dataset.a;R.to=b.dataset.b;break;
    case"export":{const M=R.data&&repModel();if(!M)return;const f=b.dataset.f,label=b.textContent;b.disabled=true;b.textContent="Preparing…";
      try{await ({pdf:exportPDF,docx:exportDOCX,xlsx:exportXLSX}[f])(M);toast("Report downloaded")}catch(err){console.error(err);toast(err.message||"Could not make the file")}
      b.disabled=false;b.textContent=label;return}
    case"authmode":authMode=b.dataset.v;authErr="";renderAuth();return;
    case"signout":signOut();return;
    case"retry":document.getElementById("view").innerHTML=`<div class="loading">Loading…</div>`;boot();return;
    case"refresh":await reload();toast("Up to date");return;
    case"jointeam":{try{await api("joinTeam",{invite:document.getElementById("j-code").value});await boot()}catch(err){toast(err.message)}return}
    case"tab":S.tab=b.dataset.t;window.scrollTo(0,0);break;
    case"got":k.seenAt=Date.now();if(k.status==="new"){k.status="doing";if(!k.startedAt)k.startedAt=k.seenAt}logLocal(`got “${k.title}” and started`);taskDo(k,"got",null,`got “${k.title}” and started`,k.by===ME.id?"On it. It's in Doing now":`${nm(k.by)} can see you've started`);break;
    case"start":k.status="doing";if(!k.seenAt)k.seenAt=Date.now();if(!k.startedAt)k.startedAt=Date.now();taskDo(k,"start",null,`started “${k.title}”`,"Started. Good luck!");break;
    case"open":S.open=S.open&&S.open.id===k.id&&S.open.kind===b.dataset.kind?null:{id:k.id,kind:b.dataset.kind};break;
    case"done":{let at=Date.now();const w=b.dataset.w;
      if(w==="morning"){const d=new Date();d.setHours(10,0,0,0);at=Math.min(d.getTime(),Date.now())}
      if(w==="yesterday"){const d=new Date(Date.now()-DAY);d.setHours(16,0,0,0);at=d.getTime()}
      if(w==="pick"){const v=document.getElementById("dd-"+k.id).value;if(!v){toast("Pick a date first");return}at=Math.min(new Date(v+"T15:00").getTime(),Date.now())}
      k.status="done";k.doneAt=at;S.open=null;const ms=MS(k.ms),pi=ms?msInfo(ms):null;
      taskDo(k,"done",{doneAt:at},`finished “${k.title}” (${fmtWhen(at)})`);
      if(pi&&pi.pct===100&&pi.total>0)teamWin(ms);
      else celebrate({title:`Well done, ${me().name.split(" ")[0]}!`,sub:`“${k.title}” is finished.${ms?` ${ms.name} is now ${pi.pct}% ready.`:""} ${weekDone().length>=GOAL?"The team tower is topped out!":"Your floor is on the team tower."}`});
      break}
    case"stuckon":{const note=((document.getElementById("sn-"+k.id)||{}).value||"").trim();k.status="stuck";k.stuckOn=b.dataset.b;k.stuckNote=note;S.open=null;
      taskDo(k,"stuck",{stuckOn:k.stuckOn,stuckNote:note},`is stuck on “${k.title}”, waiting on ${k.stuckOn}${note?": "+note:""}`,`${nm(k.by)} knows you're waiting on ${k.stuckOn}`);break}
    case"unstuck":k.status="doing";taskDo(k,"unstuck",null,`is unblocked on “${k.title}”`,"Back on track");break;
    case"kudos":k.kudos.push(m.id);confetti();taskDo(k,"kudos",null,`sent kudos to ${nm(k.to)} for “${k.title}”`,`${nm(k.to)} will see your 👏`);break;
    case"reopen":k.status="doing";k.doneAt=null;taskDo(k,"reopen",null,`reopened “${k.title}”`,`Sent back to ${nm(k.to)}`);break;
    case"nudge":send("taskAction",{id:k.id,do:"nudge",logTxt:`nudged ${b.dataset.to} about “${k.title}”`},`Nudge saved. ${b.dataset.to} will see it in History`).catch(()=>{});return;
    case"seenupd":{const u=S.updates.find(x=>x.id===b.dataset.id);if(!u.seenBy.includes(m.id))u.seenBy.push(m.id);send("updateAction",{id:u.id,do:"seen"}).catch(()=>{});break}
    case"pin":{const u=S.updates.find(x=>x.id===b.dataset.id);u.pinned=!u.pinned;send("updateAction",{id:u.id,do:"pin"},u.pinned?"Pinned to the top":"Unpinned").catch(()=>{});break}
    case"filter":S.filter=S.filter===b.dataset.v?null:b.dataset.v;break;
    case"mode":draft.mode=b.dataset.v;draft.about="";break;
    case"dto":draft.to=b.dataset.id;draft.man.to=true;reChips();return;
    case"ddue":draft.due=b.dataset.v;draft.man.due=true;draft.finH=null;reChips();return;
    case"dfin":{const h=+b.dataset.h;draft.finH=draft.finH===h?null:h;draft.time="";if(draft.finH){draft.due=dstr(Date.now()+draft.finH*H);draft.man.due=true}reChips();return}
    case"sugg":{const el=document.getElementById(b.dataset.target);el.value=b.dataset.v;el.dispatchEvent(new Event("input",{bubbles:true}));return}
    case"post":{const text=draft.text.trim();if(!text){toast("Write something first");document.getElementById("ctext").focus();return}
      b.disabled=true;
      try{
        if(draft.mode==="update"){const j=await send("postUpdate",{projectId:S.cur,text,about:draft.about.trim()},"Posted. Everyone on the team can see it");S.updates.push(j.update)}
        else{const ls=draftLines();
          const items=ls.length>1?ls.map((l,i)=>{const r=parseDraft(l);return{line:l,to:draft.lineTo[i]||r.to,due:r.due,about:r.about||""}}):[{line:text,to:draft.to,due:draft.due,about:draft.about.trim(),dueAt:draft.finH?Date.now()+draft.finH*H:draft.time&&draft.due?new Date(draft.due+"T"+draft.time).getTime():""}];
          const miss=items.findIndex(x=>!x.to);if(miss>=0){toast(ls.length>1?`Pick a person for line ${miss+1}`:"Tap who it's for");b.disabled=false;return}
          const list=items.map(x=>{const title=cleanTitle(x.line,x.to);const due=x.dueAt?dstr(x.dueAt):x.due||dstr(Date.now()+3*DAY);return{title,to:x.to,due,dueAt:x.dueAt||"",about:x.about,ms:draft.ms,logTxt:`assigned “${title}” to ${nm(x.to)}${x.dueAt?", deadline "+shortWhen(x.dueAt):""}`}});
          await giveTasks(list);const names=[...new Set(list.map(x=>nm(x.to)))];toast(list.length>1?`${list.length} tasks sent to ${names.join(", ")}`:`Sent to ${names[0]}`)}
        const keep=draft.mode;draft=newDraft();draft.mode=keep;
      }catch(err){b.disabled=false;return}
      break}
    case"setrole":{const p=P(b.dataset.id),toMgr=b.dataset.v==="mgr";if(!!p.mgr===toMgr)return;
      if(!toMgr&&PEOPLE.filter(x=>x.mgr).length===1){toast("The team needs at least one manager");return}
      p.mgr=toMgr;send("setRole",{teamId:TEAM.id,userId:p.id,role:toMgr?"mgr":"team"},`${p.name} is now ${toMgr?"a manager":"on the team"}`).then(()=>{if(p.id===ME.id){ROLE=toMgr?"mgr":"team";render()}}).catch(()=>{});break}
    case"newrole":newRole=b.dataset.v;break;
    case"invite":{try{const j=await send("createInvite",{teamId:TEAM.id,role:newRole});lastInvite={code:j.code,role:newRole};INVITES.push({code:j.code,role:newRole})}catch(err){return}break}
    case"copylink":navigator.clipboard.writeText(b.dataset.v).then(()=>toast("Link copied. Send it to them"),()=>toast("Copy the code instead: "+lastInvite.code));return;
    case"uf":uf.about=b.dataset.v;break;
    case"upost":{const text=udraft.text.trim();if(!text){toast("Write the update first");return}
      try{const j=await send("postUpdate",{projectId:S.cur,text,about:udraft.about.trim()},"Posted. Everyone on the team can see it");S.updates.push(j.update);udraft={text:"",about:""};uf={q:"",about:"all"}}catch(err){return}break}
    case"tick":{const x=MS(b.dataset.ms),it=x.items[+b.dataset.j];if(!m.mgr)return;it.ok=b.checked;const i=msInfo(x);
      if(it.ok&&i.pct===100)teamWin(x);saveMs(x,`marked “${it.t}” ${it.ok?"ready":"not ready"} for ${x.name}`).catch(()=>{});if(it.ok)toast(`${x.name}: ${i.pct}% ready`);break}
    case"additem":{const x=MS(b.dataset.ms),v=(document.getElementById("ni-"+x.id).value||"").trim();if(!v){toast("Type the item");return}
      const to=document.getElementById("np-"+x.id).value,due=document.getElementById("nd-"+x.id).value||dstr(Math.min(Date.now()+3*DAY,new Date(x.date+"T12:00").getTime()));
      if(to){try{await giveTasks([{title:v,to,due,about:"",ms:x.id,deliv:true,logTxt:`gave “${v}” (${x.name}) to ${nm(to)}, due ${longDate(due)}`}]);toast(`${v} sent to ${nm(to)} as a task`)}catch(err){}return}
      x.items.push({t:v,ok:false});saveMs(x,`added “${v}” to ${x.name}`).catch(()=>{});break}
    case"additems":{const x=MS(b.dataset.ms),its=parseItems(document.getElementById("ni-"+x.id).value,document.getElementById("ng-"+x.id).value);if(!its.length){toast("Type at least one item");return}
      x.items.push(...its);try{await saveMs(x,`added ${its.length===1?"“"+its[0].t+"”":its.length+" items"} to ${x.name}`);toast(`${its.length} added. Now pick who does each one`)}catch(err){return}break}
    case"sendpicks":{const x=MS(b.dataset.ms),sel=x.items.map((it,j)=>({it,j,to:PICK[x.id+"|"+j]})).filter(o=>o.to&&!o.it.ok);if(!sel.length)return;b.disabled=true;
      const list=sel.map(o=>{const due=(document.getElementById(`pd-${x.id}-${o.j}`)||{}).value||defDue(x);return{title:o.it.t,to:o.to,due,about:o.it.g||"",ms:x.id,deliv:true,logTxt:`gave “${o.it.t}” (${x.name}) to ${nm(o.to)}, due ${longDate(due)}`}});
      try{await giveTasks(list);sel.map(o=>o.j).sort((p,q)=>q-p).forEach(j=>x.items.splice(j,1));Object.keys(PICK).forEach(k=>{if(k.startsWith(x.id+"|"))delete PICK[k]});await saveMs(x);
        const names=[...new Set(list.map(t=>nm(t.to)))];toast(`${list.length} task${list.length>1?"s":""} sent to ${names.join(", ")}`)}catch(err){b.disabled=false;return}break}
    case"assignopen":{const j=+b.dataset.j,same=S.open&&S.open.kind==="assign"&&S.open.ms===b.dataset.ms&&S.open.j===j;S.open=same?null:{kind:"assign",ms:b.dataset.ms,j};break}
    case"assignitem":{const x=MS(b.dataset.ms),j=+b.dataset.j,to=document.getElementById(`as-${x.id}-${j}`).value,due=document.getElementById(`ad-${x.id}-${j}`).value;
      if(!to){toast("Pick a person");return}const it=x.items[j];S.open=null;
      try{await giveTasks([{title:it.t,to,due,about:"",ms:x.id,deliv:true,logTxt:`gave “${it.t}” (${x.name}) to ${nm(to)}, due ${longDate(due)}`}]);x.items.splice(j,1);await saveMs(x);toast(`${it.t} sent to ${nm(to)}`)}catch(err){}break}
    case"addms":{const n=msForm.name.trim(),d=msForm.date;if(!n||!d){toast("Add a name and a date");return}
      try{const j=await send("saveMilestone",{projectId:S.cur,name:n,date:d,items:parseItems(msForm.items),logTxt:`planned ${n} for ${longDate(d)}`},`${n} added to the schedule`);
        S.ms.push(j.milestone);msForm={name:"",date:"",items:""}}catch(err){return}break}
    case"npcreate":{const n=document.getElementById("npname").value.trim();if(!n){toast("Give the project a name");return}
      try{const j=await send("createProject",{teamId:TEAM.id,name:n,msName:document.getElementById("npms").value.trim(),msDate:document.getElementById("npdate").value},`${n} created`);
        S.cur=j.projectId;S.tab="main";draft=null;await reload()}catch(err){}return}
  }
  render();
});
document.addEventListener("input",e=>{
  const id=e.target.id;
  if(id==="usearch"){uf.q=e.target.value;document.getElementById("ulist").innerHTML=updList();return}
  if(id==="utext"){udraft.text=e.target.value;return}
  if(id==="uabout"){udraft.about=e.target.value;return}
  if(id==="cuabout"){draft.about=e.target.value;return}
  if(id==="dabout"){draft.about=e.target.value;draft.man.about=!!e.target.value;return}
  if(id==="dfd"||id==="dfh"){const dd=+document.getElementById("dfd").value||0,hh=+document.getElementById("dfh").value||0,t=Math.min(dd,90)*24+Math.min(hh,23);
    draft.finH=t||null;draft.time="";if(t){draft.due=dstr(Date.now()+t*H);draft.man.due=true}document.getElementById("dfinby").textContent=finBy();
    document.querySelectorAll('[data-act="dfin"]').forEach(x=>x.setAttribute("aria-pressed",String(+x.dataset.h===draft.finH)));const ti=document.getElementById("dduetime");if(ti)ti.value="";return}
  if(id==="msname"){msForm.name=e.target.value;return}
  if(id==="msitems"){msForm.items=e.target.value;return}
  if(id==="ctext"){draft.text=e.target.value;const r=parseDraft(draft.text);["to","due","about"].forEach(f=>{if(!draft.man[f])draft[f]=r[f]||(f==="about"?"":null)});reChips();
    const n=draftLines().length;if(draft.mode==="task")document.getElementById("postbtn").textContent=n>1?`Send ${n} tasks`:"Send task"}
});
document.addEventListener("change",e=>{
  const id=e.target.id;
  if(e.target.dataset&&e.target.dataset.line!==undefined){draft.lineTo[+e.target.dataset.line]=e.target.value;reChips();return}
  if(e.target.dataset&&e.target.dataset.pick){PICK[e.target.dataset.pick]=e.target.value;const ms=e.target.dataset.pick.split("|")[0],n=pickCount(ms),bt=document.getElementById("sendpicks-"+ms);if(bt){bt.disabled=!n;bt.textContent=n?`Send ${n} task${n>1?"s":""}`:"Pick people, then send"}return}
  if(id==="dms"){draft.ms=e.target.value;return}
  if(id==="dduedate"){if(e.target.value){draft.due=e.target.value;draft.man.due=true;draft.finH=null;reChips()}return}
  if(id==="dduetime"){draft.time=e.target.value;if(draft.time){draft.finH=null;if(!draft.due){draft.due=dstr(Date.now());draft.man.due=true}}reChips();return}
  if(id==="msdate"){msForm.date=e.target.value;return}
  if(id==="projsel"){if(e.target.value==="__new"){S.tab="newproj";render()}else{S.cur=e.target.value;S.tab="main";S.filter=null;draft=null;EDIT=null;uf={q:"",about:"all"};reload()}return}
  if(id==="teamsel"){TEAM=TEAMS.find(t=>t.id===e.target.value);S.cur=null;S.tab="main";draft=null;lastInvite=null;reload();return}
  if(id==="rfrom"&&e.target.value){R.from=e.target.value;render()}
  if(id==="rto"&&e.target.value){R.to=e.target.value;render()}
  if(id==="rscope"){R.scope=e.target.value;render()}
  if(id==="rwho"){R.who=e.target.value;render()}
  if(id==="set-logo"&&e.target.files[0]){shrinkLogo(e.target.files[0]).then(u=>send("editTeam",{teamId:TEAM.id,logo:u},"Logo saved").then(()=>{LOGO=u;render()})).catch(err=>toast(err.message))}
});
document.addEventListener("keydown",e=>{
  const id=e.target.id;
  if(id==="ctext"&&e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();document.getElementById("postbtn").click()}
  if(id==="utext"&&e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();document.querySelector('[data-act="upost"]').click()}
  if(id&&id.startsWith("ni-")&&e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();document.querySelector(`[data-act="additems"][data-ms="${id.slice(3)}"]`).click()}
});
/* refresh every minute while nobody is typing */
setInterval(()=>{const a=document.activeElement;if(TOKEN&&TEAM&&!document.hidden&&!(a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))&&saving===0&&!S.open&&!EDIT&&S.tab!=="history")reload()},60000);
boot();
