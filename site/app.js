/* Project Pulse — real app. Data lives in the Google Sheet behind window.PULSE_API (Apps Script). */
"use strict";
const DAY=864e5, H=36e5, GOAL=10;
const TAGC=["tw1","tw2","twp","twb"];
const BLOCKERS=["MEP","Structure","Client","Project manager"];
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};

let TOKEN=store.get("pulse-token"), ME=null, TEAMS=[], TEAM=null, ROLE="team", PROJECTS=[], PEOPLE=[], INVITES=[];
const S={tasks:[],updates:[],log:[],ms:[],cur:store.get("pulse-project"),tab:"main",open:null,filter:null};
let lastInvite=null, authMode="in", authErr="";

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
let saving=0;
function busy(d){saving+=d;const el=document.getElementById("saving");if(el)el.textContent=saving>0?"Saving…":"Saved"}
async function send(action,body,okMsg){
  busy(1);
  try{const j=await api(action,body);busy(-1);if(okMsg)toast(okMsg);return j}
  catch(e){busy(-1);toast(e.message);await reload();throw e}
}

/* ---------- helpers ---------- */
const P=id=>PEOPLE.find(p=>p.id===id);
const me=()=>P(ME.id)||{id:ME.id,name:ME.name,mgr:ROLE==="mgr",color:"#141b2b"};
const team=()=>PEOPLE.filter(p=>!p.mgr);
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
const isLate=k=>k.status!=="done"&&k.due&&daysTo(k.due)<0;
const onTimeK=k=>k.doneAt<=new Date(k.due+"T23:59").getTime();
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
async function reload(){
  if(!TOKEN||!TEAM)return;
  try{
    const j=await api("load",{teamId:TEAM.id,projectId:S.cur});
    PEOPLE=j.members;ROLE=j.role;PROJECTS=j.projects;INVITES=j.invites||[];S.cur=j.projectId;
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
  document.getElementById("tabs").innerHTML=S.cur?t("main",m.mgr?"Control room":"My day")+t("schedule","Schedule")+t("updates",`Updates${un?` <span class="dotn">${un}</span>`:""}`)+t("history","History")+(m.mgr?t("people","Team &amp; roles"):"")+`<span class="spacer"></span><button class="linkbtn" data-act="refresh">Refresh</button>`:(m.mgr?t("people","Team &amp; roles"):"");
  document.getElementById("aboutlist").innerHTML=allTags().map(x=>`<option value="${esc(x)}">`).join("");
}

/* ---------- team view ---------- */
function taskCard(k){
  const d=dueInfo(k.due),open=S.open&&S.open.id===k.id?S.open.kind:null,m=MS(k.ms);
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
  <p class="sub">${next?`Next up: <b>${esc(next.title)}</b> · ${dueInfo(next.due).t.toLowerCase()}.`:"Nothing open. Enjoy the calm."} ${unseen.length?`<b>${unseen.length} new</b> from your managers.`:""}</p>
  <div class="layout"><div class="stack">
    ${warnBox(myWarnings(m.id))}
    ${unseen.length?`<section class="inbox"><h2>New for you <span class="n">${unseen.length}</span></h2>
      ${unseen.map(k=>`<div class="nitem">${av(k.by)}<div class="tx"><b>${esc(k.title)}</b><span>${esc(nm(k.by))} · ${ago(k.at)} · ${esc(k.about||"Whole project")} · ${dueInfo(k.due).t}</span></div><button class="btn go" data-act="got" data-id="${k.id}">Got it</button></div>`).join("")}</section>`:""}
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
const newDraft=()=>({mode:"task",text:"",to:null,due:null,about:"",ms:(upcoming()[0]||{}).id||"",man:{},lineTo:{}});
let draft=null;
const draftLines=()=>draft.text.split("\n").map(s=>s.trim()).filter(Boolean);
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const cleanTitle=(text,to)=>{const n=P(to)?.name;return (n?text.replace(new RegExp("^"+reEsc(n)+"\\s*[,:\\-–]?\\s*","i"),""):text).replace(/^./,c=>c.toUpperCase())};
function parseDraft(t){
  const r={};const first=team().find(p=>new RegExp("^\\s*"+reEsc(p.name.split(" ")[0])+"\\b","i").test(t))||team().find(p=>new RegExp("\\b"+reEsc(p.name.split(" ")[0])+"\\b","i").test(t));if(first)r.to=first.id;
  const base=new Date();let off=null;
  if(/\b(today|tonight|asap)\b/i.test(t))off=0;else if(/\btomorrow\b/i.test(t))off=1;else if(/\bnext week\b/i.test(t))off=7;
  else{const days=["sun","mon","tue","wed","thu","fri","sat"];const m=t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);if(m)off=(days.indexOf(m[1].toLowerCase())-base.getDay()+7)%7||7}
  if(off!==null)r.due=dstr(Date.now()+off*DAY);
  const known=allTags().find(tg=>t.toLowerCase().includes(tg.toLowerCase()));
  const tw=t.match(/\b(tower|block|building|villa)\s*[0-9a-z]\b|\b(podium|basement|lobby|facade|roof|parking|landscape|clubhouse)\b/i);
  if(known)r.about=known;else if(tw)r.about=tw[0].replace(/\b\w/g,c=>c.toUpperCase());
  return r;
}
const DUEOPTS=()=>{const d=new Date(),fri=(5-d.getDay()+7)%7||7;return[["Today",0],["Tomorrow",1],["Friday",fri],["Next week",7]].map(([l,o])=>[l,dstr(Date.now()+o*DAY)])};
function msSelect(id){return `<select id="${id}" aria-label="Delivery"><option value="">No delivery</option>${upcoming().map(m=>`<option value="${m.id}" ${draft.ms===m.id?"selected":""}>${esc(m.name)} · ${dueInfo(m.date).t.replace("Due ","")}</option>`).join("")}</select>`}
const inviteLink=`<button class="chip" data-act="tab" data-t="people">+ Invite someone</button>`;
function bulkChips(){
  const ls=draftLines();
  return `<div class="bulkhead"><b>${ls.length} tasks</b> · one per line. Check who gets each one:</div>
   ${ls.map((l,i)=>{const r=parseDraft(l);const to=draft.lineTo[i]||r.to||"";const d=r.due?dueInfo(r.due).t:"Due in 3 days";
     return `<div class="brow">${to?av(to,1):`<span class="av sm" style="background:var(--line);color:var(--muted)">?</span>`}<span class="bt">${esc(to?cleanTitle(l,to):l)}</span>
       <select data-line="${i}" aria-label="Who gets line ${i+1}"><option value="">Pick person</option>${team().map(p=>`<option value="${p.id}" ${p.id===to?"selected":""}>${esc(p.name)}</option>`).join("")}</select>
       ${r.about?aboutTag(r.about):""}<span class="tag due">${d}</span></div>`}).join("")}
   <div class="crow"><span class="lbl">For</span>${msSelect("dms")}<span class="hint">All these tasks count toward this delivery.</span></div>`;
}
function composerChips(){
  const auto=f=>!draft.man[f]&&draft[f];
  if(draft.mode==="update")return "";
  if(draftLines().length>1)return bulkChips();
  return `
   <div class="crow"><span class="lbl">Who</span>${team().map(p=>`<button class="pick" data-act="dto" data-id="${p.id}" aria-pressed="${draft.to===p.id}" aria-label="Assign to ${esc(p.name)}" title="${esc(p.name)}">${av(p.id)}</button>`).join("")||`<span class="hint">No team members yet.</span>`}
     ${inviteLink}${draft.to?`<span class="chip ${auto("to")?"auto":""}" style="cursor:default">For ${esc(nm(draft.to))}${auto("to")?" · picked from text":""}</span>`:""}</div>
   <div class="crow"><span class="lbl">Due</span>${DUEOPTS().map(([l,v])=>`<button class="chip ${auto("due")&&draft.due===v?"auto":""}" data-act="ddue" data-v="${v}" aria-pressed="${draft.due===v&&!auto("due")}">${l}</button>`).join("")}<input type="date" id="dduedate" aria-label="Other date" value="${draft.due&&!DUEOPTS().some(o=>o[1]===draft.due)?draft.due:""}"></div>
   <div class="crow"><span class="lbl">About</span><input type="text" class="aboutin" id="dabout" list="aboutlist" placeholder="Anything: Tower 4, lobby ceiling, client comments…" value="${esc(draft.about)}" aria-label="What it's about">${auto("about")?`<span class="hint" style="color:var(--accent)">picked from text</span>`:""}</div>
   <div class="crow"><span class="lbl">For</span>${msSelect("dms")}</div>`;
}
function renderMgr(){
  if(!draft)draft=newDraft();
  const m=me(),t=S.tasks,now=Date.now();
  const stuck=t.filter(k=>k.status==="stuck"),late=t.filter(isLate),unseen=t.filter(k=>!k.seenAt&&now-k.at>12*H),fin=t.filter(k=>k.status==="done"&&now-k.doneAt<2*DAY&&!k.kudos.includes(m.id));
  const match=k=>!S.filter||(S.filter==="stuck"&&k.status==="stuck")||(S.filter==="late"&&isLate(k))||(S.filter==="unseen"&&!k.seenAt&&now-k.at>12*H)||(S.filter==="fin"&&fin.includes(k));
  const col=(st,title)=>{const list=t.filter(k=>k.status===st&&(st!=="done"||now-k.doneAt<7*DAY)).sort((a,b)=>st==="done"?b.doneAt-a.doneAt:(a.due||"9").localeCompare(b.due||"9"));
    return `<div class="col"><h3>${title}<span class="hint">${list.length}</span></h3>${list.map(k=>miniCard(k,match(k))).join("")||`<div class="hint" style="padding:8px">Nothing here</div>`}</div>`};
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
function miniCard(k,on){
  const m=me(),d=dueInfo(k.due);let a="";
  if(k.status==="stuck")a=`<button class="btn sm" data-act="nudge" data-id="${k.id}" data-to="${esc(k.stuckOn)}">Chase ${esc(k.stuckOn)}</button>`;
  if(k.status==="new"&&!k.seenAt)a=`<button class="btn sm" data-act="nudge" data-id="${k.id}" data-to="${esc(nm(k.to))}">Nudge ${esc(nm(k.to))}</button>`;
  if(k.status==="done")a=k.kudos.includes(m.id)?`<span class="kudo">👏 Sent</span>`:`<button class="btn sm go" data-act="kudos" data-id="${k.id}">👏 Kudos</button><button class="btn sm quiet" data-act="reopen" data-id="${k.id}">Reopen</button>`;
  return `<div class="mini ${on?"":"dim"}">
    <div class="row">${av(k.to,1)}<b style="color:var(--ink)">${esc(nm(k.to))}</b><span style="margin-left:auto">${aboutTag(k.about)}</span></div>
    <div class="t">${esc(k.title)}</div>
    <div class="row">${k.status==="done"?`<span class="donewhen">Done ${ago(k.doneAt)}</span>`:`<span class="tag due ${d.c}">${d.t}</span>`}
      ${k.status==="new"?(k.seenAt?`<span class="eye yes">✓ Got it</span>`:`<span class="eye no">Not opened yet</span>`):""}${k.status==="stuck"?`<span class="note">on ${esc(k.stuckOn)}</span>`:""}</div>
    ${a?`<div class="acts">${a}</div>`:""}</div>`;
}

/* ---------- schedule ---------- */
let msForm={name:"",date:"",items:""};
function personSelect(id,optional){return `<select id="${id}" aria-label="Who does it"><option value="">${optional?"No one yet":"Pick person"}</option>${team().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`}
function renderSchedule(){
  const m=me(),list=S.ms.slice().sort((a,b)=>a.date.localeCompare(b.date));
  let track="";
  if(list.length){const t0=Math.min(new Date(list[0].date).getTime(),Date.now()-7*DAY),t1=Math.max(new Date(list[list.length-1].date).getTime(),Date.now()+7*DAY),pos=ms=>((ms-t0)/(t1-t0)*80+10).toFixed(1);
    track=`<div class="panel"><div class="trackwrap"><div class="track"><div class="line"></div><div class="done" style="width:${pos(Date.now())}%"></div>
      <div class="today" style="left:${pos(Date.now())}%"><span>Today</span></div>
      ${list.map(x=>{const i=msInfo(x);return `<div class="mk ${i.left<0||i.pct===100?"ok":i.risk==="red"?"risk":""}" style="left:${pos(new Date(x.date+"T12:00").getTime())}%"><i></i><b>${esc(x.name.split(" · ")[0])}</b><span>${new Date(x.date+"T12:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})} · ${i.pct}%</span></div>`}).join("")}
    </div></div></div>`}
  const card=x=>{const i=msInfo(x);
    return `<article class="mcard ${i.left<0?"past":""}">
      <div class="mtop"><div><div class="mname">${esc(x.name)}</div><div class="hint">${longDate(x.date)}</div></div>${countdown(x,i)}</div>
      ${bar(i)}
      <div class="tags"><b>${i.pct}% ready</b><span class="hint">· ${i.got} of ${i.total} items · ${i.total-i.got} left</span>${i.late?`<span class="tag due late">${i.late} late</span>`:""}${i.stuck?`<span class="tag due late">${i.stuck} stuck</span>`:""}</div>
      <div class="mgrid">
        <div><h4>What we deliver</h4><div class="dl">
          ${i.ts.filter(k=>k.deliv).map(k=>`<div class="ditem">${av(k.to,1)}<span class="x ${k.status==="done"?"dn":""}">${esc(k.title)}</span><span class="hint">${esc(nm(k.to))} · ${k.status==="done"?"done "+ago(k.doneAt):dueInfo(k.due).t.replace("Due ","")}</span>${isLate(k)?`<span class="tag due late">Late</span>`:`<span class="st ${k.status}">${{new:"New",doing:"Doing",stuck:"Stuck",done:"Done"}[k.status]}</span>`}</div>`).join("")}
          ${x.items.map((it,j)=>{const op=S.open&&S.open.kind==="assign"&&S.open.ms===x.id&&S.open.j===j;
            return `<div class="ditem"><label class="${it.ok?"ok":""}"><input type="checkbox" data-act="tick" data-ms="${x.id}" data-j="${j}" ${it.ok?"checked":""} ${m.mgr?"":"disabled"}><span>${esc(it.t)}</span></label>
            ${m.mgr&&!it.ok?`<button class="linkbtn" data-act="assignopen" data-ms="${x.id}" data-j="${j}">${op?"Cancel":"Give to someone"}</button>`:""}</div>
            ${op?`<div class="crow assignrow">${personSelect("as-"+x.id+"-"+j)}<input type="date" id="ad-${x.id}-${j}" aria-label="Due date" max="${x.date}" value="${dstr(Math.min(Date.now()+3*DAY,new Date(x.date+"T12:00").getTime()))}"><button class="btn sm go" data-act="assignitem" data-ms="${x.id}" data-j="${j}">Send</button></div>`:""}`}).join("")}
          ${!x.items.length&&!i.ts.some(k=>k.deliv)?`<span class="hint">No items listed.</span>`:""}</div>
          ${m.mgr?`<div class="additem"><input type="text" id="ni-${x.id}" placeholder="Add an item, e.g. Sections A–D" aria-label="New item">
            <div class="crow">${personSelect("np-"+x.id,true)}<input type="date" id="nd-${x.id}" aria-label="Due date" max="${x.date}"><button class="btn sm go" data-act="additem" data-ms="${x.id}">Add</button></div>
            <span class="hint">Pick a person to send it as a task, or leave “No one yet” and tick it yourself.</span></div>`:`<div class="hint" style="margin-top:4px">Items with a name are tasks; managers tick the rest.</div>`}</div>
        <div><h4>Other tasks for this delivery</h4><div class="tl">${i.ts.filter(k=>!k.deliv).map(k=>`<div>${av(k.to,1)}<span class="x">${esc(k.title)}</span>${isLate(k)?`<span class="tag due late">Late</span>`:`<span class="st ${k.status}">${{new:"New",doing:"Doing",stuck:"Stuck",done:"Done"}[k.status]}</span>`}</div>`).join("")||`<span class="hint">No tasks linked yet. Pick this delivery when you give out a task.</span>`}</div></div>
      </div></article>`};
  return `<h1>Schedule &amp; deliveries</h1>
  <p class="sub">Every delivery, its date, and how much is ready. Everyone sees the same bar, so the whole team knows how close we are.</p>
  <div class="layout"><div class="stack">${track}${[...list.filter(x=>daysTo(x.date)>=0),...list.filter(x=>daysTo(x.date)<0).reverse()].map(card).join("")||`<div class="panel empty">No deliveries yet.${m.mgr?" Add the first one on the right.":""}</div>`}</div>
  <aside class="rail">
    ${trophyShelf()}
    ${m.mgr?`<div class="panel"><h2>Add a delivery</h2><div class="form">
      <label>Name<input type="text" id="msname" placeholder="e.g. Tender package" value="${esc(msForm.name)}"></label>
      <label>Date<input type="date" id="msdate" value="${msForm.date}"></label>
      <label>What gets delivered (one per line)<textarea id="msitems" placeholder="GA plans&#10;Sections&#10;Area schedule">${esc(msForm.items)}</textarea></label>
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
  return `<article class="ucard ${u.pinned?"pinned":""}">
    <div class="thead">${av(u.by,1)}<span><b style="color:var(--ink)">${esc(nm(u.by))}</b> · ${new Date(u.at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})} · ${ago(u.at)}</span>${u.pinned?`<span class="pin">Pinned</span>`:""}<span style="margin-left:auto">${aboutTag(u.about)}</span></div>
    <div class="utext">${esc(u.text)}</div>
    <div class="meta"><span class="seen">${others.map(id=>av(id,1)).join("")}</span><span class="hint">Seen by ${others.length} of ${Math.max(PEOPLE.length-1,0)}</span>
      <span style="margin-left:auto;display:flex;gap:6px">${u.seenBy.includes(m.id)?`<span style="color:var(--teal);font-weight:600;font-size:13px">✓ Seen</span>`:`<button class="btn sm go" data-act="seenupd" data-id="${u.id}">👍 Seen</button>`}
      ${m.mgr?`<button class="btn sm quiet" data-act="pin" data-id="${u.id}">${u.pinned?"Unpin":"Pin"}</button>`:""}</span></div></article>`;
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

/* ---------- history ---------- */
let hf={who:"all",from:dstr(Date.now()-14*DAY),to:dstr(Date.now())};
function histRows(){const f=new Date(hf.from+"T00:00").getTime(),t=new Date(hf.to+"T23:59:59").getTime(),n=P(hf.who)?.name;
  return S.log.filter(e=>e.at>=f&&e.at<=t&&(hf.who==="all"||e.who===hf.who||(n&&e.txt.includes(" "+n)))).sort((a,b)=>b.at-a.at)}
function renderHistory(){
  const rows=histRows();let html="",day="";
  rows.forEach(e=>{const d=new Date(e.at).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});if(d!==day){day=d;html+=`<div class="day">${d}</div>`}
    html+=`<div class="ev"><span class="tm">${new Date(e.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</span>${av(e.who,1)}<div><span class="k">${esc(nm(e.who))}</span> ${esc(e.txt)}</div></div>`});
  return `<h1>Everything, on record.</h1>
  <p class="sub">Every task, update, stuck and done is saved with its time. Nobody writes a report by hand.</p>
  <div class="panel"><div class="hfilters">
    <label>Person<select id="hwho"><option value="all">Everyone</option>${PEOPLE.map(p=>`<option value="${p.id}" ${hf.who===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label>From<input type="date" id="hfrom" value="${hf.from}"></label><label>To<input type="date" id="hto" value="${hf.to}"></label>
    <button class="btn" data-act="copy">Copy for Excel</button><span class="hint">${rows.length} entries</span></div>
    ${html||`<div class="empty">Nothing in these dates.</div>`}</div>`;
}

/* ---------- team & roles ---------- */
let newRole="team";
function renderPeople(){
  const mgrs=PEOPLE.filter(p=>p.mgr).length,link=lastInvite?`${location.origin}${location.pathname}?invite=${lastInvite.code}`:"";
  const row=p=>`<div class="prow">${av(p.id)}<div class="pinfo"><b>${esc(p.name)}${p.id===ME.id?' <span class="hint">(you)</span>':""}</b><span class="hint">${p.mgr?"Gives out tasks, posts updates, plans deliveries":"Gets tasks, marks them done"}</span></div>
      <div class="seg"><button data-act="setrole" data-id="${p.id}" data-v="mgr" aria-pressed="${!!p.mgr}">Manager</button><button data-act="setrole" data-id="${p.id}" data-v="team" aria-pressed="${!p.mgr}">Team</button></div></div>`;
  return `<h1>Who's who in ${esc(TEAM.name)}</h1>
  <p class="sub">Tap <b>Manager</b> or <b>Team</b> next to each name. People from other teams never see your projects.</p>
  <div class="layout"><div class="stack">
    <div class="panel"><h2>Managers <span class="n">${mgrs}</span></h2>${PEOPLE.filter(p=>p.mgr).map(row).join("")}</div>
    <div class="panel"><h2>Team <span class="n">${PEOPLE.length-mgrs}</span></h2>${team().map(row).join("")||`<div class="empty">No team members yet. Invite someone on the right.</div>`}</div>
  </div>
  <aside class="rail"><div class="panel"><h2>Invite someone</h2><div class="stack" style="gap:10px">
      <div class="seg"><button data-act="newrole" data-v="team" aria-pressed="${newRole==="team"}">As team</button><button data-act="newrole" data-v="mgr" aria-pressed="${newRole==="mgr"}">As manager</button></div>
      <button class="btn go" data-act="invite">Make an invite code</button>
      ${lastInvite?`<div class="invite"><code>${lastInvite.code}</code><button class="btn sm" data-act="copylink" data-v="${esc(link)}">Copy link</button></div><span class="hint">Send the link on WhatsApp or email. It works once, for one person, as ${lastInvite.role==="mgr"?"a manager":"a team member"}.</span>`:`<span class="hint">Each code works once. The person opens the link, creates an account and lands in this team.</span>`}
      ${INVITES.length?`<div class="hint">Unused codes: ${INVITES.map(i=>`<code>${esc(i.code)}</code> (${i.role==="mgr"?"manager":"team"})`).join(", ")}</div>`:""}
    </div></div></aside></div>`;
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
  if((S.tab==="people"||S.tab==="newproj")&&!m.mgr)S.tab="main";
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
  switch(a){
    case"authmode":authMode=b.dataset.v;authErr="";renderAuth();return;
    case"signout":signOut();return;
    case"retry":document.getElementById("view").innerHTML=`<div class="loading">Loading…</div>`;boot();return;
    case"refresh":await reload();toast("Up to date");return;
    case"jointeam":{try{await api("joinTeam",{invite:document.getElementById("j-code").value});await boot()}catch(err){toast(err.message)}return}
    case"tab":S.tab=b.dataset.t;window.scrollTo(0,0);break;
    case"got":k.seenAt=Date.now();logLocal(`got “${k.title}”`);taskDo(k,"got",null,`got “${k.title}”`,`${nm(k.by)} can see you've got it`);break;
    case"start":k.status="doing";if(!k.seenAt)k.seenAt=Date.now();taskDo(k,"start",null,`started “${k.title}”`,"Started. Good luck!");break;
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
    case"ddue":draft.due=b.dataset.v;draft.man.due=true;reChips();return;
    case"sugg":{const el=document.getElementById(b.dataset.target);el.value=b.dataset.v;el.dispatchEvent(new Event("input",{bubbles:true}));return}
    case"post":{const text=draft.text.trim();if(!text){toast("Write something first");document.getElementById("ctext").focus();return}
      b.disabled=true;
      try{
        if(draft.mode==="update"){const j=await send("postUpdate",{projectId:S.cur,text,about:draft.about.trim()},"Posted. Everyone on the team can see it");S.updates.push(j.update)}
        else{const ls=draftLines();
          const items=ls.length>1?ls.map((l,i)=>{const r=parseDraft(l);return{line:l,to:draft.lineTo[i]||r.to,due:r.due,about:r.about||""}}):[{line:text,to:draft.to,due:draft.due,about:draft.about.trim()}];
          const miss=items.findIndex(x=>!x.to);if(miss>=0){toast(ls.length>1?`Pick a person for line ${miss+1}`:"Tap who it's for");b.disabled=false;return}
          const list=items.map(x=>{const title=cleanTitle(x.line,x.to);return{title,to:x.to,due:x.due||dstr(Date.now()+3*DAY),about:x.about,ms:draft.ms,logTxt:`assigned “${title}” to ${nm(x.to)}`}});
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
    case"assignopen":{const j=+b.dataset.j,same=S.open&&S.open.kind==="assign"&&S.open.ms===b.dataset.ms&&S.open.j===j;S.open=same?null:{kind:"assign",ms:b.dataset.ms,j};break}
    case"assignitem":{const x=MS(b.dataset.ms),j=+b.dataset.j,to=document.getElementById(`as-${x.id}-${j}`).value,due=document.getElementById(`ad-${x.id}-${j}`).value;
      if(!to){toast("Pick a person");return}const it=x.items[j];S.open=null;
      try{await giveTasks([{title:it.t,to,due,about:"",ms:x.id,deliv:true,logTxt:`gave “${it.t}” (${x.name}) to ${nm(to)}, due ${longDate(due)}`}]);x.items.splice(j,1);await saveMs(x);toast(`${it.t} sent to ${nm(to)}`)}catch(err){}break}
    case"addms":{const n=msForm.name.trim(),d=msForm.date;if(!n||!d){toast("Add a name and a date");return}
      try{const j=await send("saveMilestone",{projectId:S.cur,name:n,date:d,items:msForm.items.split("\n").map(s=>s.trim()).filter(Boolean).map(t=>({t,ok:false})),logTxt:`planned ${n} for ${longDate(d)}`},`${n} added to the schedule`);
        S.ms.push(j.milestone);msForm={name:"",date:"",items:""}}catch(err){return}break}
    case"npcreate":{const n=document.getElementById("npname").value.trim();if(!n){toast("Give the project a name");return}
      try{const j=await send("createProject",{teamId:TEAM.id,name:n,msName:document.getElementById("npms").value.trim(),msDate:document.getElementById("npdate").value},`${n} created`);
        S.cur=j.projectId;S.tab="main";draft=null;await reload()}catch(err){}return}
    case"copy":{const rows=histRows();const tsv=["Date\tTime\tWho\tWhat",...rows.map(e=>[dstr(e.at),new Date(e.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),nm(e.who),e.txt].join("\t"))].join("\n");
      navigator.clipboard.writeText(tsv).then(()=>toast(`Copied ${rows.length} rows. Paste into Excel`),()=>toast("Copy is blocked here. Select the list and copy it"));return}
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
  if(id==="msname"){msForm.name=e.target.value;return}
  if(id==="msitems"){msForm.items=e.target.value;return}
  if(id==="ctext"){draft.text=e.target.value;const r=parseDraft(draft.text);["to","due","about"].forEach(f=>{if(!draft.man[f])draft[f]=r[f]||(f==="about"?"":null)});reChips();
    const n=draftLines().length;if(draft.mode==="task")document.getElementById("postbtn").textContent=n>1?`Send ${n} tasks`:"Send task"}
});
document.addEventListener("change",e=>{
  const id=e.target.id;
  if(e.target.dataset&&e.target.dataset.line!==undefined){draft.lineTo[+e.target.dataset.line]=e.target.value;reChips();return}
  if(id==="dms"){draft.ms=e.target.value;return}
  if(id==="dduedate"){if(e.target.value){draft.due=e.target.value;draft.man.due=true;reChips()}return}
  if(id==="msdate"){msForm.date=e.target.value;return}
  if(id==="projsel"){if(e.target.value==="__new"){S.tab="newproj";render()}else{S.cur=e.target.value;S.tab="main";S.filter=null;draft=null;uf={q:"",about:"all"};reload()}return}
  if(id==="teamsel"){TEAM=TEAMS.find(t=>t.id===e.target.value);S.cur=null;S.tab="main";draft=null;lastInvite=null;reload();return}
  if(id==="hwho"){hf.who=e.target.value;render()}
  if(id==="hfrom"){hf.from=e.target.value;render()}
  if(id==="hto"){hf.to=e.target.value;render()}
});
document.addEventListener("keydown",e=>{
  const id=e.target.id;
  if(id==="ctext"&&e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();document.getElementById("postbtn").click()}
  if(id==="utext"&&e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();document.querySelector('[data-act="upost"]').click()}
  if(id&&id.startsWith("ni-")&&e.key==="Enter"){e.preventDefault();document.querySelector(`[data-act="additem"][data-ms="${id.slice(3)}"]`).click()}
});
/* refresh every minute while nobody is typing */
setInterval(()=>{const a=document.activeElement;if(TOKEN&&TEAM&&!document.hidden&&!(a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))&&saving===0&&!S.open)reload()},60000);
boot();
