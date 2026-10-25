import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../report.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(script.replace(/\nboot\(\);?\s*$/,''),context);
const render=aspects=>context.renderAspectSentiment(aspects);

test('claim cards pair primary support and flagged conflicts without promoting wording matches',()=>{
  const html=context.renderClaimCards({
    figureChecks:[{claim:'FY2025 revenue $100B',basis:'SEC XBRL',date:'2025-09-30',link:'https://sec.gov/filing',passages:[{title:'Revenue coverage',source:'Press',excerpt:'$100B'}]}],
    headlineChecks:[{claim:'<Launch> is available',basis:'Apple Newsroom',link:'https://apple.com/newsroom',passages:[
      {title:'Launch announcement',wording:'echo',source:'Press'},
      {title:'Launch delayed',tension:true,excerpt:'Not available yet',source:'Other press'}
    ]}]
  });
  assert.match(html,/Supporting evidence/);
  assert.match(html,/Conflicting evidence/);
  assert.match(html,/On the SEC record/);
  assert.match(html,/Potential tension/);
  assert.match(html,/not a confirmed contradiction/);
  assert.match(html,/Wording matches show relevance, not independent verification/);
  assert.match(html,/same origin possible/);
  assert.match(html,/&lt;Launch&gt;/);
  assert.match(html,/href="https:\/\/sec.gov\/filing"/);
  assert.match(html,/What to verify next/);
  assert.doesNotMatch(html,/insufficient evidence/i);
});

test('claim cards give concrete follow-up for unmatched statements and figure mismatches',()=>{
  const html=context.renderClaimCards({
    headlineChecks:[{claim:'New product',basis:'Newsroom',passages:[]}],
    contradictions:[{claim:'Different annual revenue',passages:[{title:'Revenue report',excerpt:'Annual sales $90B'}]}]
  });
  assert.match(html,/Check independent reporting and subsequent disclosures/);
  assert.match(html,/Compare period & metric/);
  assert.match(html,/Annual sales \$90B/);
  assert.match(html,/period, metric, and units/);
  assert.doesNotMatch(html,/insufficient evidence/i);
});

test('risk cards connect coverage to the actual filing and separate interpretation from occurrence',()=>{
  const cue={title:'Supply shortage',source:'Press',link:'https://example.com/story',date:'2026-01-01',cue:'shortage'};
  const risk={title:'Manufacturing and supply risks',category:'Business',date:'2025-09-30',link:'https://sec.gov/risk'};
  const html=context.renderRiskCards({riskCues:[cue],riskFactors:[risk],riskCross:[{cue,risk,group:'supply chain and manufacturing'}]});
  assert.equal((html.match(/class="finding-card"/g)||[]).length,1);
  assert.match(html,/Why it matters/);
  assert.match(html,/What other evidence says/);
  assert.match(html,/availability, costs, and delivery timing/);
  assert.match(html,/href="https:\/\/sec.gov\/risk"/);
  assert.match(html,/topic match does not establish that the reported event occurred/);
  assert.match(html,/Interpretation \/ business context/);
});

test('unmatched mentions and disclosure-only risks keep actionable next checks',()=>{
  const html=context.renderRiskCards({
    riskCues:[{title:'Complaint <reported>',cue:'complaint',source:'Forum'}],
    riskFactors:[{title:'Legal exposure',category:'Legal',link:'https://sec.gov/legal'}]
  });
  assert.match(html,/Complaint &lt;reported&gt;/);
  assert.match(html,/Trace this report to its original source/);
  assert.match(html,/Company-disclosed exposure/);
  assert.match(html,/not a finding that the risk has occurred/);
  assert.match(html,/Look for a dated event/);
  assert.doesNotMatch(html,/insufficient evidence/i);
  assert.match(context.renderRiskCards(),/Next check:/);
  assert.match(context.renderClaimCards(),/Next check:/);
});

