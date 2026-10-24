// Collection page: twelve live panels fetch real public data through the
// backend collectors; two remaining sources of the fixed set are shown with
// honest not-live states. Nothing here blends live and fixture data.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const row=(date,title,link,extra)=>`<li><span class="mono">${esc(date||'')}</span><span class="collect-item-title">${link?`<a class="detail-source" href="${esc(link)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title)}</span>${extra?`<span class="faint">${esc(extra)}</span>`:''}</li>`;
const std=i=>row((i.date||'').slice(0,10),i.title,i.link,i.outlet||(i.points!=null?i.points+' pts':'')||(i.rating?i.rating+'/5':''));
const RENDER={
  edgar:items=>items.map(i=>`<li><span class="mono">${esc(i.date)}</span><span class="collect-item-title">Form ${esc(i.form)} · ${esc(i.description||'filing')}</span><span class="mono faint">${esc(i.accession)}</span></li>`).join(''),
  wikipedia:items=>items.map(i=>row((i.date||'').slice(0,10),i.title,i.link,i.excerpt)).join('')
};
const WHAT={
  edgar:'Latest filings for CIK 0000320193 from the SEC submissions API.',
  newsroom:'Latest releases from the official Apple Newsroom feed.',
  news:'Top current headlines matching Apple Inc from Google News.',
  wikipedia:'Current summary of the Apple Inc. article from the Wikipedia REST API.',
  hackernews:'Current Apple stories on Hacker News via the Algolia API.',
  hncomments:'Recent public Hacker News comments mentioning Apple - public commentary, not official statements.',
  macrumors:'Latest Apple coverage from the MacRumors RSS feed.',
  ninetofive:'Latest Apple coverage from the 9to5Mac RSS feed.',
  verge:'Latest stories from The Verge\u2019s feed.',
  itunes:'Apple-published apps from the iTunes Search API.',
  reviews:'Most recent App Store reviews of GarageBand, an Apple app.',
  xbrl:'Reported annual revenue for Apple from the SEC XBRL company concept API.',
  pageviews:'Daily views of the Apple Inc. Wikipedia article from the Wikimedia API.'
};
const ORDER=['edgar','newsroom','news','wikipedia','hackernews','hncomments','macrumors','ninetofive','verge','itunes','reviews','xbrl','pageviews'];
const REST={sources:[
 {name:'OpenSecrets',note:'Requires an API key; no keyless public route, so no live panel in this build.'},
 {name:'Google Patents',note:'No public feed; HTML scraping blocked from this host, so no live panel in this build.'}
]};
const NAMES={edgar:'SEC EDGAR filings',newsroom:'Apple Newsroom',news:'Google News',wikipedia:'Wikipedia',hackernews:'Hacker News',hncomments:'HN comments (public)',macrumors:'MacRumors',ninetofive:'9to5Mac',verge:'The Verge',itunes:'Apple on the App Store',reviews:'App Store reviews',xbrl:'SEC XBRL facts',pageviews:'Wikipedia pageviews'};
function card(inner,cls){return `<article class="collect-card ${cls||''}">${inner}</article>`}
async function boot(){
  const wrap=document.querySelector('#collect-live');
  const results=await Promise.all(ORDER.map(async key=>{
    try{return{key,data:await fetch(`/api/companies/apple/collect/${key}`).then(r=>r.json())}}
    catch(e){return{key,data:{mode:'unavailable',detail:String(e),items:[]}}}
  }));
  const liveCount=results.filter(r=>r.data.mode==='live').length;
  document.querySelector('#collect-count').textContent=`${liveCount} OF 13 SOURCES REPORTING LIVE`;
  wrap.innerHTML=results.map(({key,data})=>card(`
    <div class="collect-head"><h2>${NAMES[key]}</h2><span class="collect-badge ${data.mode==='live'?'live':'down'}">${data.mode==='live'?'LIVE':'UNAVAILABLE'}</span></div>
    <p class="side-copy">${WHAT[key]}</p>
    ${data.mode==='live'?`<p class="small-note">Fetched ${new Date(data.fetchedAt).toUTCString().slice(17,25)} UTC from ${esc(data.source)}${data.cached?' (cached 10 min)':''}.</p><ul class="collect-list">${(RENDER[key]||(it=>it.map(std).join('')))(data.items)}</ul>`
      :`<p class="small-note">Live fetch failed${data.detail?`: ${esc(data.detail)}`:''}. No data is substituted.</p>`}
    <p class="collect-feeds">Feeds the coverage panel and claim evidence chains on the <a class="detail-source" href="/">company ledger</a>.</p>`)).join('');
  document.querySelector('#collect-rest').innerHTML=REST.sources.map(s=>card(`
    <div class="collect-head"><h2>${s.name}</h2><span class="collect-badge demo">NOT LIVE</span></div>
    <p class="side-copy">${s.note}</p>`,'muted')).join('');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
