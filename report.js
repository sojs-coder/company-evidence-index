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
  try{r=await fetch('/api/companies/apple/analysis').then(x=>x.json())}
  catch(e){document.querySelector('#run-sources').innerHTML='<p class="small-note">The run failed to start; nothing is substituted.</p>';return}
  document.querySelector('#run-stamp').textContent=new Date(r.generatedAt).toUTCString().toUpperCase();
  document.querySelector('#run-summary').innerHTML=[
    ['Sources live',`${r.liveCount} / ${r.liveCount+r.downCount}`],
    ['Items collected',r.sources.reduce((n,s)=>n+s.itemCount,0)],
    ['Run window',`${new Date(Math.min(...r.sources.map(s=>+new Date(s.fetchedAt)))).toUTCString().slice(17,25)} - ${new Date(r.generatedAt).toUTCString().slice(17,25)} UTC`]
  ].map(([k,v])=>`<div class="metric"><p class="metric-label">${k}</p><p class="metric-number">${v}</p></div>`).join('');
  const a=r.analysis;
  const maxC=Math.max(1,...a.perSource.map(p=>p.collected));
  document.querySelector('#run-graph').innerHTML='<div class="util-legend"><span><i class="util-sw collected"></i>Collected this run</span><span><i class="util-sw feeding"></i>Overlapping ledger claims</span></div>'+a.perSource.map((p,idx)=>`<div class="util-row" data-idx="${idx}" role="button" tabindex="0" aria-expanded="false"><span class="util-name">${esc(p.name)}</span><span class="util-bars"><span class="util-bar collected" style="width:${Math.round(p.collected/maxC*100)}%"></span>${p.feedingFindings?`<span class="util-bar feeding" style="width:${Math.round(p.feedingFindings/maxC*100)}%"></span>`:''}</span><span class="util-nums"><b>${p.collected}</b> collected · <b>${p.feedingFindings}</b> overlap${p.mode!=='live'?' · unavailable':''}</span></div><div class="util-detail" id="util-detail-${idx}" hidden><ul class="collect-list">${p.items.map(it=>`<li><span class="mono faint">${esc((it.date||'').slice(0,10))}</span><span class="collect-item-title">${it.link?`<a class="detail-source" href="${esc(it.link)}" target="_blank" rel="noreferrer">${esc(it.title)}</a>`:esc(it.title)}</span><span class="faint">${it.feeds.length?'overlaps '+it.feeds.map(esc).join(', '):'no claim overlap'}</span></li>`).join('')}</ul></div>`).join('')+`<p class="small-note" style="margin-top:10px">${a.totalCollected} items collected this run; ${a.totalFeeding} overlap at least one ledger claim. Select a source to see every item.</p>`;
  document.querySelectorAll('.util-row').forEach(row=>{const open=()=>{const d=document.getElementById('util-detail-'+row.dataset.idx);const show=d.hidden;d.hidden=!show;row.setAttribute('aria-expanded',String(show))};row.addEventListener('click',open);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}})});
  if(r.history&&r.history.length){const p=r.persistence||{};document.querySelector('#run-history').textContent=`${r.history.length} run${r.history.length===1?'':'s'} recorded - ${p.uniqueItems||0} unique items across runs, ${p.newThisRun||0} new this run (dedup by source+link). ${esc(r.historyNote||'')}`;}
  const withMatches=a.claims.filter(c=>c.candidateMatches.length);
  document.querySelector('#run-claims').innerHTML=withMatches.length?withMatches.map(c=>`<article class="result-block"><div class="result-head"><span class="status ${c.snapshotStatus}">${c.snapshotStatus}</span><span class="mono faint">${esc(c.id)} · SNAPSHOT STATUS IS A DEMO FIXTURE</span></div><h3 class="result-title">${esc(c.claim)}</h3><ul class="collect-list">${c.candidateMatches.map(m=>`<li><span class="mono faint">${esc(m.source)}</span><span class="collect-item-title">${m.link?`<a class="detail-source" href="${esc(m.link)}" target="_blank" rel="noreferrer">${esc(m.title)}</a>`:esc(m.title)}</span><span class="faint">shared: ${esc(m.shared.join(', '))}</span></li>`).join('')}</ul></article>`).join(''):'<p class="small-note">No collected items overlapped ledger claims in this run.</p>';
  document.querySelector('#run-sources').innerHTML=r.sources.map(s=>`<article class="result-block">
    <div class="result-head"><span class="collect-badge ${s.mode==='live'?'live':'down'}">${s.mode==='live'?'LIVE':'UNAVAILABLE'}</span><span class="mono faint">${esc(s.source)} · fetched ${new Date(s.fetchedAt).toUTCString().slice(17,25)} UTC${s.cached?' · cached 10 min':''} · ${s.itemCount} items</span></div>
    <h3 class="result-title">${esc(s.name)}</h3>
    ${s.mode==='live'?`<ul class="collect-list">${s.items.map(itemLine).join('')}</ul>`:`<p class="small-note">Fetch failed${s.detail?`: ${esc(s.detail)}`:''}. No data is substituted.</p>`}
  </article>`).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