test('takeaways cite filed growth and surface risk follow-ups',()=>{
  const html=context.renderTakeaways({
    deltas:[{metric:'Revenue',pct:'5.0',prev:'$100B',cur:'$105B'}],
    fundamentals:[{rows:{Revenue:{link:'https://sec.gov/revenue'}}}],
    riskCues:[{title:'Risk'}]
  });
  assert.match(html,/Revenue: \+5.0% year over year/);
  assert.match(html,/href="https:\/\/sec.gov\/revenue"/);
  assert.match(html,/href="#risks"/);
});

test('report reads findings before reference and retains the load-more control',async()=>{
  const html=await readFile(new URL('../report.html',import.meta.url),'utf8');
  const ids=['takeaways','questions','risks','reference','evidence-stream'];
  for(let i=1;i<ids.length;i++)assert.ok(html.indexOf(`id="${ids[i-1]}"`)<html.indexOf(`id="${ids[i]}"`));
  assert.match(html,/aria-controls="evidence-stream">Load more/);
  assert.doesNotMatch(html,/id="coverage-score"/);
  const allIds=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
  assert.equal(new Set(allIds).size,allIds.length);
});

test('report boot populates the new layout and preserves stream pagination',async()=>{
  const html=await readFile(new URL('../report.html',import.meta.url),'utf8');
  const elements=Object.fromEntries(Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>[m[1],{
    innerHTML:'',textContent:'',classList:{remove(){}},removeAttribute(){},
    insertAdjacentHTML(position,content){this.innerHTML+=content}
  }]));
  const button={};
  elements['evidence-stream-more'].querySelector=()=>button;
  const document={
    querySelector(selector){assert.ok(elements[selector.slice(1)],`Missing report element ${selector}`);return elements[selector.slice(1)]},
    getElementById:id=>elements[id],querySelectorAll:()=>[]
  };
  const response={
    sources:[{key:'news',name:'Press',itemCount:25,items:Array.from({length:25},(_,i)=>({title:`Item ${i+1}`,date:`2026-01-${String(i+1).padStart(2,'0')}`}))}],
    analysis:{perSource:[]},
    diligence:{fundamentals:[],deltas:[],riskCues:[{title:'Supply shortage',source:'Press',cue:'shortage'}],labels:{}},
    validation:{figureChecks:[],headlineChecks:[{claim:'Product launch',basis:'Newsroom',passages:[]}],method:'Extractive matching'}
  };
  const ctx=vm.createContext({document,window:{},fetch:async url=>({ok:true,json:async()=>url.startsWith('/api/')?response:null})});
  vm.runInContext(script.replace(/\nboot\(\);?\s*$/,''),ctx);
  await ctx.boot();
  assert.match(elements['key-takeaways'].innerHTML,/risk mentions to investigate/);
  assert.match(elements['claim-checks'].innerHTML,/Product launch/);
  assert.match(elements['risk-findings'].innerHTML,/Supply shortage/);
  assert.equal(elements['check-method'].textContent,'Extractive matching');
  assert.equal((elements['evidence-stream'].innerHTML.match(/class="stream-src"/g)||[]).length,12);
  assert.ok(elements['evidence-stream'].innerHTML.indexOf('Item 25')<elements['evidence-stream'].innerHTML.indexOf('Item 24'));
  button.onclick();
  assert.equal((elements['evidence-stream'].innerHTML.match(/class="stream-src"/g)||[]).length,24);
  button.onclick();
  assert.equal(elements['evidence-stream-more'].hidden,true);
});

test('failed analysis clears loading states in both findings sections',()=>{
  const elements={};
  const ctx=vm.createContext({document:{querySelector:selector=>elements[selector]??=( {innerHTML:''} )}});
  vm.runInContext(script.replace(/\nboot\(\);?\s*$/,''),ctx);
  ctx.failAll('Retry collection');
  assert.match(elements['#key-takeaways'].innerHTML,/<li .*Retry collection/);
  assert.match(elements['#risk-findings'].innerHTML,/state-error/);
  assert.match(elements['#claim-checks'].innerHTML,/Retry collection/);
});

