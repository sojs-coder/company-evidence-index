import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../results.js',import.meta.url),'utf8');
const claim={
  id:'CL-0039',status:'contradicted',claim:'A claim <with> "quotes"',
  for:'Evidence & context',against:'Limits <apply>',
  source:'Example source',date:'Sep 09, 2026',citation:'https://example.com/?a=1&b=2'
};

async function load(claims,{offline=false}={}){
  const elements=new Map();
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{innerHTML:'',addEventListener(){}});
    return elements.get(selector);
  };
  const context=vm.createContext({
    document:{querySelector:element},
    fetch:async url=>{
      if(offline)throw new Error('offline');
      return {json:async()=>url.endsWith('/claims')?{claims}:url.endsWith('/coverage')?{sources:[]}:{mode:'unavailable'}};
    }
  });
  vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  return elements;
}

test('results render compact semantic tables for both claim statuses',async()=>{
  const elements=await load([claim,{...claim,id:'CL-0040',status:'unresolved'}]);
  for(const status of ['contradicted','unresolved']){
    const html=elements.get(`#results-${status}`).innerHTML;
    assert.match(html,/<table class="results-table">/);
    assert.equal((html.match(/scope="col"/g)||[]).length,5);
    assert.match(html,/<th scope="row">/);
    assert.match(html,new RegExp(`class="status ${status}"`));
    assert.match(html,/A claim &lt;with&gt; &quot;quotes&quot;/);
    assert.match(html,/Evidence &amp; context/);
    assert.match(html,/Limits &lt;apply&gt;/);
    assert.match(html,/href="https:\/\/example.com\/\?a=1&amp;b=2"/);
    assert.match(html,/target="_blank" rel="noreferrer"/);
    assert.match(html,/Sep 09, 2026/);
    assert.doesNotMatch(html,/<article/);
  }
  assert.doesNotMatch(elements.get('#results-contradicted').innerHTML,/CL-0040/);
});

test('empty categories show an explicit empty state rather than a blank table',async()=>{
  const elements=await load([]);
  for(const status of ['contradicted','unresolved']){
    const html=elements.get(`#results-${status}`).innerHTML;
    assert.match(html,/No claims in this category/);
    assert.doesNotMatch(html,/<table/);
  }
});

test('API failures retain the unavailable message without substituting claims',async()=>{
  const elements=await load([],{offline:true});
  assert.match(elements.get('#results-contradicted').innerHTML,/demo API is unavailable/);
});
