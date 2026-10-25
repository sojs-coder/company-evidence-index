// One chronological stream of real public data, with explicit source gaps.
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const row=({date,source,title,link,extra='',status='live'})=>`<li class="collection-line"><span class="collection-date">${esc(date||'—')}</span><span class="collection-source" title="${esc(source)}">${esc(source)}</span><span class="collection-title" title="${esc(title)}">${link?`<a class="detail-source" href="${esc(link)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title)}</span><span class="collection-status ${status}" title="${esc(extra)}">${esc(extra||'LIVE')}</span></li>`;
const ORDER=['edgar','newsroom','news','wikipedia','hackernews','hncomments','macrumors','ninetofive','verge','itunes','reviews','xbrl','pageviews'];
const REST={sources:[
 {name:'OpenSecrets',note:'Requires an API key; no keyless public route in this build.'},
 {name:'Google Patents',note:'No public feed; HTML scraping blocked from this host.'}
]};
const NAMES={edgar:'SEC EDGAR filings',newsroom:'Apple Newsroom',news:'Google News',wikipedia:'Wikipedia',hackernews:'Hacker News',hncomments:'HN comments (public)',macrumors:'MacRumors',ninetofive:'9to5Mac',verge:'The Verge',itunes:'Apple on the App Store',reviews:'App Store reviews',xbrl:'SEC XBRL facts',pageviews:'Wikipedia pageviews'};
async function boot(){
  const wrap=document.querySelector('#collect-live');
  const results=await Promise.all(ORDER.map(async key=>{
    try{
      const response=await fetch(`/api/companies/apple/collect/${key}`);
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return{key,data:await response.json()};
    }
    catch(e){return{key,data:{mode:'unavailable',detail:String(e),items:[]}}}
  }));
  const liveCount=results.filter(r=>r.data.mode==='live').length;
  document.querySelector('#collect-count').textContent=`${liveCount} OF ${ORDER.length} SOURCES REPORTING LIVE`;
  const entries=[],gaps=[];
  for(const {key,data} of results){
    const source=NAMES[key];
    if(data.mode!=='live'){
      gaps.push({source,title:`Live fetch failed${data.detail?`: ${data.detail}`:''}. No data is substituted.`,extra:'UNAVAILABLE',status:'down'});
      continue;
    }
    if(!data.items.length)gaps.push({source,title:'Source returned no items.',extra:'EMPTY',status:'empty'});
    for(const item of data.items){
      const timestamp=Date.parse(item.date);
      entries.push({
        timestamp:Number.isFinite(timestamp)?timestamp:-Infinity,
        date:Number.isFinite(timestamp)?new Date(timestamp).toISOString().slice(0,10):'',
        source,
        title:key==='edgar'?`Form ${item.form} · ${item.description||'filing'}`:item.title,
        link:item.link,
        extra:item.outlet||(item.points!=null?`${item.points} pts`:'')||(item.rating?`${item.rating}/5`:'')||item.accession||'',
      });
    }
  }
  entries.sort((a,b)=>b.timestamp-a.timestamp);
  wrap.innerHTML=[...entries,...gaps,...REST.sources.map(s=>({source:s.name,title:s.note,extra:'NOT LIVE',status:'empty'}))].map(row).join('');
  wrap.setAttribute('aria-busy','false');
}
document.querySelector('.theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#02205e':'#f5f4f4'});
boot();
