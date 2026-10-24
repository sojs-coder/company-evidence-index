// Run report: asks the backend to collect all twelve public sources now and
// renders what came back, with per-item links to the origin. No fixture data.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function itemLine(i){
  const title=i.form?`Form ${i.form} · ${i.description||'filing'} (${i.date})`:(i.title||'(untitled)');
  const meta=i.outlet||(i.rating?i.rating+'/5':(i.points!=null?i.points+' pts':(i.date||'')));
  return `<li><span class="collect-item-title">${i.link?`<a class="detail-source" href="${esc(i.link)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title)}</span>${meta?`<span class="faint">${esc(meta)}</span>`:''}</li>`;
}
async function boot(){
  let r;
  try{r=await fetch('/api/companies/apple/report').then(x=>x.json())}
  catch(e){document.querySelector('#run-sources').innerHTML='<p class="small-note">The run failed to start; nothing is substituted.</p>';return}
  document.querySelector('#run-stamp').textContent=new Date(r.generatedAt).toUTCString().toUpperCase();
  document.querySelector('#run-summary').innerHTML=[
    ['Sources live',`${r.liveCount} / ${r.liveCount+r.downCount}`],
    ['Items collected',r.sources.reduce((n,s)=>n+s.itemCount,0)],
    ['Run window',`${new Date(Math.min(...r.sources.map(s=>+new Date(s.fetchedAt)))).toUTCString().slice(17,25)} - ${new Date(r.generatedAt).toUTCString().slice(17,25)} UTC`]
  ].map(([k,v])=>`<div class="metric"><p class="metric-label">${k}</p><p class="metric-number">${v}</p></div>`).join('');
  document.querySelector('#run-sources').innerHTML=r.sources.map(s=>`<article class="result-block">
    <div class="result-head"><span class="collect-badge ${s.mode==='live'?'live':'down'}">${s.mode==='live'?'LIVE':'UNAVAILABLE'}</span><span class="mono faint">${esc(s.source)} · fetched ${new Date(s.fetchedAt).toUTCString().slice(17,25)} UTC${s.cached?' · cached 10 min':''} · ${s.itemCount} items</span></div>
    <h3 class="result-title">${esc(s.name)}</h3>
    ${s.mode==='live'?`<ul class="collect-list">${s.items.map(itemLine).join('')}</ul>`:`<p class="small-note">Fetch failed${s.detail?`: ${esc(s.detail)}`:''}. No data is substituted.</p>`}
  </article>`).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
