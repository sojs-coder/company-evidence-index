// Mentions page: deterministic pack counts/provenance per company, then the
// AI claim/counterclaim synthesis as a clearly labeled, separate panel.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));// " intentional
const SRC_LABEL={'signalor-historical-export':s=>`Signalor mention archive - historical posts through Oct 20, imported ${esc((s.at||'').slice(0,10))}`,'apify-x':s=>`Fresh X/Twitter collection on ${esc((s.at||'').slice(0,10))}`};
const srclist=s=>{const f=SRC_LABEL[s.source];return `<li><span class="collect-item-title">${f?f(s):esc(s.source)}</span><span class="faint">${esc(String(s.added))} added</span></li>`};
const postLinks=c=>(c.posts||[]).map(p=>`<li><span class="collect-item-title">${p.link?`<a class="detail-source" href="${esc(p.link)}" target="_blank" rel="noreferrer">${esc(p.text.slice(0,140))}${p.text.length>140?'…':''}</a>`:esc(p.text.slice(0,140))}</span></li>`).join('');
const claimList=(arr,empty)=>arr&&arr.length?arr.map(c=>`<li><span class="collect-item-title">${esc(c.text)}</span><span class="mono faint">${esc(String(c.support??''))} cited post${c.support===1?'':'s'}</span></li>${postLinks(c)}`).join(''):`<li><span class="faint">${esc(empty)}</span></li>`;
async function boot(){
  const wrap=document.querySelector('#packs-live');
  let packs=[],analysis={};
  try{packs=(await fetch('/api/packs').then(r=>r.json())).packs||[]}catch(e){}
  try{const l=(await fetch('/api/analysis').then(r=>r.json())).analysis||[];
    await Promise.all(l.map(async m=>{try{analysis[m.ticker]=await fetch('/api/analysis/'+encodeURIComponent(m.ticker)).then(r=>r.json())}catch(e){}}));
  }catch(e){}
  const signals={};
  await Promise.all(packs.map(async p=>{try{const r=await fetch('/api/packs/'+encodeURIComponent(p.ticker)+'/signals');if(r.ok)signals[p.ticker]=await r.json()}catch(e){}}));
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
    const sig=signals[p.ticker];
    const sigCard=sig?(()=>{const c=sig.coverage||{};const st=sig.sentiment||{};const tot=Math.max(1,(st.positive||0)+(st.negative||0)+(st.neutral||0)+(st.mixed||0));
      const bar=(n,cls)=>`<span class="sig-seg ${cls}" style="width:${Math.round(100*(n||0)/tot)}%"></span>`;
      const aspects=(sig.topAspects||[]).slice(0,8).map(a=>`<li><span class="collect-item-title">${esc(a.aspect)}</span><span class="mono faint">${esc(String(a.count))} posts · ${esc(String(a.positive))}+ / ${esc(String(a.negative))}-</span></li>`).join('');
      return `
      <div class="section-heading"><div><p class="overline">FULL-PACK AI SIGNALS · EVERY POST</p><h2>Sentiment &amp; aspects</h2></div><span class="badge-dim">${esc(sig.model)} · ${esc(String(c.analyzed))}/${esc(String(c.collected))} posts</span></div>
      <p class="small-note">${esc(sig.basis)}</p>
      <div class="sig-bar">${bar(st.positive,'pos')}${bar(st.mixed,'mix')}${bar(st.neutral,'neu')}${bar(st.negative,'neg')}</div>
      <p class="mono faint sig-legend">${esc(String(st.positive||0))} positive · ${esc(String(st.mixed||0))} mixed · ${esc(String(st.neutral||0))} neutral · ${esc(String(st.negative||0))} negative · ${esc(String(sig.claimPosts||0))} with a reported claim</p>
      <p class="overline">TOP ASPECTS</p><ul class="collect-list">${aspects||'<li><span class="faint">No aspects extracted.</span></li>'}</ul>
      <p class="small-note">Coverage: ${esc(String(c.analyzed))} unique posts analyzed (deduplicated from ${esc(String(c.collected))} collected; ${esc(String(c.dupes))} duplicates and ${esc(String(c.noText))} without text skipped). Generated ${esc(new Date(sig.generatedAt).toUTCString())}. Model readings of post text, not verified facts.</p>`
    })():(sig===undefined?'':"");
    return `<article class="collect-card">
      <div class="collect-head"><h2>${esc(p.company||p.ticker)} <span class="mono faint">${esc(p.ticker)}</span></h2><span class="collect-badge live">${esc(String(p.itemCount))} POSTS</span></div>
      <p class="small-note">Collected ${esc(new Date(p.collectedAt).toUTCString())}. Provenance:</p>
      <ul class="collect-list">${sources}</ul>
      ${sigCard}
      ${claimPanel}
    </article>`;
  }).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});

async function bootCrs(){
  const wrap=document.querySelector('#crs-live'); if(!wrap) return;
  let d=null; try{d=await fetch('/api/credit/sandbox-demo').then(r=>r.json())}catch(e){}
  if(!d){wrap.innerHTML='<p class="state-note">CRS sandbox status unavailable.</p>';return}
  const score=d.scoreSummary&&d.scoreSummary.score!=null?`<li><span class="collect-item-title">Demo score</span><span class="mono faint">${esc(String(d.scoreSummary.score))} (${esc(d.scoreSummary.model||'model')})</span></li>`:'<li><span class="faint">The sandbox returns section metadata for the demo persona, no score value.</span></li>';
  wrap.innerHTML=`<article class="collect-card">
    <div class="collect-head"><h2>CRS sandbox</h2><span class="collect-badge ${d.ok?'live':'down'}">${d.ok?'REACHABLE':'ERROR'}</span></div>
    <p class="side-copy">${esc(d.label||'')}</p>
    <ul class="collect-list">
      <li><span class="collect-item-title">Response sections</span><span class="mono faint">${esc(String((d.sections||[]).length))}</span></li>
      ${d.billable!=null?`<li><span class="collect-item-title">Billable</span><span class="mono faint">${esc(String(d.billable))}</span></li>`:''}
      ${score}
    </ul></article>`;
}
boot();
bootCrs();
