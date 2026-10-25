// Mentions page: deterministic pack counts/provenance per company, then the
// AI claim/counterclaim synthesis as a clearly labeled, separate panel.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));// " intentional
const srclist=s=>`<li><span class="mono">${esc((s.at||'').slice(0,10))}</span><span class="collect-item-title">${esc(s.source)}</span><span class="faint">${esc(String(s.added))} added</span></li>`;
const claimList=(arr,empty)=>arr&&arr.length?arr.map(c=>`<li><span class="collect-item-title">${esc(c.text)}</span><span class="mono faint">${esc(String(c.support??''))} posts</span></li>`).join(''):`<li><span class="faint">${esc(empty)}</span></li>`;
async function boot(){
  const wrap=document.querySelector('#packs-live');
  let packs=[],analysis={};
  try{packs=(await fetch('/api/packs').then(r=>r.json())).packs||[]}catch(e){}
  try{const l=(await fetch('/api/analysis').then(r=>r.json())).analysis||[];
    await Promise.all(l.map(async m=>{try{analysis[m.ticker]=await fetch('/api/analysis/'+encodeURIComponent(m.ticker)).then(r=>r.json())}catch(e){}}));
  }catch(e){}
  packs.sort((a,b)=>b.itemCount-a.itemCount);
  document.querySelector('#packs-count').textContent=`${packs.length} PACKS LIVE`;
  if(!packs.length){wrap.innerHTML='<p class="state-note">No packs collected yet.</p>';return}
  wrap.innerHTML=packs.map(p=>{
    const a=analysis[p.ticker];
    const sources=(p.sources||[]).map(srclist).join('');
    const claimPanel=a?`
      <div class="section-heading"><div><p class="overline">AI SYNTHESIS · OPENAI (THIRD PARTY)</p><h2>Claims &amp; counterclaims</h2></div><span class="badge-dim">${esc(a.model)} · ${esc(String(a.inputItems))}/${esc(String(a.packItems))} posts</span></div>
      <p class="small-note">${esc(a.basis)}</p>
      <p class="overline">CLAIMS</p><ul class="collect-list">${claimList(a.claims,'No claims extracted.')}</ul>
      <p class="overline">COUNTERCLAIMS</p><ul class="collect-list">${claimList(a.counterclaims,'No counterclaims extracted.')}</ul>
      <p class="small-note">Generated ${esc(new Date(a.generatedAt).toUTCString())}. This panel is generated synthesis, not quoted evidence.</p>`
      :`<p class="small-note">AI synthesis not yet generated for this pack. Counts above stand on their own.</p>`;
    return `<article class="collect-card">
      <div class="collect-head"><h2>${esc(p.company||p.ticker)} <span class="mono faint">${esc(p.ticker)}</span></h2><span class="collect-badge live">${esc(String(p.itemCount))} POSTS</span></div>
      <p class="small-note">Collected ${esc(new Date(p.collectedAt).toUTCString())}. Provenance:</p>
      <ul class="collect-list">${sources}</ul>
      ${claimPanel}
    </article>`;
  }).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
