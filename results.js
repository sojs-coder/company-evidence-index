// Results summary: pulls the demo snapshot from the API and shows what it
// surfaced - contradictions with evidence chains, open items with reasons,
// and named coverage gaps. Understated by design: the findings carry it.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function claimTable(claims,label){
  if(!claims.length)return '<p class="small-note">No claims in this category for this snapshot.</p>';
  return `<table class="results-table"><caption>${esc(label)}</caption><colgroup><col class="result-status-col"><col class="result-claim-col"><col class="result-evidence-col"><col class="result-evidence-col"><col class="result-source-col"></colgroup><thead><tr><th scope="col">Status</th><th scope="col">Claim</th><th scope="col">Evidence for</th><th scope="col">Evidence against / limits</th><th scope="col">Source / date</th></tr></thead><tbody>${claims.map(c=>`<tr><td><span class="status ${esc(c.status)}">${esc(c.status)}</span></td><th scope="row"><span class="result-claim-title">${esc(c.claim)}</span><span class="result-claim-id">${esc(c.id)}</span></th><td>${esc(c.for)}</td><td>${esc(c.against)}</td><td><a class="detail-source" href="${esc(c.citation)}" target="_blank" rel="noreferrer">${esc(c.source)}<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M5.5 4H12v6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a><span class="result-claim-date">${esc(c.date)}</span></td></tr>`).join('')}</tbody></table>`;
}
function obsBlock(head,lines,stamp){return `<article class="result-block"><div class="result-head"><span class="collect-badge live">LIVE</span><span class="mono faint">${esc(head)}</span></div><h3 class="result-title">${esc(lines[0]||'')}</h3>${lines.slice(1).map(l=>`<p class="side-copy">${esc(l)}</p>`).join('')}<p class="small-note">Fetched ${esc(stamp)}.</p></article>`}
async function liveObs(){
  const feeds=[['SEC EDGAR filings (CIK 0000320193)','edgar',d=>d.items.slice(0,2).map(i=>`Form ${i.form} filed ${i.date}`)],['Apple Newsroom','newsroom',d=>d.items.slice(0,2).map(i=>`${i.title} (${i.date})`)],['Google News RSS','news',d=>d.items.slice(0,2).map(i=>`${i.title} - ${i.source}, ${i.date}`)]];
  const out=await Promise.all(feeds.map(async([name,path,mk])=>{try{const d=await fetch('/api/companies/apple/collect/'+path).then(r=>r.json());return d.mode==='live'?obsBlock(name,mk(d),new Date(d.fetchedAt).toUTCString()):''}catch(e){return''}}));
  const html=out.filter(Boolean).join('');
  document.querySelector('#results-live').innerHTML=html||'<p class="small-note">Live sources are unreachable right now; nothing is substituted.</p>';
}
async function boot(){
  liveObs();
  let claims,cov;
  try{[claims,cov]=await Promise.all([fetch('/api/companies/apple/claims').then(r=>r.json()),fetch('/api/companies/apple/coverage').then(r=>r.json())])}
  catch(e){document.querySelector('#results-contradicted').innerHTML='<p class="small-note">The demo API is unavailable, so no results are shown. No cached figures are substituted.</p>';return}
  const byStatus=s=>claims.claims.filter(c=>c.status===s);
  document.querySelector('#results-contradicted').innerHTML=claimTable(byStatus('contradicted'),'Contradicted claims and supporting evidence');
  document.querySelector('#results-unresolved').innerHTML=claimTable(byStatus('unresolved'),'Unresolved claims and evidence limits');
  document.querySelector('#results-gaps').innerHTML=cov.sources.filter(s=>s.state!=='checked').map(s=>`<article class="result-block"><div class="result-head"><span class="source-dot gap"></span><span class="mono faint">${esc(s.note)}</span></div><h3 class="result-title">${esc(s.name)}</h3><p class="side-copy">Not collected for this snapshot; related claims stay marked accordingly.</p></article>`).join('');
}
boot();
