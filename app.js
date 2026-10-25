// Frontend for the Company Evidence Index demo. All data comes from the
// backend API (server.mjs + data/seed.json) - the server is the single
// source of truth. Demo fixtures only; no live sources connected.
let claims=[], sources=[], changes=[], overview=null;

const list=document.querySelector('#claim-list'),dialog=document.querySelector('#claim-dialog');
const ICON_LINK='<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M5.5 4H12v6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const ICON_REFRESH='<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7M13.2 2.2v3h-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const STATUSES=['supported','unresolved','contradicted'];

async function boot(){
  try{
    const [ov,cl,cov,chg]=await Promise.all([
      fetch('/api/companies/apple/overview').then(r=>r.json()),
      fetch('/api/companies/apple/claims').then(r=>r.json()),
      fetch('/api/companies/apple/coverage').then(r=>r.json()),
      fetch('/api/companies/apple/changes').then(r=>r.json())
    ]);
    overview=ov; claims=cl.claims; sources=cov.sources; changes=chg.changes;
  }catch(e){
    list.innerHTML='<p class="small-note">The demo API is unavailable, so no data is shown. No cached figures are substituted.</p>';
    return;
  }
  renderMetrics(); renderClaims(); renderStatusBar(); renderSourceBars(); renderCoverage(); renderChanges();
}
function renderMetrics(){
  const m=overview.metrics;
  document.querySelector('#m-claims').textContent=m.claimsIndexed;
  document.querySelector('#m-claims-note').textContent=`across ${m.sourceClasses} source classes`;
  document.querySelector('#m-contradicted').textContent=m.contradicted;
  document.querySelector('#m-sources').innerHTML=`${m.sourcesChecked} <small>/ ${m.sourcesTotal}</small>`;
  document.querySelector('#m-sources-note').textContent=`${m.sourcesTotal-m.sourcesChecked} explicit coverage gaps`;
}

// --- Ledger ---
function renderClaims(){const q=document.querySelector('#claim-search').value.toLowerCase(),s=document.querySelector('#status-filter').value;const rows=claims.filter(c=>(s==='all'||c.status===s)&&`${c.claim} ${c.source} ${c.attribution}`.toLowerCase().includes(q));list.innerHTML=rows.map(c=>`<article class="claim-row" tabindex="0" role="button" data-id="${c.id}"><div><p class="claim-title">${c.claim}</p><span class="claim-attribution">${c.attribution} <span class="mono">· ${c.id}</span></span></div><div><div class="claim-source">${c.source}</div><div class="claim-date">${c.date}</div></div><span class="status ${c.status}">${c.status}</span></article>`).join('')||'<p class="small-note">No claims match these filters.</p>';document.querySelector('#visible-count').textContent=rows.length;list.querySelectorAll('.claim-row').forEach(row=>{row.addEventListener('click',()=>openClaim(row.dataset.id));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openClaim(row.dataset.id)}})})}
function openClaim(id){const c=claims.find(x=>x.id===id);document.querySelector('#dialog-eyebrow').textContent=`${c.id} · ${c.status.toUpperCase()}`;document.querySelector('#dialog-title').textContent=c.claim;document.querySelector('#dialog-body').innerHTML=`<p class="detail-meta">${c.attribution} · ${c.date}</p><div class="detail-block"><h3>EVIDENCE FOR</h3><p>${c.for}</p></div><div class="detail-block"><h3>EVIDENCE AGAINST / LIMITS</h3><p>${c.against}</p></div><div class="detail-block"><h3>SOURCE CITATION</h3><p><a class="detail-source" href="${c.citation}" target="_blank" rel="noreferrer">${c.source} ${ICON_LINK}</a></p></div>`;dialog.showModal()}
document.querySelector('#claim-search').addEventListener('input',renderClaims);
document.querySelector('#status-filter').addEventListener('change',renderClaims);

