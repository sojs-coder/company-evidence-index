// One brief for the approved five companies, from stored evidence only.
// Free endpoints: /api/packs, /api/analysis/:t, /api/packs/:t (stored items, for dates), plus
// /api/packs/:t/signals and /questions when the backend has generated them (else shown as missing).
const NAMES={AAPL:'Apple',MSFT:'Microsoft',AMZN:'Amazon',GOOGL:'Alphabet',NVDA:'Nvidia'};
const DEFQ={customer:'What should I check before buying from them?',vendor:'Is this company worth pursuing, and what is the opening?',investor:'What deserves diligence, and what challenges their story?',scout:'How does this company compare to peers?'};
const LENS={
  customer:{line:'Evaluating as a customer: counterclaims lead, then claims.',first:'counter',checks:['Are the reported problems about the product, the service or the price?','Do several independent posts raise the same problem, or only one?','Is the problem recent or old? See the content dates below.']},
  vendor:{line:'Evaluating as a vendor: claims lead, then counterclaims.',first:'claim',checks:['What do people praise that a partner could build on?','Which complaints point to a need you could address?','Who is talking: customers, developers or press? Check the sources on file.']},
  investor:{line:'Evaluating as an investor: claims lead, counterclaims challenge them.',first:'claim',checks:['Which claims have support from more than one post?','Which counterclaim contradicts the main story?','What would a primary source (filing, earnings call) have to show to settle it?']},
  scout:{line:'Evaluating as a scout: compare the five on coverage first.',first:'claim',checks:['Is the evidence volume comparable across companies?','Do the claims and counterclaims cover the same themes?','Which company has the thinnest or oldest evidence?']}
};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const trimSentence=t=>{t=String(t||'').trim();if(!t||/[.!?]['")]?$/.test(t))return t;const m=t.match(/^[\s\S]*[.!?](?=\s|$)/);return m?m[0]:''};
const num=n=>Number(n||0).toLocaleString('en-US');
const day=s=>{const d=new Date(s);return isNaN(d)?(s?esc(String(s).slice(0,10)):'unknown'):d.toISOString().slice(0,10)};
const $=s=>document.querySelector(s);
const q=new URLSearchParams(location.search);
let ticker=(q.get('c')||'AAPL').toUpperCase();if(!Object.prototype.hasOwnProperty.call(NAMES,ticker))ticker='AAPL';
let role=q.get('role')||(window.CEI_ROLE&&window.CEI_ROLE.get())||'scout';if(!Object.prototype.hasOwnProperty.call(LENS,role))role='scout';
const question=(q.get('q')||'').trim().slice(0,300)||DEFQ[role];
const STOP=new Set('the a an and or of to is are what should how does do they their them it in on for with about from before be this that who which can i my we'.split(' '));
const words=s=>String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter(w=>w.length>2&&!STOP.has(w))||[];
function rank(list){
  const qw=new Set(words(question));
  return (list||[]).map((c,i)=>({c,i,s:words(c.text).filter(w=>qw.has(w)).length})).sort((a,b)=>b.s-a.s||a.i-b.i);
}
try{localStorage.setItem('cei_flow','?'+new URLSearchParams({c:ticker,role,q:question}))}catch{}
const safeLink=u=>/^https?:\/\//i.test(u||'')?u:'';
function items(list,kind,matchNote){
  if(!list||!list.length)return '<li class="state-note">None extracted from the sampled posts.</li>';
  return list.map(({c,s})=>{
    const posts=(c.posts||[]).map(p=>{const l=safeLink(p.link);return `<blockquote>${esc((p.text||'').slice(0,320))}${l?` <a href="${esc(l)}" rel="noopener noreferrer" target="_blank">source post</a>`:''}</blockquote>`}).join('');
    return `<li><p class="b-claim">${esc(c.text)}</p><p class="b-meta">${kind==='counter'?'COUNTERCLAIM':'CLAIM'} · CITED POSTS ${num(c.support)}${matchNote&&s?` · SHARES ${s} WORD${s>1?'S':''} WITH YOUR QUESTION`:''}</p>${posts?`<details><summary>Read the cited posts</summary>${posts}</details>`:''}</li>`;
  }).join('');
}
function renderQuestions(ans){
  const el=$('#b-iq');
  if(!ans||!ans.roles){el.innerHTML='<p class="state-note">Not generated yet for '+esc(NAMES[ticker])+'. Nothing is substituted.</p>';return}
  const list=ans.roles[role]||[];
  if(!list.length){el.innerHTML='<p class="state-note">No '+esc(role)+' questions were generated from the evidence. Nothing is substituted.</p>';return}
  el.innerHTML='<p class="state-note">Questions to investigate, written by '+esc(ans.model||'a model')+' from stored posts ('+esc(day(ans.generatedAt))+'). They are not answers to your question and not verified facts.</p><ul class="brief-checks">'+list.map(x=>{
    const cites=(x.cite||[]).map(safeLink).filter(Boolean).map((l,i)=>`<a href="${esc(l)}" rel="noopener noreferrer" target="_blank">post ${i+1}</a>`).join(' ');
    return `<li>${esc(x.q)}${cites?`<span class="b-meta"> CITED: ${cites}</span>`:''}</li>`}).join('')+'</ul>';
}
function renderSignals(sig,p){
  const el=$('#b-sig');
  if(!sig||!sig.coverage){el.innerHTML='<p class="state-note">Post analysis has not been generated for '+esc(NAMES[ticker])+' yet. Only the 40-post claims sample below is available.</p>';return}
  const c=sig.coverage,s=sig.sentiment||{};
  const tot=Object.values(s).reduce((x,y)=>x+y,0)||1;
  const pct=n=>Math.round(100*(n||0)/tot)+'%';
  const aspects=(sig.topAspects||[]).slice(0,8).map(a=>{
    const ex=(a.examples||[]).slice(0,2).map(e=>{const l=safeLink(e.link);return `<blockquote>${esc((e.text||'').slice(0,220))}${l?` <a href="${esc(l)}" rel="noopener noreferrer" target="_blank">source post</a>`:''}</blockquote>`}).join('');
    return `<li><p class="b-claim">${esc(a.aspect)}</p><p class="b-meta">MENTIONS ${num(a.count)} · POSITIVE ${num(a.positive)} · NEGATIVE ${num(a.negative)}</p>${ex?`<details><summary>Example posts</summary>${ex}</details>`:''}</li>`}).join('');
  el.innerHTML=`<div class="metric-row">${[
    ['Collected (raw)',num(c.collected),'stored posts, including duplicates'],
    [c.fullText===true?'Unique posts read (full text)':'Unique posts analysed',num(c.analyzed),`${c.fullText===true?'full text':'first '+num(c.textSliceChars||0)+' characters of each post'}; ${num(c.withText)} with text, ${num(c.dupes)} duplicates, ${num(c.noText)} without text`],
    ['Sentiment',`${pct(s.negative)} neg`,`${pct(s.positive)} positive, ${pct(s.neutral)} neutral, ${pct(s.mixed)} mixed`],
    ['Generated',day(sig.generatedAt),esc(sig.model||'')]
  ].map(([k,v,n])=>`<div class="metric"><p class="metric-label">${k}</p><p class="metric-number">${v}</p><p class="metric-note">${n}</p></div>`).join('')}</div>
  <p class="state-note">${esc(sig.basis||'')}</p>
  ${aspects?`<p class="overline" style="margin-top:20px">TOP ASPECTS</p><ul class="stream-list brief-list">${aspects}</ul>`:''}`;
}
function creditBlock(c){
  if(!c)return '';
  const open=role==='vendor'?' open':'';
  const head='<summary>Credit-bureau data source demonstration (synthetic test person, not this company)</summary>';
  if(c.state!=='demonstration'||!c.evidence)return `<details class="credit-demo">${head}<p class="state-note">${esc(c.detail||'The credit data source did not return data for this demonstration.')} Nothing is substituted.</p></details>`;
  const e=c.evidence,sc=e.score,t=e.tradelines||{},d=e.derogatory||{};
  const n=v=>v==null?'(not recorded)':num(v);
  const flags=(e.riskFlags||[]).map(f=>String(f.flag||'').replace(/_/g,' ')).filter(Boolean);
  return `<details class="credit-demo"${open}>${head}
  <p class="credit-tag">SYNTHETIC CONSUMER DEMONSTRATION · NOT COMPANY CREDIT · NOT ABOUT ${esc((NAMES[ticker]||'').toUpperCase())}</p>
  <p class="state-note">${esc(c.label||'')}</p>
  <ul class="brief-checks">
    ${sc?`<li>${esc(sc.model||'Score')}: ${n(sc.value)} (range ${n(sc.minimum)} to ${n(sc.maximum)}), percentile ${n(sc.percentile)}. Test person: ${esc((e.subject&&(e.subject.firstName+' '+e.subject.lastName))||'')}.</li>`:''}
    <li>Tradelines: ${n(t.count)} total, ${n(t.openCount)} open, balance ${t.balanceTotal==null?'(not recorded)':'$'+num(t.balanceTotal)}, past due ${t.pastDueTotal==null?'(not recorded)':'$'+num(t.pastDueTotal)}, revolving utilisation ${t.revolvingUtilizationPercent==null?'(not recorded)':t.revolvingUtilizationPercent+'%'}.</li>
    <li>Derogatory: ${n(d.bankruptcies)} bankruptcies, ${n(d.collections)} collections, ${n(d.chargeOffs)} charge-offs, ${n(d.latePayments30)} late 30 days.</li>
    ${flags.length?`<li>Flags: ${esc(flags.join(', '))}.</li>`:''}
    ${sc&&(sc.factors||[]).length?`<li>Score factors: ${esc(sc.factors.join('; '))}</li>`:''}
  </ul>
  ${(c.caveats||[]).map(x=>`<p class="state-note">${esc(x)}</p>`).join('')}
  <p class="state-note">${c.pulledAt?'Pulled '+esc(day(c.pulledAt))+' from the sponsor sandbox. ':''}Shown to demonstrate where a principal credit check fits in supplier vetting.</p></details>`;
}
async function renderSupplier(name){
  const el=$('#b-sup');
  el.innerHTML='<p class="state-note">Fetching live public records. Nothing is substituted.</p>';
  let r=null;
  try{const x=await fetch('/api/vet/supplier?name='+encodeURIComponent(name));if(x.ok)r=await x.json()}catch(e){}
  if(!r){el.innerHTML='<p class="state-note state-error">The public-records lookup failed. Nothing is substituted. Reload to retry.</p>';return}
  const money=n=>n==null?'(not recorded)':'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
  const aw=(r.awards||[]).slice(0,5).map(a=>`<li><p class="b-claim">${safeLink(a.sourceUrl)?`<a href="${esc(a.sourceUrl)}" rel="noopener noreferrer" target="_blank">${esc(a.description||a.awardId||'(untitled award)')}</a>`:esc(a.description||'(untitled award)')}</p><p class="b-meta">${esc(a.agency||'')} · ${esc(a.startDate||'')} · ${money(a.obligatedAmountUsd)} OBLIGATED · RECIPIENT ${esc(a.recipient||'')}</p></li>`).join('');
  const cites=r.citations||[];const ver=cites.filter(c=>c.association&&c.association.state==='affiliation_verified');
  const ci=cites.slice(0,5).map(c=>`<li><p class="b-claim">${safeLink(c.sourceUrl)?`<a href="${esc(c.sourceUrl)}" rel="noopener noreferrer" target="_blank">${esc(c.title)}</a>`:esc(c.title)}</p><p class="b-meta">${c.association&&c.association.state==='affiliation_verified'?'AUTHOR AFFILIATION VERIFIED':'KEYWORD MATCH, COMPANY NOT VERIFIED'}</p></li>`).join('');
  const credit=creditBlock(r.creditEvidence);
  el.innerHTML=`<p class="state-note">Fetched live ${esc(day(r.fetchedAt))} from USASpending and the NASA Technical Reports Server for the name "${esc(r.supplier||name)}". This is public contract and literature history, not credit data and not a qualification.</p>
  <p class="overline">FEDERAL AWARDS · ${num((r.awards||[]).length)} FOUND${(r.awards||[]).length>5?', FIRST 5 SHOWN':''}</p><ul class="stream-list brief-list">${aw||'<li class="state-note">No federal contract awards found for this exact name. That is not evidence of absence.</li>'}</ul>
  <p class="overline" style="margin-top:20px">NASA LITERATURE · ${num(cites.length)} FOUND, ${num(ver.length)} AFFILIATION-VERIFIED</p><ul class="stream-list brief-list">${ci||'<li class="state-note">No NASA technical reports cite this name.</li>'}</ul>
  <details><summary>Limits of these records</summary><ul class="brief-checks">${(r.caveats||[]).map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>${credit}`;
}
function postLinks(list){return (list||[]).map(c=>typeof c==='string'?{link:c}:c).filter(c=>safeLink(c.link)).map((c,i)=>`<blockquote>${c.text?esc(String(c.text).slice(0,600))+' ':''}<a href="${esc(c.link)}" rel="noopener noreferrer" target="_blank">source post ${i+1}</a></blockquote>`).join('')}
function renderAnswer(qa){
  const el=$('#b-answer');
  if(!qa||!(qa.findings||[]).length){el.innerHTML='<p class="state-note">No question-specific analysis has been generated for this question yet. The sections below show what the stored posts say, with sources. Nothing here is an answer to your question until it appears in this section.</p>';return}
  const lab={supports:'SUPPORTS',contradicts:'CONTRADICTS',context:'CONTEXT'};
  const bl=trimSentence(qa.bottomLine);
  el.innerHTML=(bl?`<p class="b-claim"><strong>${esc(bl)}</strong></p>`:'')+`<p class="state-note">Model inference from stored posts (${esc(qa.model||'a model')}${qa.generatedAt?', '+esc(day(qa.generatedAt)):''}${qa.coverage?', '+num(qa.coverage.analyzed||qa.coverage.read||0)+' posts read':''}). It is not independent verification, and quoted text is an excerpt from the stored post, so open the source post to check it.</p><ul class="stream-list brief-list">`+qa.findings.map(f=>`<li><p class="b-claim">${esc(f.text)}</p><p class="b-meta">${esc(lab[f.stance]||'FINDING')}</p>${f.cite&&f.cite.length?`<details open><summary>Cited posts</summary>${postLinks(f.cite)}</details>`:''}</li>`).join('')+'</ul>';
}
function renderStands(sig,terms){
  const el=$('#b-stands');
  const self=new Set([ticker.toLowerCase(),...words(NAMES[ticker]),...words(sig&&sig.company||''),...words((terms||[]).join(' ').replace(/\bOR\b/g,' '))]);
  const asp=(sig&&sig.topAspects||[]).filter(a=>(a.count||0)>=10&&!self.has(String(a.aspect).toLowerCase().trim()));
  if(!asp.length){el.innerHTML='<p class="state-note">Post analysis is not available yet, so nothing is ranked.</p>';return}
  const neg=a=>(a.negative||0)/(a.count||1),pos=a=>(a.positive||0)/(a.count||1);
  const by={customer:[...asp].sort((x,y)=>neg(y)-neg(x)),vendor:[...asp].sort((x,y)=>pos(y)-pos(x)),investor:[...asp].sort((x,y)=>Math.abs(y.negative-y.positive)-Math.abs(x.negative-x.positive)),scout:[...asp].sort((x,y)=>(y.count||0)-(x.count||0))}[role].slice(0,4);
  const head={customer:'Where the posts are most negative',vendor:'Where the posts are most positive',investor:'Where sentiment is most one-sided',scout:'What people talk about most'}[role];
  el.innerHTML=`<p class="overline">${esc(head).toUpperCase()}</p><ul class="stream-list brief-list">`+by.map(a=>`<li><p class="b-claim">${esc(a.aspect)}: ${num(a.negative)} negative and ${num(a.positive)} positive of ${num(a.count)} mentions (${Math.round(100*neg(a))}% negative)</p><p class="b-meta">COUNTS OF MODEL READINGS OF POSTS, NOT VERIFIED FACTS</p><details><summary>Example posts</summary>${postLinks(a.examples)}</details></li>`).join('')+'</ul>';
}
const getJSON=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
function fold(label,open){
  const sec=document.querySelector(`section[aria-label="${label}"]`);if(!sec||sec.querySelector(':scope>details.fold'))return;
  const head=sec.querySelector('.section-heading');if(!head)return;
  const d=document.createElement('details');d.className='fold';if(open)d.open=true;
  const sm=document.createElement('summary');sm.textContent=open?'Hide details':'Show details';
  d.addEventListener('toggle',()=>{sm.textContent=d.open?'Hide details':'Show details'});
  d.appendChild(sm);while(head.nextSibling)d.appendChild(head.nextSibling);sec.appendChild(d);
}
function pager(ul){
  if(!ul)return;const lis=[...ul.children];if(lis.length<=6)return;
  let shown=6;lis.forEach((li,i)=>{if(i>=6)li.hidden=true});
  const b=document.createElement('button');b.type='button';b.className='see-more';
  const upd=()=>{const left=lis.length-shown;if(left<=0){b.remove();return}b.textContent='See '+Math.min(6,left)+' more'};
  b.addEventListener('click',()=>{lis.slice(shown,shown+6).forEach(li=>{li.hidden=false});shown+=6;upd()});
  upd();ul.after(b);
}
async function load(){
  ['Post analysis','Closest stored claims','Second list','Compare','Evidence freshness','Related views'].forEach(l=>fold(l,false));
  fold('Public records',role==='vendor'||location.hash==='#public-records');
  $('#b-company').value=ticker;$('#b-role').value=role;
  $('#b-title').textContent=NAMES[ticker]+' brief';
  document.title=NAMES[ticker]+' brief · Company Evidence Index';
  $('#b-question').textContent=question;
  const L=LENS[role];$('#b-lens-label').textContent=(role+' question').toUpperCase();$('#b-lens-line').textContent=L.line;
  const links=[['/packs.html','Mentions','Every stored pack and its analysis for all five companies'],['/collection.html','Collection','Collection by source'],['/results.html','Results','Claims and coverage results'],['/report.html','Apple example (older seeded run, Apple only)','Illustrative decision brief from an earlier Apple run. Not this company and not this question.'],['/supplier.html','Standalone supplier lookup','Federal awards and NASA literature for any name you type']];
  $('#b-links').innerHTML=links.map(([h,t,d])=>`<li><a href="${h}">${t}</a><span>${esc(d)}</span></li>`).join('');
  const [pk,a,ans,sig,qa]=await Promise.all([getJSON('/api/packs'),getJSON('/api/analysis/'+ticker),getJSON(`/api/packs/${ticker}/questions`),getJSON(`/api/packs/${ticker}/signals`),getJSON(`/api/packs/${ticker}/answer?role=${encodeURIComponent(role)}&q=${encodeURIComponent(question)}`)]);
  const packs=(pk&&pk.packs)||[];const p=packs.find(x=>x.ticker===ticker);
  if(!p&&!a){$('#b-metrics').innerHTML='<p class="state-note state-error">No stored evidence found for '+esc(NAMES[ticker])+'. Nothing is substituted.</p>';return}
  renderSupplier(p?p.company:NAMES[ticker]);
  renderAnswer(qa);
  renderStands(sig,p&&p.terms);
  renderQuestions(ans);
  renderSignals(sig,p);
  pager(document.querySelector('#b-iq ul'));
  const claims=rank(a&&a.claims),counter=rank(a&&a.counterclaims);
  const order=L.first==='counter'?[['counter','Counterclaims in the posts','COUNTERCLAIMS',counter],['claim','Claims in the posts','CLAIMS',claims]]:[['claim','Claims in the posts','CLAIMS',claims],['counter','Counterclaims','COUNTERCLAIMS',counter]];
  [['first',order[0]],['second',order[1]]].forEach(([id,[kind,title,label,list]])=>{
    $('#b-'+id+'-label').textContent=label;$('#b-'+id+'-title').textContent=title;$('#b-'+id).innerHTML=items(list,kind,true);
  });
  pager($('#b-first'));pager($('#b-second'));
  $('#b-first-note').textContent=a?`Extracted by ${a.model} from ${num(a.inputItems)} sampled posts. Ordered by overlap with your question, then original order.`:'';
  $('#b-basis').textContent=a?a.basis:'No analysis has been stored for this company yet.';
  const srcs=(p&&p.sources)||[];
  $('#b-sources').textContent=srcs.length?'Collections on file: '+srcs.map(s=>`${s.source} (${num(s.collected)} added, prepared ${day(s.at)})`).join('; ')+'.':'';
  $('#b-metrics').innerHTML=metrics(p,a,null);
  $('#b-badges').innerHTML=`<span class="badge-dim">STORED EVIDENCE</span>${p?`<span class="badge-dim">PACK PREPARED ${esc(day(p.collectedAt))}</span>`:''}`;
  compare(packs,await Promise.all(Object.keys(NAMES).map(t=>t===ticker?a:getJSON('/api/analysis/'+t))),await Promise.all(Object.keys(NAMES).map(t=>t===ticker?sig:getJSON(`/api/packs/${t}/signals`))));
  // content dates, unique posts and platform mix come from the stored items
  const full=await getJSON('/api/packs/'+ticker);
  if(full&&full.items){
    const seen=new Set(),dates=[],plat={};
    full.items.forEach(i=>{const k=i.link||i.text;if(seen.has(k))return;seen.add(k);const d=new Date(i.date);if(!isNaN(d))dates.push(+d);const pl=i.platform||(/x\.com|twitter\.com/.test(i.link||'')?'x':'other');plat[pl]=(plat[pl]||0)+1});
    dates.sort((x,y)=>x-y);
    const info={unique:seen.size,from:dates.length?new Date(dates[0]).toISOString().slice(0,10):null,to:dates.length?new Date(dates[dates.length-1]).toISOString().slice(0,10):null,plat};
    $('#b-metrics').innerHTML=metrics(p,a,info);
    $('#b-fresh').textContent=`Pack prepared ${day(p.collectedAt)}. That is when the file was assembled, not when the posts were written. Post dates run ${info.from||'unknown'} to ${info.to||'unknown'}. Mix: ${Object.entries(plat).sort((x,y)=>y[1]-x[1]).map(([k,v])=>k+' '+num(v)).join(', ')}.`;
  }
}
function metrics(p,a,info){
  return [
    ['Posts stored (raw)',p?num(p.itemCount):'(none)',info?`${num(info.unique)} unique by link`:'counting unique posts'],
    ['Post dates',info&&info.from?(info.from.slice(0,4)===info.to.slice(0,4)?info.from.slice(5)+' to '+info.to.slice(5)+', '+info.to.slice(0,4):info.from+' to '+info.to):'(loading)','date range of the posts themselves'],
    ['Claims sample',a?num(a.inputItems):'(none)',a?`posts behind the claims below (${esc(a.model)}); post analysis has its own section`:'no sample stored'],
    ['Pack prepared',p?day(p.collectedAt):'(none)','when the file was assembled']
  ].map(([k,v,n])=>`<div class="metric"><p class="metric-label">${k}</p><p class="metric-number">${v}</p><p class="metric-note">${n}</p></div>`).join('');
}
function compare(packs,analyses,sigs){
  const rows=Object.keys(NAMES).map((t,i)=>{const p=packs.find(x=>x.ticker===t),a=analyses[i],sg=sigs&&sigs[i],st=sg&&sg.sentiment?Object.values(sg.sentiment).reduce((x,y)=>x+y,0):0;
    return `<tr class="${t===ticker?'is-current':''}"><td><a href="?c=${t}&role=${encodeURIComponent(role)}&q=${encodeURIComponent(question)}">${NAMES[t]}</a></td><td>${p?num(p.itemCount):'-'}</td><td>${p?(p.sources||[]).length:'-'}</td><td>${a?num(a.inputItems):'-'}</td><td>${a?(a.claims||[]).length+' / '+(a.counterclaims||[]).length:'-'}</td><td>${sg&&st?Math.round(100*sg.sentiment.negative/st)+'% neg / '+Math.round(100*sg.sentiment.positive/st)+'% pos':'not analysed'}</td><td>${p?day(p.collectedAt):'-'}</td></tr>`}).join('');
  $('#b-compare').innerHTML='<tr><th>COMPANY</th><th>POSTS STORED</th><th>COLLECTIONS</th><th>CLAIMS SAMPLE</th><th>CLAIMS / COUNTER</th><th>SENTIMENT (POSTS ANALYSED)</th><th>PACK PREPARED</th></tr>'+rows;
  if(role!=='scout')$('#b-compare-section').querySelector('h2').textContent='All five, for context';
}
$('#b-switch').addEventListener('change',()=>{
  const c=$('#b-company').value,r=$('#b-role').value;
  if(window.CEI_ROLE)window.CEI_ROLE.set(r);
  const keepQ=r===role?question:DEFQ[r];
  location.search='?'+new URLSearchParams({c,role:r,q:keepQ});
});
load();
