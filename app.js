(function(){
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const lsGet=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}};

// Club names differ between the camogie, LGFA and GAA boards; fold the known variants together.
const ALIAS={'round towers (c)':'round towers clondalkin','round towers (l)':'round towers lusk','st finians (n)':'st finians newcastle','st finians (s)':'st finians swords',
  'st patricks (d)':'st patricks donabate','st patricks (p)':'st patricks palmerstown','craobh chiaran':'craobh chiarain','geraldine p moran':'geraldine p morans','kevins hc':'kevins',
  'st oliver plunkett er':'st oliver plunketts er','templeogue synge st':'templeogue synge street','st pats donabate':'st patricks donabate'};
const ckey=s=>{const k=String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’'`.]/g,'').replace(/[\/&,]/g,' ').replace(/\s+/g,' ').trim();return ALIAS[k]||k};
const slug=k=>k.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const titleCase=k=>k.replace(/\b\w/g,c=>c.toUpperCase());

const ONLY='ballinteer st johns';
const state={data:null,fx:[],club:ONLY,sport:'all',grade:'all',venue:'all',err:'',loading:true,showRes:false};

function expand(rows,comps){return rows.map(r=>({id:r[0],date:r[1],time:r[2],sport:r[3],grade:r[4],comp:comps[r[5]]||'',home:r[6],away:r[7],hc:r[8]||r[6],ac:r[9]||r[7],venue:r[10],status:r[11],hs:r[12],as:r[13],hk:ckey(r[8]||r[6]),ak:ckey(r[9]||r[7])}))}
function clubIndex(){
  const seen=new Map();
  state.fx.forEach(x=>[[x.hk,x.hc],[x.ak,x.ac]].forEach(([k,n])=>{if(!k)return;if(!seen.has(k))seen.set(k,new Map());const m=seen.get(k);m.set(n,(m.get(n)||0)+1)}));
  const out=[];seen.forEach((m,k)=>{const best=[...m.entries()].sort((a,b)=>(/\(/.test(a[0])-/\(/.test(b[0]))||b[1]-a[1]||b[0].length-a[0].length)[0][0];out.push({key:k,name:/\(/.test(best)?titleCase(k):best})});
  return out.filter(c=>c.key===ONLY);
}
const score=s=>{const m=/^\s*(\d+)\s*[;:-]\s*(\d+)\s*$/.exec(s||'');return m?`${m[1]}-${pad(m[2])}`:''};
const pts=s=>{const m=/^\s*(\d+)\s*[;:-]\s*(\d+)\s*$/.exec(s||'');return m?Number(m[1])*3+Number(m[2]):null};
const teamSuffix=(team,club)=>{const t=String(team||''),c=String(club||'');return c&&t.toLowerCase().startsWith(c.toLowerCase())?t.slice(c.length).trim():''};
function sportColor(s){return /camog/i.test(s)?'var(--camogie)':/ladies|lgfa/i.test(s)?'var(--ladies)':/hurl/i.test(s)?'var(--hurling)':/football/i.test(s)?'var(--football)':'var(--other)'}
function gradeKey(g){const m=/U(\d+)/.exec(g);return m?Number(m[1]):/minor/i.test(g)?18:/junior|intermediate|senior|adult/i.test(g)?30:99}

function renderClubs(clubs){
  const sel=$('#club'),want=state.club;
  if(!clubs.length){if(state.loading){sel.innerHTML='<option value="">Loading clubs…</option>';sel.disabled=true;return}clubs=[{key:ONLY,name:'Ballinteer St Johns'}]}
  const opts=[].concat(clubs.map(c=>`<option value="${esc(c.key)}"${c.key===want?' selected':''}>${esc(c.name)}</option>`));
  if(want&&!clubs.some(c=>c.key===want))opts.push(`<option value="${esc(want)}" selected>${esc(titleCase(want))}</option>`);
  const html=opts.join('');if(sel.dataset.h!==html){sel.innerHTML=html;sel.dataset.h=html}
  sel.disabled=false;
}

function render(){
  const d=state.data,clubs=clubIndex(),td=ymd(new Date());
  const h=(location.hash||'').slice(1);if(h&&clubs.length){const m=clubs.find(c=>slug(c.key)===h);if(m&&m.key!==state.club){state.club=m.key;lsSet('club',m.key)}}
  renderClubs(clubs);
  const up=d&&d.updatedAt?new Date(d.updatedAt):null;
  $('#status').innerHTML=state.err?`<span class="err">${esc(state.err)}</span>`:up?`Updated ${up.toLocaleDateString('en-IE',{weekday:'short',day:'numeric',month:'short'})} at ${up.toLocaleTimeString('en-IE',{hour:'2-digit',minute:'2-digit'})}`:'Loading fixtures…';
  if(d){const f=parseD(d.from),t=parseD(d.to);$('#range').textContent=`Monday ${f.toLocaleDateString('en-IE',{day:'numeric',month:'short'})} to Sunday ${t.toLocaleDateString('en-IE',{day:'numeric',month:'short'})}`}

  const club=state.club,cinfo=clubs.find(c=>c.key===club),cname=cinfo?cinfo.name:titleCase(club||'');
  const mine=club?state.fx.filter(x=>x.hk===club||x.ak===club):[];
  const sports=[...new Set(mine.map(x=>x.sport))].sort(),grades=[...new Set(mine.map(x=>x.grade).filter(Boolean))].sort((a,b)=>gradeKey(a)-gradeKey(b));
  if(state.sport!=='all'&&!sports.includes(state.sport))state.sport='all';
  if(state.grade!=='all'&&!grades.includes(state.grade))state.grade='all';
  const chip=(k,v,l,on)=>`<button class="chip" data-${k}="${esc(v)}" aria-pressed="${on}">${esc(l)}</button>`;
  {const hasHA=mine.some(x=>x.hk===club)&&mine.some(x=>x.hk!==club),g=[];if(!hasHA)state.venue='all';
   if(hasHA)g.push(chip('venue','all','Home & away',state.venue==='all')+chip('venue','home','Home',state.venue==='home')+chip('venue','away','Away',state.venue==='away'));
   if(sports.length>1)g.push(chip('sport','all','All codes',state.sport==='all')+sports.map(s=>chip('sport',s,s,state.sport===s)).join(''));
   if(grades.length>1)g.push(chip('grade','all','All ages',state.grade==='all')+grades.map(v=>chip('grade',v,v,state.grade===v)).join(''));
   $('#filters').innerHTML=mine.length>1?g.join('<span class="sep"></span>'):'';}
  const home=mine.filter(x=>x.hk===club).length;
  $('#summary').innerHTML=club&&mine.length?`<div class="summary"><span class="club">${esc(cname)}</span><span class="nums">${mine.length} game${mine.length===1?'':'s'} · ${home} home · ${mine.length-home} away</span></div>`:'';

  const shown=mine.filter(x=>(state.sport==='all'||x.sport===state.sport)&&(state.grade==='all'||x.grade===state.grade)&&(state.venue==='all'||(state.venue==='home')===(x.hk===club)));
  {const done=shown.filter(x=>x.status!=='Postponed'&&score(x.hs)&&score(x.as)).sort((p,q)=>(p.date+(p.time||'')).localeCompare(q.date+(q.time||'')));let W=0,D=0,L=0;
   const rows=done.map(x=>{const isHome=x.hk===club,them=isHome?x.away:x.home,us=isHome?x.home:x.away,team=teamSuffix(us,isHome?x.hc:x.ac),a=score(isHome?x.hs:x.as),b=score(isHome?x.as:x.hs),pu=pts(isHome?x.hs:x.as),pt=pts(isHome?x.as:x.hs);if(pu>pt)W++;else if(pu<pt)L++;else D++;
     return `<li><div class="rmeta">${esc(parseD(x.date).toLocaleDateString('en-IE',{weekday:'short',day:'numeric',month:'short'}))}${x.grade?` \u00b7 ${esc(x.grade)}`:''} \u00b7 ${esc(x.sport)}${team?` \u00b7 ${esc(cname)} ${esc(team)}`:''}</div><div class="rline"><span class="${pu>pt?'w us':pu===pt?'w':''}">${esc(cname)} ${a}</span> \u00b7 <span class="${pt>=pu?'w':''}">${esc(them)} ${b}</span></div></li>`}).join('');
   $('#results').innerHTML=done.length?`<section class="results" aria-label="Match results"><div class="rhead"><h2>Results</h2><span class="tally"><b class="tw">Won ${W}</b> \u00b7 <b>Drawn ${D}</b> \u00b7 <b>Lost ${L}</b></span></div><button class="rbtn" id="rtoggle" aria-expanded="${state.showRes}">${state.showRes?'Hide results':`Show all ${done.length} result${done.length===1?'':'s'}`}</button>${state.showRes?`<ul class="rlist">${rows}</ul>`:''}</section>`:'';}
  const byDay=new Map();shown.forEach(x=>{if(!byDay.has(x.date))byDay.set(x.date,[]);byDay.get(x.date).push(x)});
  const days=[...byDay.keys()].sort();
  let empty='';
  if(state.loading)empty='<strong>Loading fixtures</strong>Getting this week’s games for every Dublin club.';
  else if(!d)empty='<strong>Fixtures aren’t available right now</strong>Try again in a few minutes.';
  else if(!club)empty=`<strong>Choose your club</strong>${state.fx.length} games across ${clubs.length} clubs this week.`;
  else if(!mine.length)empty=`<strong>No games for ${esc(cname)}</strong>There are no ${esc(cname)} fixtures in the feed for this week.`;
  else if(!shown.length)empty='<strong>Nothing matches</strong>No games match these filters.';
  $('#days').innerHTML=empty?`<div class="empty">${empty}</div>`:days.map(dd=>{const dt=parseD(dd),list=byDay.get(dd).sort((a,b)=>(a.time||'99').localeCompare(b.time||'99')||gradeKey(a.grade)-gradeKey(b.grade));
    return `<section class="day" aria-label="${esc(dt.toLocaleDateString('en-IE',{weekday:'long',day:'numeric',month:'long'}))}"><div class="dlabel${dd===td?' today':''}"><span class="dw">${dd===td?'Today':esc(dt.toLocaleDateString('en-IE',{weekday:'short'}))}</span><span class="dn">${dt.getDate()}</span><span class="dm">${esc(dt.toLocaleDateString('en-IE',{month:'short'}))}</span></div>
      <div class="list">${list.map(x=>{const isHome=x.hk===club,us=isHome?x.home:x.away,them=isHome?x.away:x.home,usClub=isHome?x.hc:x.ac,team=teamSuffix(us,usClub);
        const a=score(isHome?x.hs:x.as),b=score(isHome?x.as:x.hs),pp=x.status==='Postponed';
        return `<article class="fx${pp?' pp':''}" style="--sc:${sportColor(x.sport)}">
        <div class="opp"><span class="ha ${isHome?'home':'away'}">${isHome?'Home':'Away'}</span>v ${esc(them)}</div>
        <div class="when${x.time?'':' tbc'}">${x.time?esc(x.time):'Time TBC'}</div>
        <div class="meta">${x.grade?`<span class="grade">${esc(x.grade)}</span>`:''}<b>${esc(x.sport)}</b>${team?` · ${esc(cname)} ${esc(team)}`:''}${x.venue?` · ${esc(x.venue)}`:''}</div>
        <div class="meta">${esc(x.comp)}${pp?' · <span class="ppn">Postponed</span>':''}</div>
        ${a&&b&&!pp?(()=>{const pu=pts(isHome?x.hs:x.as),pt=pts(isHome?x.as:x.hs);return `<div class="res">Result: <span class="${pu>pt?'w us':pu===pt?'w':''}">${esc(cname)} ${a}</span> · <span class="${pt>=pu?'w':''}">${esc(them)} ${b}</span></div>`})():''}</article>`}).join('')}</div></section>`}).join('');
}

async function load(){
  try{
    const r=await fetch('fixtures.json',{cache:'no-cache'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    state.data=d;state.fx=expand(d.fx||[],d.comps||[]);state.err='';
  }catch(_){state.err='Couldn’t load the fixtures. Check your connection and reload the page.'}
  state.loading=false;render();
}

$('#club').addEventListener('change',e=>{state.club=e.target.value;lsSet('club',state.club);
  if(state.club&&window.goatcounter&&window.goatcounter.count){const ci=clubIndex().find(x=>x.key===state.club);try{window.goatcounter.count({path:'club/'+slug(state.club),title:ci?ci.name:state.club,event:true})}catch(_){}}
  state.sport='all';state.grade='all';
  try{history.replaceState(null,'',state.club?'#'+slug(state.club):location.pathname+location.search)}catch(_){}render()});
document.addEventListener('click',e=>{if(e.target.closest('#rtoggle')){state.showRes=!state.showRes;render();return}const b=e.target.closest('[data-sport],[data-grade],[data-venue]');if(!b)return;
  if(b.dataset.venue!==undefined)state.venue=b.dataset.venue;else if(b.dataset.sport!==undefined)state.sport=b.dataset.sport;else state.grade=b.dataset.grade;render()});
window.addEventListener('hashchange',render);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.data&&Date.now()-new Date(state.data.updatedAt).getTime()>30*60*1000)load()});
// ---- Result alerts (OneSignal web push) ----
const OS_APP='a9b7cfcb-32ce-447b-8bfb-a65e54a73e0a';
const BASE=location.pathname.replace(/[^/]*$/,'')||'/';
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const isStandalone=()=>{try{return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(_){return false}};
// Hidden for everyone for now. Shown only when the page is opened with ?alerts=1
// (remembered on that device; ?alerts=0 hides it again) or opened from the Home Screen.
const ALERTS_ON=(()=>{try{const m=/[?&]alerts=([01])/.exec(location.search);if(m)localStorage.setItem('bsjAlerts',m[1]);return localStorage.getItem('bsjAlerts')==='1'||isStandalone()}catch(_){return isStandalone()}})();
// OneSignal is only loaded when someone taps "Get result alerts", or on later visits
// from a device that already turned alerts on (remembered on that device).
const OPT='cfAlertsOptIn';
const optedLocal=()=>{try{return localStorage.getItem(OPT)==='1'}catch(_){return false}};
const setOpted=v=>{try{v?localStorage.setItem(OPT,'1'):localStorage.removeItem(OPT)}catch(_){}};
const canPush=()=>'Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window;
const push={os:null,ready:false,on:false,busy:false,tip:false,msg:'',want:''};
let osLoading=false;
function loadOS(){
  if(osLoading)return;osLoading=true;
  const s=document.createElement('script');s.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';s.defer=true;
  s.onerror=()=>{osLoading=false;s.remove();if(push.want)push.msg='Couldn’t reach the alerts service. Please try again.';push.busy=false;push.want='';renderAlerts()};
  document.head.appendChild(s);
}
if(ALERTS_ON&&optedLocal())loadOS();
const NOTE='<p class="atip">Alerts are optional and sent by OneSignal. Only an ID for this device is stored, no name, email or phone number. You can turn them off at any time.</p>';
function renderAlerts(){
  const el=$('#alerts');if(!el)return;
  if(!ALERTS_ON){el.innerHTML='';return}
  if(isIOS&&!isStandalone()){
    el.innerHTML=`<button class="abtn" id="atoggle" aria-expanded="${push.tip}">Get result alerts</button>`+
      (push.tip?`<p class="atip">On iPhone, alerts need this site on your Home Screen. Tap the <b>Share</b> button, then <b>Add to Home Screen</b>. Open it from your Home Screen and tap <b>Get result alerts</b> again.</p>`:'');
    return}
  if(!canPush()){el.innerHTML='';return}
  const on=push.ready?push.on:optedLocal();
  el.innerHTML=on
    ?`<span class="aon">Result alerts are on</span><button class="alink" id="aoff"${push.busy?' disabled':''}>Turn off</button>`
    :`<button class="abtn" id="aon"${push.busy?' disabled':''}>${push.busy?'Setting up…':'Get result alerts'}</button>`+NOTE;
  if(push.msg)el.innerHTML+=`<p class="atip">${esc(push.msg)}</p>`;
}
async function finishOn(){
  const OS=push.os;
  try{
    await OS.User.PushSubscription.optIn();
    push.on=!!OS.User.PushSubscription.optedIn;
    if(push.on){setOpted(true);try{window.goatcounter&&window.goatcounter.count&&window.goatcounter.count({path:'alerts/on',title:'Result alerts turned on',event:true})}catch(_){}}
    else push.msg='Couldn’t turn on alerts. Please try again.';
  }catch(_){push.msg='Couldn’t turn on alerts. Please try again.'}
  push.busy=false;push.want='';renderAlerts();
}
async function finishOff(){
  const OS=push.os;
  try{await OS.User.PushSubscription.optOut()}catch(_){}
  push.on=!!OS.User.PushSubscription.optedIn;if(!push.on)setOpted(false);
  push.busy=false;push.want='';renderAlerts();
}
async function alertsOn(){
  push.busy=true;push.msg='';renderAlerts();
  // Ask for permission straight away, while the tap still counts (needed on iPhone and Safari)
  let perm=Notification.permission;
  if(perm==='default'){try{perm=await Notification.requestPermission()}catch(_){}}
  if(perm!=='granted'){push.busy=false;push.msg='Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.';renderAlerts();return}
  push.want='on';
  if(push.ready)finishOn();else loadOS();
}
function alertsOff(){
  push.busy=true;push.msg='';renderAlerts();
  push.want='off';
  if(push.ready)finishOff();else loadOS();
}
document.addEventListener('click',e=>{
  if(e.target.closest('#atoggle')){push.tip=!push.tip;renderAlerts()}
  else if(e.target.closest('#aon'))alertsOn();
  else if(e.target.closest('#aoff'))alertsOff();
});
window.OneSignalDeferred=window.OneSignalDeferred||[];
window.OneSignalDeferred.push(async function(OS){
  try{
    await OS.init({appId:OS_APP,serviceWorkerPath:BASE.slice(1)+'OneSignalSDKWorker.js',serviceWorkerParam:{scope:BASE},notifyButton:{enable:false}});
    push.os=OS;push.on=!!OS.User.PushSubscription.optedIn;push.ready=true;
    OS.User.PushSubscription.addEventListener('change',ev=>{push.on=!!(ev&&ev.current&&ev.current.optedIn);setOpted(push.on);renderAlerts()});
    if(push.want==='on')return finishOn();
    if(push.want==='off')return finishOff();
    setOpted(push.on);
  }catch(_){push.ready=false;push.busy=false;push.want='';push.msg='Couldn’t reach the alerts service. Please try again.'}
  renderAlerts();
});
renderAlerts();
render();load();
})();