// --- Status composition bar (parts of a whole; segments act as filters) ---
function renderStatusBar(){const bar=document.querySelector('#status-bar');const counts=STATUSES.map(s=>({s,n:claims.filter(c=>c.status===s).length}));bar.innerHTML=counts.map(({s,n})=>`<button type="button" class="seg ${s} u${n}" data-status="${s}" aria-label="Show ${n} ${s} claims"><span class="chart-tip" role="tooltip">${n} ${s}</span></button>`).join('');bar.querySelectorAll('.seg').forEach(seg=>seg.addEventListener('click',()=>{const f=document.querySelector('#status-filter');f.value=f.value===seg.dataset.status?'all':seg.dataset.status;renderClaims();markActiveSeg()}));markActiveSeg()}
function markActiveSeg(){const v=document.querySelector('#status-filter').value;document.querySelectorAll('#status-bar .seg').forEach(s=>s.classList.toggle('active',s.dataset.status===v))}

// --- Claims by source class (magnitude) ---
function renderSourceBars(){const wrap=document.querySelector('#source-bars');const groups={};claims.forEach(c=>groups[c.source]=(groups[c.source]||0)+1);const rows=Object.entries(groups).sort((a,b)=>b[1]-a[1]);const max=Math.max(...rows.map(r=>r[1]));wrap.innerHTML=rows.map(([name,n])=>`<div class="hbar-row"><span class="hbar-label">${name}</span><svg class="hbar" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${n} claims"><rect x="0" y="3" width="${(n/max*100).toFixed(1)}" height="4"><title>${n} claims from ${name}</title></rect></svg><span class="hbar-count mono">${n}</span></div>`).join('')}

// --- Coverage strip (per-source state) + source list ---
function renderCoverage(){const strip=document.querySelector('#coverage-strip');strip.innerHTML=sources.map(s=>`<span class="cov-seg ${s.state}" tabindex="0" aria-label="${s.name}: ${s.note}"><span class="chart-tip" role="tooltip">${s.name} · ${s.note}</span></span>`).join('');document.querySelector('#source-list').innerHTML=sources.map(s=>`<li><span class="source-dot ${s.state==='gap'?'gap':''}"></span><span>${s.name}</span><span class="source-status">${s.note}</span></li>`).join('')}

// --- Snapshot change timeline + rows ---
function renderChanges(){const line=document.querySelector('#change-timeline');line.innerHTML=[...changes].reverse().map(c=>`<span class="tl-dot ${c.type}" tabindex="0" aria-label="${c.date}: ${c.label} - ${c.copy}"><span class="chart-tip" role="tooltip">${c.date} · ${c.label}</span></span>`).join('');document.querySelector('#change-rows').innerHTML=changes.map(c=>`<div class="change-row"><span class="change-date mono">${c.date}</span><span class="change-type ${c.type}">${c.label}</span><span class="change-copy">${c.copy}</span><span class="change-source">${c.source}</span><span class="change-arrow">${ICON_LINK}</span></div>`).join('')}

document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{const v=el.dataset.view;document.querySelectorAll('.nav-link').forEach(n=>n.classList.toggle('active',n.dataset.view===v));if(v==='ledger')document.querySelector('#ledger-section').scrollIntoView({behavior:'smooth'});else if(v==='coverage')document.querySelector('.coverage-summary').scrollIntoView({behavior:'smooth'});else if(v==='sentiment')document.querySelector('.sentiment-summary').scrollIntoView({behavior:'smooth'});else if(v==='changes')document.querySelector('#changes-section').scrollIntoView({behavior:'smooth'});else window.scrollTo({top:0,behavior:'smooth'})}));
// Refresh calls the real API. The admin gate is intentionally unprovisioned
// for this demo (no OTP provider/broker approved), so the honest 503 is shown.
document.querySelector('.refresh-button').addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Refreshing...';try{const r=await fetch('/api/companies/apple/refresh',{method:'POST'});const d=await r.json();document.querySelector('.snapshot-banner p').innerHTML=r.ok?'<strong>Snapshot refreshed.</strong> No new changes were found.':`<strong>Refresh unavailable in this demo.</strong> ${d.detail||'The admin gate is not provisioned.'}`;document.querySelector('.snapshot-banner .overline').innerHTML=`REFRESH ATTEMPT <span class="mono">· ${r.status}</span>`}catch{document.querySelector('.snapshot-banner p').textContent='Refresh failed: the demo API is unreachable.'}setTimeout(()=>{b.disabled=false;b.innerHTML=ICON_REFRESH+' Refresh snapshot'},700)});
boot();
