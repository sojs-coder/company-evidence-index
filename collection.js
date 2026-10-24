// Collection page: live panels fetch real public data through the backend
// collectors; the rest of the fixed source set renders from the API with
// honest not-live states. Nothing here blends live and fixture data.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LIVE=[
 {key:'edgar',name:'SEC EDGAR filings',what:'Latest filings for CIK 0000320193 from the SEC submissions API.',render:items=>items.map(i=>`<li><span class="mono">${esc(i.date)}</span><span class="collect-item-title">Form ${esc(i.form)} · ${esc(i.description||'filing')}</span><span class="mono faint">${esc(i.accession)}</span></li>`).join('')},
 {key:'newsroom',name:'Apple Newsroom',what:'Latest releases from the official Apple Newsroom Atom feed.',render:items=>items.map(i=>`<li><span class="mono">${esc((i.date||'').slice(0,10))}</span><span class="collect-item-title">${i.link?`<a class="detail-source" href="${esc(i.link)}" target="_blank" rel="noreferrer">${esc(i.title)}</a>`:esc(i.title)}</span></li>`).join('')},
 {key:'news',name:'Google News RSS',what:'Top current headlines matching Apple Inc from Google News.',render:items=>items.map(i=>`<li><span class="mono">${esc((i.date||'').slice(5,16))}</span><span class="collect-item-title">${esc(i.title)}</span><span class="faint">${esc(i.outlet)}</span></li>`).join('')}
];
const REST={sources:[
 {name:'Apple investor relations',note:'Checked in the demo snapshot; no live panel in this build.'},
 {name:'Apple support pages',note:'Checked in the demo snapshot; no live panel in this build.'},
 {name:'Employee posts',note:'Manual only - never auto-collected.'},
 {name:'X public posts',note:'Not connected.'}
]};
function card(inner,cls){return `<article class="collect-card ${cls||''}">${inner}</article>`}
async function boot(){
  const wrap=document.querySelector('#collect-live');
  const results=await Promise.all(LIVE.map(async l=>{
    try{return{...l,data:await fetch(`/api/companies/apple/collect/${l.key}`).then(r=>r.json())}}
    catch(e){return{...l,data:{mode:'unavailable',detail:String(e),items:[]}}}
  }));
  wrap.innerHTML=results.map(({name,what,render,data})=>card(`
    <div class="collect-head"><h2>${name}</h2><span class="collect-badge ${data.mode==='live'?'live':'down'}">${data.mode==='live'?'LIVE':'UNAVAILABLE'}</span></div>
    <p class="side-copy">${what}</p>
    ${data.mode==='live'?`<p class="small-note">Fetched ${new Date(data.fetchedAt).toUTCString().slice(17,25)} UTC from ${esc(data.source)}${data.cached?' (cached 10 min)':''}.</p><ul class="collect-list">${render(data.items)}</ul>`
      :`<p class="small-note">Live fetch failed${data.detail?`: ${esc(data.detail)}`:''}. No data is substituted.</p>`}
    <p class="collect-feeds">Feeds the coverage panel and claim evidence chains on the <a class="detail-source" href="/">company ledger</a>.</p>`)).join('');
  document.querySelector('#collect-rest').innerHTML=REST.sources.map(s=>card(`
    <div class="collect-head"><h2>${s.name}</h2><span class="collect-badge demo">NOT LIVE</span></div>
    <p class="side-copy">${s.note}</p>`,'muted')).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
