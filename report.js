// Evidence-led company report: claims and risks first, source records below.
// Assessments use collected facts; wording matches stay separate from support.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function itemLine(i){
  const title=i.form?('Form '+i.form+(i.description?' · '+i.description:'')):(i.title||'(untitled)');
  const meta=i.outlet||(i.rating?i.rating+'/5':(i.points!=null?i.points+' pts':(i.date||'')));
  return `<li><span class="collect-item-title">${i.link?`<a class="detail-source" href="${esc(i.link)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title)}</span>${meta?`<span class="faint">${esc(meta)}</span>`:''}</li>`;
}
function renderEvidenceStream(stream){
  const list=document.querySelector('#evidence-stream');
  const more=document.querySelector('#evidence-stream-more');
  let shown=0;
  list.innerHTML=stream.length?'':'<li class="state-note">No collected items this run.</li>';
  const loadMore=()=>{
    const page=stream.slice(shown,shown+12);
    list.insertAdjacentHTML('beforeend',page.map(it=>`<li><span class="stream-src">${esc(it.src)}</span><span class="collect-item-title">${it.link?`<a class="detail-source" href="${esc(it.link)}" target="_blank" rel="noreferrer">${esc(it.title)}</a>`:esc(it.title)}</span><span class="mono faint">${esc(Date.parse(it.date)?new Date(Date.parse(it.date)).toISOString().slice(0,10):(it.date||'').slice(0,10))}</span>${it.relevance?`<span class="rel-note">${esc(it.relevance)}</span>`:''}</li>`).join(''));
    shown+=page.length;
    more.hidden=shown>=stream.length;
  };
  more.querySelector('button').onclick=loadMore;
  loadMore();
}
function failAll(msg){for(const sel of ['#key-takeaways','#risk-findings','#run-summary','#memo-body','#evidence-stream','#run-graph','#claim-checks','#trend-chart']){const el=document.querySelector(sel);if(el)el.innerHTML=['#evidence-stream','#key-takeaways'].includes(sel)?`<li class="state-note state-error">${msg}</li>`:`<p class="state-note state-error">${msg}</p>`}}
function enableDownloads(){for(const id of ['download-memo','export-citations']){const a=document.getElementById(id);if(a){a.classList.remove('is-disabled');a.removeAttribute('aria-disabled')}}}
function evidenceLink(title,link){
  return link?`<a class="detail-source" href="${esc(link)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title);
}
function evidencePassage(p){
  return `<li><div>${evidenceLink(p.title,p.link)}</div><p class="finding-meta">${esc(p.source||'')} · ${esc(p.date||'')}${p.wording==='echo'?' · Repeated wording; same origin possible':p.wording==='separate'?' · Related reporting; distinct wording':''}</p>${p.excerpt?`<blockquote>${esc(p.excerpt)}</blockquote>`:''}</li>`;
}
function evidenceColumn(title,body){
  return `<div class="finding-evidence"><h4>${esc(title)}</h4>${body}</div>`;
}
function renderClaimCards(v={}){
  const cards=[
    ...(v.figureChecks||[]).map(c=>({c,kind:'Filed figure'})),
    ...(v.headlineChecks||[]).map(c=>({c,kind:'Company statement'})),
    ...(v.contradictions||[]).map(c=>({c,kind:'Figure comparison'}))
  ];
  return cards.map(({c,kind},i)=>{
    const filed=kind==='Filed figure',mismatch=kind==='Figure comparison';
    const passages=c.passages||[];
    const related=mismatch?[]:passages.filter(p=>!p.tension);
    const conflicting=mismatch?passages:passages.filter(p=>p.tension);
    const assessment=mismatch?'Compare period & metric':filed?'On the SEC record':conflicting.length?'Potential tension':related.some(p=>p.wording==='separate')?'Related reporting':related.length?'Repeated company wording':'Company statement';
    const primary=filed?`<ul class="finding-sources"><li>${evidenceLink(c.claim,c.link)}<p class="finding-meta">${esc(c.basis)} · ${esc(c.date||'')}</p></li></ul>`:'';
    const next=mismatch?'Compare the cited period, metric, and units with the SEC filing before treating the figures as conflicting.'
      :filed?'Check that any press comparison uses the same fiscal period, accounting concept, and units.'
      :conflicting.length?'Read the flagged passages against the original statement; check whether timing or scope explains the tension.'
      :related.some(p=>p.wording==='separate')?'Trace the reporting to its original sources before counting it as independent corroboration.'
      :related.length?'Find reporting based on an independent source, rather than another version of the company announcement.'
      :'Check independent reporting and subsequent disclosures for this specific statement.';
    return `<article class="finding-card">
      <header class="finding-heading"><p class="overline">${esc(kind)} · ${String(i+1).padStart(2,'0')}</p><span class="badge-dim">${assessment}</span></header>
      <h3>${esc(c.claim)}</h3>
      <p class="finding-meta">${evidenceLink(c.basis||'Original source',c.link)}${c.date?' · '+esc(c.date):''}</p>
      <div class="finding-columns">
        ${evidenceColumn('Supporting evidence',primary||'<p class="finding-copy">The original company statement establishes what was announced. Related reporting is shown separately below.</p>')}
        ${evidenceColumn('Conflicting evidence',conflicting.length?`<ul class="finding-sources">${conflicting.map(evidencePassage).join('')}</ul><p class="finding-copy">Flagged for comparison, not a confirmed contradiction.</p>`:'<p class="finding-copy">No direct contradiction identified in this run. Check scope and timing when comparing sources.</p>')}
      </div>
      ${related.length?`<details class="finding-related"><summary>Related coverage · ${related.length} matched passage${related.length===1?'':'s'}</summary><p class="finding-copy">${filed?'These passages contain the same figure string; compare the metric and period.':'Wording matches show relevance, not independent verification. Repeated versions of one story do not count as separate corroboration.'}</p><ul class="finding-sources">${related.map(evidencePassage).join('')}</ul></details>`:''}
      <p class="finding-next"><strong>What to verify next</strong> ${next}</p>
    </article>`;
  }).join('')||'<p class="state-note">Next check: collect a company statement or filed figure to start a claim card.</p>';
}
const riskImplications={
  'legal and regulatory proceedings':'Legal outcomes or changes in regulation can affect operating costs, distribution, and business practices.',
  'data security and confidentiality':'Security incidents can disrupt services, expose confidential information, and affect customer trust.',
  'carrier and channel performance':'Carrier and reseller performance can affect product availability and sales execution.',
  'supply chain and manufacturing':'Component constraints or manufacturing disruption can affect availability, costs, and delivery timing.',
  'workforce and talent':'Changes in staffing and retention can affect execution and product development.'
};
function renderRiskCards(d={}){
  const cues=d.riskCues||[],cross=d.riskCross||[];
  const covered=new Set(cross.map(x=>x.risk.link+'\n'+x.risk.title));
  const cards=cues.map(cue=>{
    const matches=cross.filter(x=>x.cue.title===cue.title&&x.cue.link===cue.link);
    return {title:cue.title,source:cue.source,date:cue.date,link:cue.link,
      label:matches.length?'Coverage + disclosed risk':'Risk mention',
      meaning:matches.length?(riskImplications[matches[0].group]||`This coverage touches the disclosed risk area: ${matches[0].group}.`):`The mention contains the cue “${cue.cue||'risk'}”. Check the event, exposure, and timing before drawing a business conclusion.`,
      evidence:matches.map(x=>({title:x.risk.title,link:x.risk.link,source:`10-K · ${x.risk.category||x.group}`,date:x.risk.date})),
      context:matches.length?'The filing establishes that the company disclosed this exposure; the topic match does not establish that the reported event occurred.':'Trace this report to its original source and check subsequent company disclosures.',
      next:'Verify the underlying event, company response, and measurable impact. Check whether other coverage relies on the same original source.'};
  });
  for(const rf of (d.riskFactors||[]).filter(rf=>!covered.has(rf.link+'\n'+rf.title)).slice(0,8)){
    cards.push({title:rf.title,source:'10-K · '+(rf.category||'Item 1A'),date:rf.date,link:rf.link,
      label:'Company-disclosed exposure',meaning:'This is an exposure the company names in its filing, not a finding that the risk has occurred.',
      evidence:[],context:'Use the cited filing as the primary record of the disclosure.',
      next:'Look for a dated event, changes in later filings, and quantified financial or operating effects.'});
  }
  return cards.map(c=>`<article class="finding-card">
    <header class="finding-heading"><p class="overline">RISK / MENTION</p><span class="badge-dim">${c.label}</span></header>
    <h3>${evidenceLink(c.title,c.link)}</h3><p class="finding-meta">${esc(c.source)} · ${esc(c.date||'')}</p>
    <div class="finding-columns">
      ${evidenceColumn('Why it matters',`<p class="finding-copy">${esc(c.meaning)}</p><p class="finding-meta">Interpretation / business context</p>`)}
      ${evidenceColumn('What other evidence says',`${c.evidence.length?`<ul class="finding-sources">${c.evidence.map(evidencePassage).join('')}</ul>`:''}<p class="finding-copy">${esc(c.context)}</p>`)}
    </div>
    <p class="finding-next"><strong>What to verify next</strong> ${esc(c.next)}</p>
  </article>`).join('')||'<p class="state-note">Next check: review the latest 10-K risk disclosures and dated coverage for specific exposures.</p>';
}
function renderTakeaways(d={},v={}){
  const points=[];
  for(const delta of (d.deltas||[]).slice(0,3)){
    const row=(d.fundamentals||[])[0]?.rows?.[delta.metric];
    points.push({text:`${delta.metric}: ${Number(delta.pct)>0?'+':''}${delta.pct}% year over year`,detail:`${delta.prev} → ${delta.cur} · computed from filed figures`,link:row?.link});
  }
  const tensions=(v.headlineChecks||[]).filter(c=>(c.passages||[]).some(p=>p.tension));
  if(tensions.length)points.push({text:`${tensions.length} company statement${tensions.length===1?'':'s'} to compare with flagged coverage`,detail:'Review the passages for differences in timing, scope, or wording.',link:'#questions'});
  const risk=(d.riskCross||[])[0];
  if(risk)points.push({text:`Coverage touches ${risk.group}`,detail:'Compare the reported event with the company’s own disclosed exposure.',link:'#risks'});
  else if(d.riskCues?.length)points.push({text:`${d.riskCues.length} risk mentions to investigate`,detail:'Each mention includes context and a concrete follow-up.',link:'#risks'});
  return points.map(p=>`<li><h3>${p.link?.startsWith('#')?`<a class="detail-source" href="${p.link}">${esc(p.text)}</a>`:evidenceLink(p.text,p.link)}</h3><p class="finding-copy">${esc(p.detail)}</p></li>`).join('')||'<li><h3>Start with the source record</h3><p class="finding-copy">Review the questions and cited statements below, then follow the verification steps.</p></li>';
}
function renderAspectSentiment(aspects){
  return aspects.map(a=>{
    const share=n=>a.count?n/a.count*100:0;
    const net=Math.round(share(a.positive)-share(a.negative));
    const counts=`${a.negative.toLocaleString('en-US')} negative, ${a.neutral.toLocaleString('en-US')} neutral, ${a.positive.toLocaleString('en-US')} positive`;
    const score=`${net>0?'+':''}${net}`;
    return `<li class="aspect-sentiment-row">
      <div class="aspect-label"><span class="sig-name">${esc(a.aspect)}</span><span class="aspect-mentions">${a.count.toLocaleString('en-US')} mentions</span></div>
      <div class="aspect-diverging" role="img" tabindex="0" aria-label="${esc(a.aspect)}: ${esc(counts)}. Net sentiment ${score} percentage points." title="${esc(counts)}">
        <svg class="aspect-plot" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
          <path class="aspect-grid" d="M1 0V40 M250 0V40 M750 0V40 M999 0V40"/>
          <rect class="aspect-negative-bar" x="${500-share(a.negative)*5}" y="9" width="${share(a.negative)*5}" height="22"/>
          <rect class="aspect-positive-bar" x="500" y="9" width="${share(a.positive)*5}" height="22"/>
          <path class="aspect-zero" d="M500 0V40"/>
        </svg>
        <span class="aspect-counts">${esc(counts)}</span>
      </div>
      <span class="aspect-net ${net>0?'positive':net<0?'negative':'neutral'}" title="Positive share minus negative share (percentage points)">${score}<span class="aspect-unit"> pp</span></span>
    </li>`;
  }).join('')||'<li class="state-note">No matching aspects.</li>';
}
async function boot(){
  let r;
  try{r=await fetch('/api/companies/apple/analysis').then(x=>{if(!x.ok)throw new Error('HTTP '+x.status);return x.json()})}
  catch(e){failAll('The run failed to start; nothing is substituted. Retry in a moment - a cold start can take up to about 80 seconds.');return}
  enableDownloads();
  const total=r.sources.reduce((n,s)=>n+s.itemCount,0);
  const p=r.persistence||{};
  const cached=r.sources.filter(s=>s.cached).length;
  document.querySelector('#run-badges').innerHTML=[
    `<span class="badge-live">LIVE RUN</span>`,
    cached?`<span class="badge-dim">${cached} SOURCES CACHED &lt;10M</span>`:''
  ].join('');
  document.querySelector('#run-summary').innerHTML=[
    ['Items this run',total.toLocaleString('en-US'),(r.relevantTotal||total).toLocaleString('en-US')+' Apple-relevant'+((r.candidateTotal||0)>0?` (${r.candidateTotal.toLocaleString('en-US')} candidate query-matches)`:'')],
    ['Records on file',(p.uniqueItems||total).toLocaleString('en-US'),'deduplicated within each source'],
    ['New this run',(p.newThisRun!=null?p.newThisRun:0).toLocaleString('en-US'),(p.seenBeforeThisRun||0).toLocaleString('en-US')+' repeat sightings this run'],
    ['Runs recorded',(p.runs||1),r.storeMode==='attached-volume'?'attached volume, survives redeploys':'on-disk store, resets on redeploy']
  ].map(([k,v,n])=>`<div class="metric"><p class="metric-label">${k}</p><p class="metric-number">${v}</p><p class="metric-note">${n}</p></div>`).join('');
  const TYPE={edgar:'Filings',newsroom:'Press',news:'Press',macrumors:'Press',ninetofive:'Press',verge:'Press',hackernews:'Forum stories',hncomments:'Comments',reviews:'Reviews',mastodon:'Social posts',lemmy:'Forum posts',reddit:'Social posts',itunes:'App metadata',pageviews:'Time series',xbrl:'Filed figures',xbrl_ni:'Filed figures',xbrl_rd:'Filed figures',xbrl_eps:'Filed figures',riskfactors:'Filings',wikipedia:'Reference'};
  const byType={};for(const s of r.sources){const t=TYPE[s.key]||'Other';byType[t]=(byType[t]||0)+(s.relevantCount!=null?s.relevantCount:s.itemCount)}
  document.querySelector('#run-summary').insertAdjacentHTML('afterend',`<p class="type-strip">${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span><b>${v.toLocaleString('en-US')}</b> ${k}</span>`).join('')}</p>`);
  const d=r.diligence;
  document.querySelector('#key-takeaways').innerHTML=renderTakeaways(d,r.validation);
  document.querySelector('#risk-findings').innerHTML=renderRiskCards(d);
  // Reference financials and collection context.
  if(d){
    const fyHead=d.fundamentals.map(f=>`<th>${esc(f.fy)}<div class="faint mono" style="font-weight:400">ended ${esc(f.date)}</div></th>`).join('');
    const metrics=['Revenue','Net income','R&D expense','Diluted EPS'];
    const fyRows=metrics.map(m=>`<tr><td>${m}</td>${d.fundamentals.map(f=>{const row=f.rows[m];return row?`<td><a class="detail-source" href="${esc(row.link)}" target="_blank" rel="noreferrer">${esc(row.value.split(' - ')[0])}</a><div class="faint mono" style="font-weight:400">us-gaap:${esc(row.concept)}${row.accession?' · accession '+esc(row.accession)+', filed '+esc(row.filed):''}</div></td>`:'<td class="faint">not collected</td>'}).join('')}</tr>`).join('');
    const deltaRow=`<tr><td>YoY change (computed)</td>${d.fundamentals.map((f,fi)=>{const cells=metrics.map(m=>{const x=(d.deltas||[]).find(q=>q.metric===m);return x?x.pct+'%':'-'}).join(' / ');return fi===0?`<td>${cells}</td>`:'<td class="faint">-</td>'}).join('')}</tr>`;
    const comps=(d.competitors||[]).slice(0,8).map(c=>`<span><b>${c.count}</b> ${esc(c.name)}</span>`).join('');
    const open=(d.openQuestions||[]).map(q=>`<li><span class="collect-item-title">${esc(q.area)}</span><span class="faint">${esc(q.detail)}</span></li>`).join('');
    document.querySelector('#memo-body').innerHTML=
      `<p class="chart-caption">${esc(d.labels.fundamentals)}</p>
      <table class="memo-table"><thead><tr><th>Filed figure</th>${fyHead}</tr></thead><tbody>${fyRows}${deltaRow}</tbody></table>
      <p class="chart-caption">${esc(d.labels.deltas||'')}</p>
      <p class="overline memo-sub">APPENDIX: CO-MENTION EXPLORATION</p><p class="chart-caption">${esc(d.labels.competitors)}${d.competitorsOldest?' Oldest collected item dates to '+esc(d.competitorsOldest)+'.':''}</p>
      <p class="type-strip">${comps||'<span class="faint">None this run.</span>'}</p>
      <p class="overline memo-sub">SOURCE COVERAGE & NEXT CHECKS</p>
      <ul class="collect-list">${open||'<li class="faint">None identified this run.</li>'}</ul>`;
  }else document.querySelector('#memo-body').innerHTML='<p class="state-note">Next check: collect SEC financials for a period-by-period comparison.</p>';
  // Evidence stream: latest items across all live sources, dense.
  const stream=[];
  for(const s of r.sources)for(const it of (s.relevantItems||s.allItems||s.items))stream.push({src:s.name,title:it.form?('Form '+it.form+(it.description?' · '+it.description:'')):(it.title||''),link:it.link||'',date:it.date||'',relevance:it.relevance||''});
  stream.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
  renderEvidenceStream(stream);
  if(window.matchMedia&&matchMedia('(max-width:760px)').matches){document.querySelector('#evidence-stream').addEventListener('click',e=>{const t=e.target.closest('.collect-item-title');if(!t||t.classList.contains('expanded'))return;e.preventDefault();t.classList.add('expanded')})}
  const a=r.analysis;
  const srcRel=Object.fromEntries(r.sources.map(s=>[s.key,s.relevantCount]));const maxC=Math.max(1,...a.perSource.map(q=>q.collected));
  const graphRows=a.perSource.map(q=>({...q,relevantCount:srcRel[q.key]}));document.querySelector('#run-graph').innerHTML='<div class="util-legend"><span><i class="util-sw collected"></i>Collected this run</span></div>'+graphRows.map((q,idx)=>`<div class="util-row" data-idx="${idx}" role="button" tabindex="0" aria-expanded="false"><span class="util-name">${esc(q.name)}</span><span class="util-bars"><span class="util-bar collected" style="width:${Math.round(q.collected/maxC*100)}%"></span></span><span class="util-nums"><b>${q.collected.toLocaleString('en-US')}</b>${q.relevantCount!=null&&q.relevantCount!==q.collected?` · ${q.relevantCount.toLocaleString('en-US')} ${(r.sources.find(s=>s.key===q.key)||{}).candidateCount===q.relevantCount?'candidate query-matches':'Apple-relevant'}`:''}${q.mode!=='live'?' · unavailable':''}</span></div><div class="util-detail" id="util-detail-${idx}" hidden><ul class="collect-list">${(r.sources.find(s=>s.key===q.key).relevantItems||q.items).slice(0,100).map(it=>`<li><span class="mono faint">${esc((it.date||'').slice(0,10))}</span><span class="collect-item-title">${it.link?`<a class="detail-source" href="${esc(it.link)}" target="_blank" rel="noreferrer">${esc(it.title)}</a>`:esc(it.title)}</span>${it.relevance?`<span class="rel-note">${esc(it.relevance)}</span>`:''}</li>`).join('')}${(r.sources.find(s=>s.key===q.key).relevantItems||q.items).length>100?`<li class="faint">+${((r.sources.find(s=>s.key===q.key).relevantItems||q.items).length-100).toLocaleString('en-US')} more from this source</li>`:''}</ul></div>`).join('');
  document.querySelectorAll('.util-row').forEach(row=>{const open=()=>{const d=document.getElementById('util-detail-'+row.dataset.idx);const show=d.hidden;d.hidden=!show;row.setAttribute('aria-expanded',String(show))};row.addEventListener('click',open);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}})});
  if(r.history&&r.history.length)document.querySelector('#run-history').textContent=`${r.history.length} runs on record · ${(p.uniqueItems||0).toLocaleString('en-US')} unique items · ${r.storeMode==='attached-volume'?'store on attached volume, survives redeploys':'store resets on redeploy'}`;
  if(r.validation){
    const v=r.validation;
    document.querySelector('#claim-checks').innerHTML=renderClaimCards(v);
    document.querySelector('#check-method').textContent=v.method;
  }else document.querySelector('#claim-checks').innerHTML=renderClaimCards();
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
      <section class="aspect-sentiment" aria-labelledby="aspect-sentiment-title">
        <div class="section-heading"><div><p class="overline">DRIVERS</p><h2 id="aspect-sentiment-title">Aspect sentiment</h2></div></div>
        <label class="aspect-search-label" for="aspect-search">Search top aspects</label>
        <input id="aspect-search" class="aspect-search" type="search" placeholder="Search aspects" aria-controls="aspect-sentiment-list">
        <div class="aspect-legend"><p class="util-legend"><span><i class="util-sw aspect-negative-swatch"></i>Negative</span><span><i class="util-sw aspect-positive-swatch"></i>Positive</span></p><p class="chart-caption">Share of mentions · neutral not drawn</p></div>
        <div class="aspect-chart-head" aria-hidden="true"><span>ASPECT / MENTIONS</span><div class="aspect-axis"><span>100%</span><span>50%</span><span>0</span><span>50%</span><span>100%</span></div><span>NET PP</span></div>
        <ul id="aspect-sentiment-list" class="aspect-sentiment-list">${renderAspectSentiment(sg.aspects.slice(0,10))}</ul>
        <p class="chart-caption aspect-chart-note">Negative ← share of mentions → Positive. Hover or focus a bar for counts. Net = positive share − negative share, in percentage points.</p>
      </section>
      <p class="overline">MENTIONS PER DAY</p>
      <div class="trend-chart">${sg.trends.map(d=>`<div class="trend-col" title="${esc(d.date)}: ${d.total.toLocaleString('en-US')} mentions"><span class="trend-bar${d.total===0?' zero':''}" style="height:${d.total===0?0:Math.max(6,Math.round(d.total/mxT*64))}px"></span><span class="trend-day">${esc(d.date.slice(5))}</span></div>`).join('')}</div>
      <p class="chart-caption">${esc(sg.provenance)} Aggregates are historical and do not update with live runs. Aspect tags and sentiment are platform classifications, not verified claims.</p>`;
    document.querySelector('#aspect-search').addEventListener('input',e=>{
      const query=e.target.value.trim().toLowerCase();
      document.querySelector('#aspect-sentiment-list').innerHTML=renderAspectSentiment(sg.aspects.slice(0,10).filter(a=>a.aspect.toLowerCase().includes(query)));
    });
  }).catch(()=>{});
  if(r.trends&&r.trends.days&&r.trends.days.length){const mx=Math.max(1,...r.trends.days.map(d=>d.count));document.querySelector('#trend-chart').innerHTML=r.trends.days.map(d=>`<div class="trend-col" title="${esc(d.day)}: ${d.count.toLocaleString('en-US')} collected items"><span class="trend-bar${d.count===0?' zero':''}" style="height:${d.count===0?0:Math.max(6,Math.round(d.count/mx*64))}px"></span><span class="trend-day">${esc(d.day.slice(5))}</span><span class="trend-n">${d.count.toLocaleString('en-US')}</span></div>`).join('')+`<p class="faint">${esc(r.trends.scope)}</p>`}
  document.querySelector('#foot-note').textContent='Items are deduplicated within each source; the same story syndicated across outlets can appear once per source. '+(r.storeMode==='attached-volume'?'The run store lives on an attached volume and survives redeploys.':'The on-disk store resets when the service redeploys.');
}
boot();
