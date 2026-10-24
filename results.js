// Results summary: pulls the demo snapshot from the API and shows what it
// surfaced - contradictions with evidence chains, open items with reasons,
// and named coverage gaps. Understated by design: the findings carry it.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function claimBlock(c){return `<article class="result-block"><div class="result-head"><span class="status ${c.status}">${c.status}</span><span class="mono faint">${esc(c.id)} · ${esc(c.source)} · ${esc(c.date)}</span></div><h3 class="result-title">${esc(c.claim)}</h3><div class="detail-block"><h3>EVIDENCE FOR</h3><p>${esc(c.for)}</p></div><div class="detail-block"><h3>EVIDENCE AGAINST / LIMITS</h3><p>${esc(c.against)}</p></div><a class="detail-source" href="${esc(c.citation)}" target="_blank" rel="noreferrer">${esc(c.source)} citation <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M5.5 4H12v6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a></article>`}
function obsBlock(head,lines,stamp){return `<article class="result-block"><div class="result-head"><span class="collect-badge live">LIVE</span><span class="mono faint">${esc(head)}</span></div><h3 class="result-title">${esc(lines[0]||'')}</h3>${lines.slice(1).map(l=>`<p class="side-copy">${esc(l)}</p>`).join('')}<p class="small-note">Fetched ${esc(stamp)}.</p></article>`}
async function liveObs(){
  const feeds=[['SEC EDGAR filings (CIK 0000320193)','edgar',d=>d.items.slice(0,2).map(i=>`${i.form} filed ${i.date} (${i.description})`)],['Apple Newsroom','newsroom',d=>d.items.slice(0,2).map(i=>`${i.title} (${i.date})`)],['Google News RSS','news',d=>d.items.slice(0,2).map(i=>`${i.title} - ${i.source}, ${i.date}`)]];
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
  document.querySelector('#results-contradicted').innerHTML=byStatus('contradicted').map(claimBlock).join('');
  document.querySelector('#results-unresolved').innerHTML=byStatus('unresolved').map(claimBlock).join('');
  document.querySelector('#results-gaps').innerHTML=cov.sources.filter(s=>s.state!=='checked').map(s=>`<article class="result-block"><div class="result-head"><span class="source-dot gap"></span><span class="mono faint">${esc(s.note)}</span></div><h3 class="result-title">${esc(s.name)}</h3><p class="side-copy">Not collected for this snapshot; related claims stay marked accordingly.</p></article>`).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
