// Company report dashboard: dense metrics, evidence stream, per-source
// volume with drilldown, demo-ledger candidate matches. Live data only;
// the claim ledger stays labeled as demo fixtures.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function itemLine(i){
  const title=i.form?('Form '+i.form+(i.description?' · '+i.description:'')):(i.title||'(untitled)');
  const meta=i.outlet||(i.rating?i.rating+'/5':(i.points!=null?i.points+' pts':(i.date||'')));
  return `<li><span class="collect-item-title">${i.link?`<a class="detail-source" href="${esc(i.link)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title)}</span>${meta?`<span class="faint">${esc(meta)}</span>`:''}</li>`;
}
async function boot(){
  let r;
  try{r=await fetch('/api/companies/apple/analysis').then(x=>x.json())}
  catch(e){document.querySelector('#evidence-stream').innerHTML='<li class="faint">The run failed to start; nothing is substituted.</li>';return}
  document.querySelector('#run-stamp').textContent=new Date(r.generatedAt).toUTCString().slice(5,25).toUpperCase()+' UTC';
  const total=r.sources.reduce((n,s)=>n+s.itemCount,0);
  const p=r.persistence||{};
  const cached=r.sources.filter(s=>s.cached).length;
  document.querySelector('#run-badges').innerHTML=[
    `<span class="badge-live">LIVE RUN</span>`,
    cached?`<span class="badge-dim">${cached} SOURCES CACHED &lt;10M</span>`:''
  ].join('');
  document.querySelector('#run-summary').innerHTML=[
    ['Items this run',total.toLocaleString('en-US'),(r.relevantTotal||total).toLocaleString('en-US')+' Apple-relevant'],
    ['Records on file',(p.uniqueItems||total).toLocaleString('en-US'),'deduplicated within each source'],
    ['New this run',(p.newThisRun!=null?p.newThisRun:0).toLocaleString('en-US'),(p.seenBeforeThisRun||0).toLocaleString('en-US')+' repeat sightings this run'],
    ['Runs recorded',(p.runs||1),r.storeMode==='attached-volume'?'attached volume, survives redeploys':'on-disk store, resets on redeploy']
  ].map(([k,v,n])=>`<div class="metric"><p class="metric-label">${k}</p><p class="metric-number">${v}</p><p class="metric-note">${n}</p></div>`).join('');
  const TYPE={edgar:'Filings',newsroom:'Press',news:'Press',macrumors:'Press',ninetofive:'Press',verge:'Press',hackernews:'Forum stories',hncomments:'Comments',reviews:'Reviews',mastodon:'Social posts',lemmy:'Forum posts',itunes:'App metadata',pageviews:'Time series',xbrl:'Time series',wikipedia:'Reference'};
  const byType={};for(const s of r.sources){const t=TYPE[s.key]||'Other';byType[t]=(byType[t]||0)+(s.relevantCount!=null?s.relevantCount:s.itemCount)}
  document.querySelector('#run-summary').insertAdjacentHTML('afterend',`<p class="type-strip">${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span><b>${v.toLocaleString('en-US')}</b> ${k}</span>`).join('')}</p>`);
  // Evidence stream: latest items across all live sources, dense.
  const stream=[];
  for(const s of r.sources)for(const it of (s.relevantItems||s.allItems||s.items))stream.push({src:s.name,title:it.form?('Form '+it.form+(it.description?' · '+it.description:'')):(it.title||''),link:it.link||'',date:it.date||''});
  stream.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
  document.querySelector('#evidence-stream').innerHTML=stream.slice(0,40).map(it=>`<li><span class="stream-src">${esc(it.src)}</span><span class="collect-item-title">${it.link?`<a class="detail-source" href="${esc(it.link)}" target="_blank" rel="noreferrer">${esc(it.title)}</a>`:esc(it.title)}</span><span class="mono faint">${esc(Date.parse(it.date)?new Date(Date.parse(it.date)).toISOString().slice(0,10):(it.date||'').slice(0,10))}</span></li>`).join('');
  if(window.matchMedia&&matchMedia('(max-width:760px)').matches){document.querySelector('#evidence-stream').addEventListener('click',e=>{const t=e.target.closest('.collect-item-title');if(!t||t.classList.contains('expanded'))return;e.preventDefault();t.classList.add('expanded')})}
  const a=r.analysis;
  const srcRel=Object.fromEntries(r.sources.map(s=>[s.key,s.relevantCount]));const maxC=Math.max(1,...a.perSource.map(q=>q.collected));
  const graphRows=a.perSource.map(q=>({...q,relevantCount:srcRel[q.key]}));document.querySelector('#run-graph').innerHTML='<div class="util-legend"><span><i class="util-sw collected"></i>Collected this run</span></div>'+graphRows.map((q,idx)=>`<div class="util-row" data-idx="${idx}" role="button" tabindex="0" aria-expanded="false"><span class="util-name">${esc(q.name)}</span><span class="util-bars"><span class="util-bar collected" style="width:${Math.round(q.collected/maxC*100)}%"></span></span><span class="util-nums"><b>${q.collected.toLocaleString('en-US')}</b>${q.relevantCount!=null&&q.relevantCount!==q.collected?` · ${q.relevantCount.toLocaleString('en-US')} Apple-relevant`:''}${q.mode!=='live'?' · unavailable':''}</span></div><div class="util-detail" id="util-detail-${idx}" hidden><ul class="collect-list">${(r.sources.find(s=>s.key===q.key).relevantItems||q.items).slice(0,100).map(it=>`<li><span class="mono faint">${esc((it.date||'').slice(0,10))}</span><span class="collect-item-title">${it.link?`<a class="detail-source" href="${esc(it.link)}" target="_blank" rel="noreferrer">${esc(it.title)}</a>`:esc(it.title)}</span>${it.relevance?`<span class="rel-note">${esc(it.relevance)}</span>`:''}</li>`).join('')}${(r.sources.find(s=>s.key===q.key).relevantItems||q.items).length>100?`<li class="faint">+${((r.sources.find(s=>s.key===q.key).relevantItems||q.items).length-100).toLocaleString('en-US')} more from this source</li>`:''}</ul></div>`).join('');
  document.querySelectorAll('.util-row').forEach(row=>{const open=()=>{const d=document.getElementById('util-detail-'+row.dataset.idx);const show=d.hidden;d.hidden=!show;row.setAttribute('aria-expanded',String(show))};row.addEventListener('click',open);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}})});
  if(r.history&&r.history.length)document.querySelector('#run-history').textContent=`${r.history.length} runs on record · ${(p.uniqueItems||0).toLocaleString('en-US')} unique items · ${r.storeMode==='attached-volume'?'store on attached volume, survives redeploys':'store resets on redeploy'}`;
  if(r.validation){
    const badge={'cited-in-press':'FIGURE STRING IN COLLECTED ITEMS','no-press-citation-in-run':'NOT FOUND IN COLLECTED ITEMS','related-separate-wording':'RELATED - DISTINCT WORDING','separate-wording-coverage':'RELATED - DISTINCT WORDING','echoed-only':'SIMILAR WORDING (ECHO)','no-outside-coverage-in-run':'NONE IN COLLECTED ITEMS','possible-tension-review':'REVIEW - POSSIBLE TENSION','different-figure-found':'REVIEW - DIFFERENT FIGURE'};
    const pass=p=>`<li><a class="detail-source" href="${esc(p.link)}" target="_blank" rel="noreferrer">${esc(p.title)}</a><span class="faint">${esc(p.source)} · ${esc(p.date)}${p.wording?' · '+p.wording+' wording':''}${p.tension?' · possible tension':''}</span>${p.excerpt?`<span class="rel-note">"...${esc(p.excerpt)}..."</span>`:''}</li>`;
    const card=(c,kind)=>`<details class="check-card"><summary><span class="check-claim">${esc(c.claim)}</span><span class="check-meta"><span class="mono faint">${esc(kind)} · ${esc(c.basis)}${c.date&&!c.basis.includes(c.date)?' · '+esc(c.date):''}</span><span class="badge-dim">${badge[c.status]||esc(c.status)}</span></span></summary>${c.passages&&c.passages.length?`<ul class="collect-list">${c.passages.map(pass).join('')}</ul>`:'<p class="faint">No matching items collected in this run.</p>'}</details>`;
    const v=r.validation;
    document.querySelector('#claim-checks').innerHTML=v.figureChecks.map(c=>card(c,'Filed figure')).join('')+v.headlineChecks.map(c=>card(c,'Company statement')).join('')+(v.contradictions||[]).map(c=>card(c,'Figure mismatch')).join('');
    document.querySelector('#check-method').textContent=v.method;
    if(v.coverageScore){document.querySelector('#coverage-score').innerHTML=`<div class="metric"><div class="metric-number">${v.coverageScore.score}</div><div class="metric-label">${esc(v.coverageScore.label||'Coverage score')}</div><div class="metric-note">${esc(v.coverageScore.drivers)}</div></div><p class="faint">${esc(v.coverageScore.scope)}</p>`}
  }
  // Signalor historical mention analytics: static sanitized snapshot, never live-labeled.
  fetch('data/signalor-apple-mentions.json').then(x=>x.ok?x.json():null).then(sg=>{if(!sg)return;
    document.querySelector('#signalor-freshness').textContent=sg.freshnessLabel.toUpperCase().replace(/\.$/,'');
    const st=sg.sentiment,tot=st.total,pc=n=>(n/tot*100).toFixed(1);
    const mxT=Math.max(1,...sg.trends.map(d=>d.total));
    document.querySelector('#signalor-panel').innerHTML=`
      <div class="metric-row">
        <div class="metric"><div class="metric-number">${tot.toLocaleString('en-US')}</div><div class="metric-label">Public mentions analyzed</div><div class="metric-note">${esc(st.sourceMetadata.label)}</div></div>
        <div class="metric"><div class="metric-number">${st.averageScore>=0?'+':''}${st.averageScore.toFixed(3)}</div><div class="metric-label">Avg sentiment score</div><div class="metric-note">-1 negative to +1 positive</div></div>
        <div class="metric"><div class="metric-number">${sg.aspectCount.toLocaleString('en-US')}</div><div class="metric-label">Aspect tags</div><div class="metric-note">labels on mentions, not separate mentions</div></div>
      </div>
      <div class="sent-bar" role="img" aria-label="Sentiment split"><span class="sent-pos" style="width:${pc(st.positive)}%"></span><span class="sent-neu" style="width:${pc(st.neutral)}%"></span><span class="sent-neg" style="width:${pc(st.negative)}%"></span></div>
      <p class="util-legend"><span><i class="util-sw sent-pos"></i>Positive ${st.positive.toLocaleString('en-US')} (${pc(st.positive)}%)</span><span><i class="util-sw sent-neu"></i>Neutral ${st.neutral.toLocaleString('en-US')} (${pc(st.neutral)}%)</span><span><i class="util-sw sent-neg"></i>Negative ${st.negative.toLocaleString('en-US')} (${pc(st.negative)}%)</span></p>
      <div class="signalor-cols">
        <div><p class="overline">PLATFORMS</p>${sg.platformMix.map(p=>`<div class="sig-row"><span class="sig-name">${esc(p.platform)}</span><span class="sig-n"><b>${p.count.toLocaleString('en-US')}</b> · ${p.percentage.toFixed(1)}%</span></div>`).join('')}</div>
        <div><p class="overline">TOP ASPECTS BY MENTIONS</p>${sg.aspects.slice(0,10).map(a=>`<div class="sig-row"><span class="sig-name">${esc(a.aspect)}</span><span class="sig-n"><b>${a.count.toLocaleString('en-US')}</b> · ${a.negative.toLocaleString('en-US')} neg / ${a.positive.toLocaleString('en-US')} pos</span></div>`).join('')}</div>
      </div>
      <p class="overline">MENTIONS PER DAY</p>
      <div class="trend-chart">${sg.trends.map(d=>`<div class="trend-col" title="${esc(d.date)}: ${d.total.toLocaleString('en-US')} mentions"><span class="trend-bar" style="height:${Math.max(2,Math.round(d.total/mxT*64))}px"></span><span class="trend-day">${esc(d.date.slice(5))}</span></div>`).join('')}</div>
      <p class="chart-caption">${esc(sg.provenance)} Aggregates are historical and do not update with live runs. Aspect tags and sentiment are platform classifications, not verified claims.</p>`;
  }).catch(()=>{});
  if(r.trends&&r.trends.days&&r.trends.days.length){const mx=Math.max(1,...r.trends.days.map(d=>d.count));document.querySelector('#trend-chart').innerHTML=r.trends.days.map(d=>`<div class="trend-col" title="${esc(d.day)}: ${d.count.toLocaleString('en-US')} collected items"><span class="trend-bar" style="height:${Math.max(2,Math.round(d.count/mx*64))}px"></span><span class="trend-day">${esc(d.day.slice(5))}</span><span class="trend-n">${d.count.toLocaleString('en-US')}</span></div>`).join('')+`<p class="faint">${esc(r.trends.scope)}</p>`}
  document.querySelector('#foot-note').textContent='Items are deduplicated within each source; the same story syndicated across outlets can appear once per source. '+(r.storeMode==='attached-volume'?'The run store lives on an attached volume and survives redeploys.':'The on-disk store resets when the service redeploys.');
}
boot();
