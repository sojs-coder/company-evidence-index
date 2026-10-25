// Supplier vetting evidence pack: live fetch from the backend, honest states.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null?'(not recorded)':'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
if(localStorage.getItem('cei-theme')==='dark'){document.documentElement.dataset.theme='dark';document.querySelector('meta[name="theme-color"]').content='#02205e'}
const themeBtn=document.querySelector('.theme-toggle');
themeBtn&&themeBtn.addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('cei-theme',dark?'dark':'light');document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
function state(el,msg,err){document.querySelector(el).innerHTML=`<p class="state-note${err?' state-error':''}">${esc(msg)}</p>`}
async function vet(name){
  state('#awards','Fetching live USASpending records. Nothing is substituted.');
  state('#citations','Fetching live NASA citations.');
  document.getElementById('award-count').textContent='';
  document.getElementById('citation-count').textContent='';
  let r;
  try{r=await fetch('/api/vet/supplier?name='+encodeURIComponent(name)).then(x=>{if(!x.ok)throw new Error('HTTP '+x.status);return x.json()})}
  catch(e){state('#awards','The lookup failed ('+(e.message||e)+'). Nothing is substituted.',true);state('#citations','Not attempted after the failure.',true);return}
  document.getElementById('run-stamp').textContent='FETCHED '+new Date(r.fetchedAt).toUTCString().slice(17,25)+' UTC';
  document.getElementById('award-count').textContent=r.awards.length+' RECORDS';
  document.getElementById('citation-count').textContent=r.citations.length+' CITATIONS';
  document.getElementById('awards').innerHTML=r.awards.length
    ?'<ul class="collect-list">'+r.awards.map(a=>`<li><span class="collect-item-title">${a.sourceUrl?`<a class="detail-source" href="${esc(a.sourceUrl)}" target="_blank" rel="noreferrer">${esc(a.description||a.awardId||'(untitled award)')}</a>`:esc(a.description||'(untitled award)')}</span><span class="faint">${esc([a.agency,a.startDate,money(a.obligatedAmountUsd)].filter(Boolean).join(' · '))}</span></li>`).join('')+'</ul>'
    :'<p class="state-note">No federal contract awards found for this exact name. That is not evidence of absence - try name variants.</p>';
  document.getElementById('citations').innerHTML=r.citations.length
    ?'<ul class="collect-list">'+r.citations.map(c=>`<li><span class="collect-item-title">${c.sourceUrl?`<a class="detail-source" href="${esc(c.sourceUrl)}" target="_blank" rel="noreferrer">${esc(c.title)}</a>`:esc(c.title)}</span></li>`).join('')+'</ul>'
    :'<p class="state-note">No NASA technical reports cite this name.</p>';
  document.getElementById('caveats').innerHTML='<ul class="collect-list">'+r.caveats.map(c=>`<li><span class="collect-item-title">${esc(c)}</span></li>`).join('')+'</ul>';
  document.getElementById('connectors').innerHTML='<ul class="collect-list">'+r.plannedConnectors.map(c=>`<li><span class="collect-item-title">${esc(c.key)} <span class="badge-dim">${esc(c.state)}</span></span><span class="faint">${esc(c.detail)}</span></li>`).join('')+'</ul>';
}
document.getElementById('vet-form').addEventListener('submit',e=>{e.preventDefault();const n=document.getElementById('vet-name').value.trim();if(n)vet(n)});
