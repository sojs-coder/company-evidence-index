// Vet flow: two phases, honest states. Identify (select exact legal entity)
// then a cited report answering the buyer's question. Nothing is substituted.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null?'(not recorded)':'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
if(localStorage.getItem('cei-theme')==='dark'){document.documentElement.dataset.theme='dark';document.querySelector('meta[name="theme-color"]').content='#02205e'}
const themeBtn=document.querySelector('.theme-toggle');
themeBtn&&themeBtn.addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('cei-theme',dark?'dark':'light');document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
function state(el,msg,err){const n=document.querySelector(el);if(n)n.innerHTML=`<p class="state-note${err?' state-error':''}">${esc(msg)}</p>`}
const KIND={public_company:'SEC company registry',brand_match:'Brand registry match',legal_recipient:'Recorded legal recipient (USASpending)',custom:'Name as typed'};
let currentName='';
async function identify(name){
  currentName=name;
  for(const p of ['identity-panel','answer-panel','awards-panel','citations-panel','sources-panel'])document.getElementById(p).hidden=true;
  document.getElementById('identity-panel').hidden=false;
  state('#identities','Resolving candidate legal entities from live registries. Nothing is assumed.');
  document.getElementById('identity-count').textContent='';
  let r;
  try{r=await fetch('/api/vet/identify?name='+encodeURIComponent(name)).then(x=>{if(!x.ok)throw new Error('HTTP '+x.status);return x.json()})}
  catch(e){state('#identities','Identity lookup failed ('+(e.message||e)+'). Nothing is substituted.',true);return}
  document.getElementById('run-stamp').textContent='FETCHED '+new Date(r.fetchedAt).toUTCString().slice(17,25)+' UTC';
  const ids=r.identities;
  document.getElementById('identity-count').textContent=ids.length+' CANDIDATES';
  const card=(c,i)=>`<label class="id-card"><input type="radio" name="identity" value="${i}" /><span class="collect-item-title">${esc(c.name)}</span><span class="faint">${esc(KIND[c.kind]||c.kind)}${c.domain?' · '+esc(c.domain):''}${c.ticker?' · '+esc(c.ticker):''}${c.exchange?' · '+esc(c.exchange):''}${c.awardCount!=null?' · '+c.awardCount+' awards':''}</span></label>`;
  document.getElementById('identities').innerHTML=(ids.length
    ?ids.map(card).join('')
    :'<p class="state-note">No registry candidates matched. You can still run the name as typed; the report will say it is buyer-asserted, not registry-verified.</p>')
    +`<label class="id-card"><input type="radio" name="identity" value="custom" /><span class="collect-item-title">${esc(name)} (as typed)</span><span class="faint">Buyer-asserted name, not registry-verified</span></label>`
    +(r.hiddenWeakBrandMatches?`<p class="state-note">${r.hiddenWeakBrandMatches} weak brand-registry match${r.hiddenWeakBrandMatches===1?'':'es'} hidden: name overlap only on generic words (e.g. 'robotics'), so not plausible identity candidates.</p>`:'')
    +'<button type="button" id="report-go" class="outline-button">Build cited report</button>';
  document.getElementById('report-go').addEventListener('click',()=>{
    const sel=document.querySelector('input[name="identity"]:checked');
    if(!sel){state('#identities','Select one candidate first - the report covers exactly one legal entity.',true);document.getElementById('identities').insertAdjacentHTML('beforeend',document.getElementById('report-go').outerHTML);return}
    const id=sel.value==='custom'?{kind:'custom',name:currentName}:ids[Number(sel.value)];
    report(id);
  });
}
async function report(identity){
  const question=document.getElementById('vet-question').value.trim();
  const category=document.getElementById('vet-category').value;
  for(const p of ['answer-panel','awards-panel','citations-panel','sources-panel'])document.getElementById(p).hidden=false;
  document.getElementById('answer-title').textContent='“'+question+'”'+' · '+identity.name;
  state('#quotes','Fetching cited evidence for this exact entity. Live sources only.');
  state('#findings','');state('#limitations','');state('#synthesis','');state('#awards','Fetching live USASpending records.');state('#citations','Fetching live NASA citations.');state('#sources','');
  const qs='name='+encodeURIComponent(currentName)+'&question='+encodeURIComponent(question)+'&category='+encodeURIComponent(category)+'&identityKind='+encodeURIComponent(identity.kind)+'&identityName='+encodeURIComponent(identity.name);
  let r;
  try{r=await fetch('/api/vet/report?'+qs).then(x=>{if(!x.ok)throw new Error('HTTP '+x.status);return x.json()})}
  catch(e){state('#quotes','The report failed ('+(e.message||e)+'). Nothing is substituted.',true);state('#awards','Not attempted after the failure.',true);state('#citations','Not attempted after the failure.',true);return}
  document.getElementById('answer-count').textContent=(r.answer.quotedEvidence.length)+' QUOTES · '+(r.findings.length)+' FINDINGS';
  document.getElementById('quotes').innerHTML=r.answer.quotedEvidence.length
    ?r.answer.quotedEvidence.map(q=>`<blockquote class="quote-block"><p>${esc(q.passage)}</p><span class="faint"><a class="detail-source" href="${esc(q.source.url)}" target="_blank" rel="noreferrer">${esc(q.source.name||q.source.url)}</a></span></blockquote>`).join('')
    :'<p class="state-note">No quoted passages answered the question directly from the searched public pages. The structured findings below still stand on their own sources.</p>';
  document.getElementById('findings').innerHTML=r.findings.length
    ?'<ul class="collect-list collect-list--plain">'+r.findings.map(f=>`<li><span class="collect-item-title">${esc(f.statement)} <span class="badge-dim">${esc(f.confidence)}</span></span><span class="faint">${f.source&&f.source.url?`<a class="detail-source" href="${esc(f.source.url)}" target="_blank" rel="noreferrer">${esc(f.source.name)}</a>`:esc(f.source?f.source.name:'')}</span></li>`).join('')+'</ul>'
    :'';
  const cc=r.conflictChecks||[];
  document.getElementById('limitations').innerHTML=(r.answer.limitations.length
    ?'<ul class="collect-list collect-list--plain">'+r.answer.limitations.map(l=>`<li><span class="collect-item-title">${esc(l)}</span></li>`).join('')+'</ul>':'')
    +(cc.length?'<p class="overline pack-group">CONFLICT CHECKS - DETERMINISTIC, EXTRACTIVE</p><ul class="collect-list collect-list--plain">'+cc.map(c=>`<li><span class="collect-item-title">${esc(c.finding)}</span><span class="faint">${esc(c.method)}</span></li>`).join('')+'</ul>':'');
  const syn=r.synthesis;
  const HDR='<p class="overline pack-group">THIRD-PARTY SYNTHESIS - LLM-GENERATED FROM CITED SOURCES (CONTEXT.DEV)</p>';
  document.getElementById('synthesis').innerHTML=syn
    ?(syn.unavailable
      ?HDR+'<p class="state-note">'+esc(syn.unavailable)+'</p>'
      :(syn.content
        ?HDR
          +'<div class="quote-block">'
          +(syn.content.summary?`<p>${esc(syn.content.summary)}</p>`:'')
          +(Array.isArray(syn.content.evidence_points)&&syn.content.evidence_points.length?'<ul class="collect-list collect-list--plain">'+syn.content.evidence_points.map(p=>`<li><span class="collect-item-title">${esc(String(p))}</span></li>`).join('')+'</ul>':'')
          +(Array.isArray(syn.content.open_questions)&&syn.content.open_questions.length?'<p class="faint">Open questions the sources left: '+esc(syn.content.open_questions.map(String).join(' · '))+'</p>':'')
          +'</div>'
          +(syn.amountCheck&&syn.amountCheck.flagged.length
            ?'<ul class="collect-list collect-list--plain">'+syn.amountCheck.flagged.map(f=>`<li><span class="collect-item-title state-error">Unqualified figure: “${esc(f)}”</span><span class="faint">The generator did not preserve amount semantics here (maximum/ceiling vs obligated vs received). Verify this figure against the cited source before relying on it. Deterministic scan: ${esc(syn.amountCheck.method)}</span></li>`).join('')+'</ul>'
            :'')
          +(syn.sources&&syn.sources.length?'<p class="faint">Synthesis sources: '+syn.sources.map(s=>{const chk=(syn.sourcesChecked||[]).find(c=>c.url===s.url);const tag=chk?(chk.reachable===true?'reachable at run time':chk.reachable===false?'NOT reachable at run time':'reachability check failed'):'not checked';return `<a class="detail-source" href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title||s.url)}</a> <span class="badge-dim">${tag}</span>`}).join(' · ')+'</p><p class="faint">Reachable means the cited page resolved when this report ran; it does not verify what the synthesis claims about the page.</p>':'')
          +(syn.partial?'<p class="state-note">This synthesis was partial; weight it accordingly.</p>':'')
          +'<p class="state-note">Generated by a third-party LLM from the cited sources. It is not extractive evidence and not a deterministic check; judge it against the quoted passages above.</p>'
        :''))
    :'';
  const awards=r.awards||[];
  document.getElementById('award-count').textContent=awards.length+' RECORDS'+(r.awardCoverage==='first_page_sample'?' · FIRST-PAGE SAMPLE':r.awardCoverage==='complete_result_set'?' · COMPLETE RESULT SET OF THAT SEARCH':'');
  const awardItem=a=>`<li><span class="collect-item-title">${a.sourceUrl?`<a class="detail-source" href="${esc(a.sourceUrl)}" target="_blank" rel="noreferrer">${esc(a.description||a.awardId||'(untitled award)')}</a>`:esc(a.description||'(untitled award)')}</span><span class="faint">${esc([a.agency,a.startDate,money(a.obligatedAmountUsd)].filter(Boolean).join(' · '))}</span></li>`;
  document.getElementById('awards').innerHTML=awards.length
    ?'<ul class="collect-list collect-list--plain">'+awards.map(awardItem).join('')+'</ul>'
    :'<p class="state-note">No federal contract awards under this exact legal name. That is not evidence of absence - try name variants.</p>';
  const cites=r.citations||[];
  const verified=cites.filter(c=>c.association&&c.association.state==='author_affiliation_orgname_match');
  const matches=cites.filter(c=>!c.association||c.association.state!=='affiliation_verified');
  document.getElementById('citation-count').textContent=cites.length+' CITATIONS · '+verified.length+' AUTHOR-AFFILIATION NAME MATCHES';
  const citeItem=c=>`<li><span class="collect-item-title">${c.sourceUrl?`<a class="detail-source" href="${esc(c.sourceUrl)}" target="_blank" rel="noreferrer">${esc(c.title)}</a>`:esc(c.title)}</span><span class="faint">${esc((c.association.organizations&&c.association.organizations.length?c.association.organizations.join(' · '):'affiliation not recorded')+(c.association.state==='author_affiliation_orgname_match'?' · author-reported affiliation string, token match':' · affiliation does not match this name'))}</span></li>`;
  document.getElementById('citations').innerHTML=cites.length
    ?(verified.length?'<p class="overline">AUTHOR-AFFILIATION ORG-NAME MATCHES - AUTHOR-REPORTED, NOT LEGAL-ENTITY VERIFICATION</p><ul class="collect-list collect-list--plain">'+verified.map(citeItem).join('')+'</ul>':'')
      +(matches.length?'<p class="overline pack-group">SEARCH MATCHES - COMPANY ASSOCIATION NOT VERIFIED</p><ul class="collect-list collect-list--plain">'+matches.map(citeItem).join('')+'</ul>':'')
      +'<p class="state-note">Search matches are keyword hits in the NASA archive, not this company\'s research or technical record.</p>'
    :'<p class="state-note">No NASA technical reports cite this legal name.</p>';
  document.getElementById('caveats').innerHTML='<ul class="collect-list collect-list--plain">'+r.caveats.map(c=>`<li><span class="collect-item-title">${esc(c)}</span></li>`).join('')+'</ul>';
  document.getElementById('sources').innerHTML='<ul class="collect-list collect-list--plain">'+r.sources.map(s=>`<li><span class="collect-item-title"><a class="detail-source" href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.name)}</a> <span class="badge-dim">${esc(s.mode)}</span></span><span class="faint">${esc((s.fetched!=null?s.fetched+' records':'')+(s.detail?' · '+s.detail:''))}</span></li>`).join('')+'</ul>';
}
// Native suggestions retain keyboard selection and allow names outside the seed.
async function loadCompanySuggestions(){
  const status=document.getElementById('vet-company-status');
  try{
    const response=await fetch('/data/public-companies-seed.json');
    if(!response.ok)throw new Error('HTTP '+response.status);
    const seed=await response.json();
    if(!Array.isArray(seed.companies)||!seed.companies.length)throw new Error('Empty company seed');
    const companies=new Map();
    for(const company of seed.companies){
      if(typeof company.name!=='string'||!company.name.trim())continue;
      const tickers=companies.get(company.name)||new Set();
      if(company.ticker)tickers.add(company.ticker);
      companies.set(company.name,tickers);
    }
    const options=[...companies].sort(([a],[b])=>a.localeCompare(b)).map(([name,tickers])=>{
      const option=document.createElement('option');
      option.value=name;
      option.label=[...tickers].join(' / ');
      return option;
    });
    document.getElementById('vet-companies').replaceChildren(...options);
    status.textContent='';
  }catch{
    status.textContent='Company suggestions are unavailable. You can still type any company name and search.';
  }
}
loadCompanySuggestions();
document.getElementById('vet-form').addEventListener('submit',e=>{e.preventDefault();const n=document.getElementById('vet-name').value.trim();if(n)identify(n)});
