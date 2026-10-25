// Mentions page: deterministic pack counts/provenance per company, then the
// AI claim/counterclaim synthesis as a clearly labeled, separate panel.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));// " intentional
const SRC_LABEL={'signalor-historical-export':s=>`Signalor mention archive - historical posts through Oct 20, imported ${esc((s.at||'').slice(0,10))}`,'apify-x':s=>`Fresh X/Twitter collection on ${esc((s.at||'').slice(0,10))}`};
const srclist=s=>{const f=SRC_LABEL[s.source];return `<li><span class="collect-item-title">${f?f(s):esc(s.source)}</span><span class="faint">${esc(String(s.added))} added</span></li>`};
const q=(t)=>'What evidence supports: \u201c'+t.slice(0,110)+'\u201d?';
const aspectRow=(a)=>`<li><span class="collect-item-title">${esc(a.aspect)}</span><span class="mono faint">${esc(String(a.count))} posts · ${esc(String(a.positive))}+ / ${esc(String(a.negative))}-</span></li>${(a.examples||[]).slice(0,2).map(e=>`<li><span class="collect-item-title">${e.link?`<a class="detail-source" href="${esc(e.link)}" target="_blank" rel="noreferrer">${esc(e.text)}</a>`:esc(e.text)}</span></li>`).join('')}`;
function roleLens(role,sig,a){
  if(!sig)return '';
  const asp=sig.topAspects||[];
  const neg=asp.filter(x=>x.negative>0).sort((x,y)=>y.negative-x.negative);
  const pos=asp.filter(x=>x.positive>0).sort((x,y)=>y.positive-x.positive);
  const claims=(a&&a.claims)||[],counter=(a&&a.counterclaims)||[];
  if(role==='customer')return `<p class="overline">REPORTED PROBLEMS</p><ul class="collect-list">${neg.slice(0,5).map(aspectRow).join('')||'<li><span class="faint">No negative-aspect clusters in the analyzed posts.</span></li>'}</ul>
    <p class="overline">WORTH CHECKING BEFORE YOU BUY</p><ul class="collect-list">${neg.slice(0,3).map(x=>`<li><span class="collect-item-title">${esc(q(x.aspect+' ('+x.negative+' reported posts)'))}</span></li>`).join('')||'<li><span class="faint">Nothing flagged by the analyzed posts.</span></li>'}</ul>`;
  if(role==='vendor')return `<p class="overline">WHAT PEOPLE PRAISE</p><ul class="collect-list">${pos.slice(0,5).map(aspectRow).join('')||'<li><span class="faint">No positive-aspect clusters in the analyzed posts.</span></li>'}</ul>
    <p class="overline">POSSIBLE CONVERSATION OPENINGS</p><ul class="collect-list">${pos.slice(0,3).map(x=>`<li><span class="collect-item-title">People are talking about ${esc(x.aspect)} (${esc(String(x.positive))} positive of ${esc(String(x.count))} posts) - a topic, not a qualified lead.</span></li>`).join('')||'<li><span class="faint">No opening topics in the analyzed posts.</span></li>'}</ul>`;
  if(role==='investor')return `<p class="overline">DILIGENCE LEADS (REPORTED, NOT VERIFIED)</p><ul class="collect-list">${claims.slice(0,4).map(c=>`<li><span class="collect-item-title">${esc(q(c.text))}</span><span class="mono faint">${esc(String(c.support??''))} cited posts</span></li>`).join('')||'<li><span class="faint">No claims extracted yet.</span></li>'}</ul>
    <p class="overline">CHALLENGES TO THE STORY</p><ul class="collect-list">${counter.slice(0,4).map(c=>`<li><span class="collect-item-title">${esc(c.text)}</span><span class="mono faint">${esc(String(c.support??''))} cited posts</span></li>${postLinks(c)}`).join('')||'<li><span class="faint">No counterclaims extracted yet.</span></li>'}</ul>
    ${neg.length?`<p class="overline">NEGATIVE CLUSTERS</p><ul class="collect-list">${neg.slice(0,4).map(aspectRow).join('')}</ul>`:''}`;
  return '';
}
const postLinks=c=>(c.posts||[]).map(p=>`<li><span class="collect-item-title">${p.link?`<a class="detail-source" href="${esc(p.link)}" target="_blank" rel="noreferrer">${esc(p.text.slice(0,140))}${p.text.length>140?'…':''}</a>`:esc(p.text.slice(0,140))}</span></li>`).join('');
const claimList=(arr,empty)=>arr&&arr.length?arr.map(c=>`<li><span class="collect-item-title">${esc(c.text)}</span><span class="mono faint">${esc(String(c.support??''))} cited post${c.support===1?'':'s'}</span></li>${postLinks(c)}`).join(''):`<li><span class="faint">${esc(empty)}</span></li>`;
const number=n=>Number(n||0).toLocaleString('en-US');
let selectedTicker='';
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
  document.querySelector('#packs-count').textContent=`${packs.length} company packs · ${number(packs.reduce((n,p)=>n+p.itemCount,0))} collected posts`;
  wrap.setAttribute('aria-busy','false');
  if(!packs.length){wrap.innerHTML='<p class="state-note">No mention packs available. The collection may be empty or unavailable. Reload to try again.</p>';return}
  if(!packs.some(p=>p.ticker===selectedTicker))selectedTicker=packs[0].ticker;
  const selector=`<aside class="company-selector"><div class="selector-heading"><p class="overline">COMPANY INDEX</p><span class="mono faint">${String(packs.length).padStart(2,'0')}</span></div><div class="company-options" role="group" aria-label="Select a company">${packs.map(p=>`<button type="button" class="company-option" data-ticker="${esc(p.ticker)}" aria-pressed="${p.ticker===selectedTicker}"><span class="option-ticker">${esc(p.ticker)}</span><span class="option-name">${esc(p.company||p.ticker)}</span><span class="option-count">${number(p.itemCount)} collected <span aria-hidden="true">↗</span></span></button>`).join('')}</div><p class="small-note">One evidence base.<br>Different decision lenses.</p></aside>`;
  wrap.innerHTML=selector+`<div class="company-details">`+packs.map((p,index)=>{
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
      <div class="sig-bar" role="img" aria-label="${esc(String(st.positive||0))} positive, ${esc(String(st.mixed||0))} mixed, ${esc(String(st.neutral||0))} neutral, ${esc(String(st.negative||0))} negative posts">${bar(st.positive,'pos')}${bar(st.mixed,'mix')}${bar(st.neutral,'neu')}${bar(st.negative,'neg')}</div>
      <p class="mono faint sig-legend">${esc(String(st.positive||0))} positive · ${esc(String(st.mixed||0))} mixed · ${esc(String(st.neutral||0))} neutral · ${esc(String(st.negative||0))} negative · ${esc(String(sig.claimPosts||0))} with a reported claim</p>
      <p class="overline">TOP ASPECTS</p><ul class="collect-list">${aspects||'<li><span class="faint">No aspects extracted.</span></li>'}</ul>
      <p class="small-note">Coverage: ${esc(String(c.analyzed))} unique posts analyzed (deduplicated from ${esc(String(c.collected))} collected; ${esc(String(c.dupes))} duplicates and ${esc(String(c.noText))} without text skipped). Generated ${esc(new Date(sig.generatedAt).toUTCString())}. Model readings of post text, not verified facts.</p>`
    })():`<p class="state-note">Sentiment analysis is not available for this pack. Collected posts are not counted as analyzed.</p>`;
    const coverage=sig?.coverage;
    return `<article class="company-detail" data-company="${esc(p.ticker)}"${p.ticker!==selectedTicker?' hidden':''}>
      <header class="company-masthead"><p class="overline">COMPANY SIGNAL / ${String(index+1).padStart(2,'0')}</p><h2>${esc(p.company||p.ticker)} <em>${esc(p.ticker)}</em></h2><p class="small-note">Collected ${esc(new Date(p.collectedAt).toUTCString())}</p></header>
      <nav class="detail-nav" aria-label="${esc(p.ticker)} sections"><a href="#signal-${index}">Signal</a><a href="#claims-${index}">Claims &amp; counterclaims</a><a href="#sources-${index}">Sources &amp; coverage</a></nav>
      <section id="signal-${index}" class="detail-section"><p class="overline">THE COLLECTED PICTURE</p><h3 class="position-heading">Current position</h3>
      <div class="mention-metrics"><div><strong>${number(p.itemCount)}</strong><span>Collected posts</span></div><div><strong>${coverage?number(coverage.analyzed):'—'}</strong><span>Analyzed posts</span></div><div><strong>${number((p.sources||[]).length)}</strong><span>Collection sources</span></div><div><strong>${sig?number((sig.topAspects||[]).length):'—'}</strong><span>Reported aspects</span></div></div>
      ${roleLens(window.CEI_ROLE?window.CEI_ROLE.get():'',sig,a)}
      ${sigCard}</section>
      <section id="claims-${index}" class="detail-section">${claimPanel}</section>
      <section id="sources-${index}" class="detail-section"><p class="overline">PROVENANCE</p><h3 class="position-heading">Sources &amp; coverage</h3><ul class="collect-list">${sources}</ul><p class="small-note">Counts reflect this collection only. Historical imports and fresh collections have different date ranges. Missing evidence is not evidence of absence.</p></section>
    </article>`;
  }).join('')+'</div>';
  wrap.querySelectorAll('.company-option').forEach(button=>button.addEventListener('click',()=>{
    selectedTicker=button.dataset.ticker;
    wrap.querySelectorAll('.company-option').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    wrap.querySelectorAll('.company-detail').forEach(panel=>panel.hidden=panel.dataset.company!==selectedTicker);
  }));
}
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
document.addEventListener('cei-role',boot);
