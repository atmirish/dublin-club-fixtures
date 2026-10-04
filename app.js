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
const state={data:null,fx:[],club:ONLY,sport:'all',grade:'all',err:'',loading:true,showRes:false};

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
  $('#filters').innerHTML=mine.length>1&&(sports.length>1||grades.length>1)?(chip('sport','all','All codes',state.sport==='all')+(sports.length>1?sports.map(s=>chip('sport',s,s,state.sport===s)).join(''):'')+
    (grades.length>1?'<span class="sep"></span>'+chip('grade','all','All ages',state.grade==='all')+grades.map(g=>chip('grade',g,g,state.grade===g)).join(''):'')):'';
  const home=mine.filter(x=>x.hk===club).length;
  $('#summary').innerHTML=club&&mine.length?`<div class="summary"><span class="club">${esc(cname)}</span><span class="nums">${mine.length} game${mine.length===1?'':'s'} · ${home} home · ${mine.length-home} away</span></div>`:'';

  const shown=mine.filter(x=>(state.sport==='all'||x.sport===state.sport)&&(state.grade==='all'||x.grade===state.grade));
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
document.addEventListener('click',e=>{if(e.target.closest('#rtoggle')){state.showRes=!state.showRes;render();return}const b=e.target.closest('[data-sport],[data-grade]');if(!b)return;
  if(b.dataset.sport!==undefined)state.sport=b.dataset.sport;else state.grade=b.dataset.grade;render()});
window.addEventListener('hashchange',render);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.data&&Date.now()-new Date(state.data.updatedAt).getTime()>30*60*1000)load()});
render();load();
})();
