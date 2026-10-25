import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../vet.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(script.slice(0,script.indexOf('loadCompanySuggestions();')),context);
const render=(r,category='general')=>context.decisionBrief(r,category);
const report=()=>({
  identity:{kind:'public_company'},
  answer:{quotedEvidence:[]},
  findings:[],
  sources:[],
  conflictChecks:[]
});

test('missing answers are explicit and background records do not become a verdict',()=>{
  const r=report();
  r.findings=[{topic:'federal_awards'}];
  const html=render(r);
  assert.match(html,/Your question remains unverified/);
  assert.match(html,/not a substitute for an answer/);
  assert.match(html,/Obtain a primary source/);
  assert.doesNotMatch(html,/GENERATED READING/);
});

test('brief separates generated interpretation and preserves warnings and escaping',()=>{
  const r=report();
  r.synthesis={
    content:{summary:'<script>unsafe</script> A $5m contract'},
    partial:true,
    amountCheck:{flagged:['$5m']},
    sourcesChecked:[{reachable:false}]
  };
  const html=render(r);
  assert.match(html,/GENERATED READING \/ NOT VERIFIED/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/analysis is partial/);
  assert.match(html,/unqualified financial figures/);
  assert.match(html,/could not be confirmed reachable/);
});

test('next steps reflect identity, conflicts, collection failures and active lens',()=>{
  const r=report();
  r.identity.kind='custom';
  r.sources=[{mode:'not_configured'}];
  let html=render(r,'supplier');
  assert.match(html,/Confirm the legal entity/);
  assert.match(html,/1 collection steps unavailable or skipped/);
  assert.match(html,/customer references/);
  r.conflictChecks=[{finding:'domain drift'}];
  r.answer.quotedEvidence=[{passage:'source text'}];
  html=render(r,'invest');
  assert.match(html,/1 quoted passages collected/);
  assert.match(html,/Resolve the flagged name or domain conflicts/);
  assert.match(html,/current filings/);
  assert.doesNotMatch(html,/Obtain a primary source/);
});

test('raw records and evidence are available through native disclosure controls',async()=>{
  const html=await readFile(new URL('../vet-custom.html',import.meta.url),'utf8');
  for(const id of ['awards-panel','citations-panel','sources-panel']){
    assert.match(html,new RegExp(`<details[^>]+id="${id}"[^>]+hidden>`));
  }
  assert.match(html,/<summary>Inspect source evidence/);
  assert.match(html,/id="decision-brief" aria-live="polite"/);
});

test('report renders failures honestly and does not duplicate affiliation matches',async()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'Can they deliver?',innerHTML:'',textContent:'',open:true});
    return elements.get(id);
  };
  const r=report();
  Object.assign(r,{
    answer:{quotedEvidence:[],limitations:[]},
    caveats:[],
    sources:[{key:'usaspending',name:'Awards',url:'https://example.com',mode:'error'}],
    citations:[{
      title:'Unique technical record',
      sourceUrl:'https://example.com/paper',
      association:{state:'author_affiliation_orgname_match',organizations:['Example']}
    }]
  });
  const ctx=vm.createContext({
    window:{CEI_ROLE:{get:()=> 'customer'}},
    document:{getElementById:element,querySelector:selector=>element(selector.slice(1))},
    fetch:async()=>({ok:true,json:async()=>r})
  });
  vm.runInContext(script.slice(0,script.indexOf('loadCompanySuggestions();')),ctx);
  await vm.runInContext("report({kind:'custom',name:'Example'})",ctx);
  assert.match(element('decision-brief').innerHTML,/customer references/);
  assert.match(element('awards').innerHTML,/unavailable for this run/);
  assert.doesNotMatch(element('awards').innerHTML,/No federal contract awards/);
  assert.equal((element('citations').innerHTML.match(/Unique technical record/g)||[]).length,1);
  assert.equal(element('awards-panel').open,false);
});