function evidenceStream(count){
  const list={innerHTML:'',insertAdjacentHTML(position,html){assert.equal(position,'beforeend');this.innerHTML+=html}};
  const button={};
  const more={hidden:true,querySelector:()=>button};
  const document={querySelector:selector=>({'#evidence-stream':list,'#evidence-stream-more':more}[selector])};
  const ctx=vm.createContext({document});
  vm.runInContext(script.replace(/\nboot\(\);?\s*$/,''),ctx);
  ctx.renderEvidenceStream(Array.from({length:count},(_,i)=>({src:'Source',title:`Item ${i+1}`,date:'2026-01-01',link:'',relevance:''})));
  return {list,button,more};
}

test('evidence stream appends twelve items per click without the old forty-item cap',()=>{
  const {list,button,more}=evidenceStream(41);
  const rows=()=>Array.from(list.innerHTML.matchAll(/class="collect-item-title">Item (\d+)</g),m=>Number(m[1]));
  for(const count of [12,24,36,41]){
    assert.deepEqual(rows(),Array.from({length:count},(_,i)=>i+1));
    assert.equal(more.hidden,count===41);
    if(count<41)button.onclick();
  }
});

test('evidence stream hides load more for empty, short, and exact pages',()=>{
  for(const count of [0,5,12,24]){
    const {list,button,more}=evidenceStream(count);
    assert.equal(more.hidden,count<=12);
    if(count===0)assert.match(list.innerHTML,/No collected items this run/);
    if(count===24){
      button.onclick();
      assert.equal(more.hidden,true);
    }
    assert.equal((list.innerHTML.match(/class="stream-src"/g)||[]).length,count);
  }
});

test('aspect bars share a centered scale and include neutral counts in accessible text',()=>{
  const html=render([{aspect:'price',count:100,negative:45,neutral:30,positive:25}]);
  assert.match(html,/class="aspect-negative-bar" x="275" y="9" width="225"/);
  assert.match(html,/class="aspect-positive-bar" x="500" y="9" width="125"/);
  assert.match(html,/viewBox="0 0 1000 40"/);
  assert.match(html,/class="aspect-zero" d="M500 0V40"/);
  assert.match(html,/45 negative, 30 neutral, 25 positive/);
  assert.match(html,/Net sentiment -20 percentage points/);
  assert.match(html,/tabindex="0"/);
  assert.match(html,/100 mentions/);
});

test('100 percent shares reach the ends of the same fixed axis',()=>{
  const html=render([
    {aspect:'Negative',count:10,negative:10,neutral:0,positive:0},
    {aspect:'Positive',count:10,negative:0,neutral:0,positive:10}
  ]);
  assert.match(html,/class="aspect-negative-bar" x="0" y="9" width="500"/);
  assert.match(html,/class="aspect-positive-bar" x="500" y="9" width="500"/);
  assert.match(html,/Net sentiment -100 percentage points/);
  assert.match(html,/Net sentiment \+100 percentage points/);
});

test('net sentiment shows direction and empty or all-neutral data stays finite',()=>{
  const html=render([{aspect:'<Display>',count:10,negative:1,neutral:2,positive:7}]);
  assert.match(html,/Net sentiment \+60 percentage points/);
  assert.match(html,/&lt;Display&gt;/);
  const zero=render([{aspect:'Empty',count:0,negative:0,neutral:0,positive:0}]);
  assert.doesNotMatch(zero,/NaN|Infinity/);
  const neutral=render([{aspect:'Neutral',count:10,negative:0,neutral:10,positive:0}]);
  assert.match(neutral,/Net sentiment 0 percentage points/);
  assert.match(render([]),/No matching aspects/);
});

test('historical snapshot renders the same top ten aspects with correct net shares',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../data/signalor-apple-mentions.json',import.meta.url),'utf8'));
  const html=render(snapshot.aspects.slice(0,10));
  assert.equal((html.match(/<li class="aspect-sentiment-row">/g)||[]).length,10);
  assert.match(html,/Net sentiment -30 percentage points/);
  assert.match(html,/Net sentiment \+60 percentage points/);
});
