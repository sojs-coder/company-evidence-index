import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../vet.js',import.meta.url),'utf8');
const seed=JSON.parse(await readFile(new URL('../data/public-companies-seed.json',import.meta.url),'utf8'));

async function load(fetch,role){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      textContent:'',children:[],value:'',
      addEventListener(){},
      replaceChildren(...children){this.children=children;}
    });
    return elements.get(id);
  };
  const context=vm.createContext({
    window:{CEI_ROLE:{get:()=>typeof role==='function'?role():role}},
    localStorage:{getItem(){return null;}},
    document:{
      querySelector:element,
      getElementById:element,
      createElement(){return {};}
    },
    fetch
  });
  vm.runInContext(script,context);
  // Await the initialization's fetch and JSON microtasks.
  await new Promise(resolve=>setImmediate(resolve));
  return {elements,context};
}

test('company suggestions use the existing seed with names as selected values and ticker labels',async()=>{
  const {elements}=await load(async url=>{
    assert.equal(url,'/data/public-companies-seed.json');
    return {ok:true,json:async()=>seed};
  });
  const options=elements.get('vet-companies').children;
  assert.equal(options.length,new Set(seed.companies.map(c=>c.name)).size);
  assert.equal(options.find(o=>o.value==='Apple Inc.').label,'AAPL');
  assert.equal(options.filter(o=>o.value==='Alphabet Inc.').length,1);
  assert.match(options.find(o=>o.value==='Alphabet Inc.').label,/GOOGL/);
  assert.match(options.find(o=>o.value==='Alphabet Inc.').label,/GOOG/);
  assert.equal(elements.get('vet-company-status').textContent,'');
});

test('suggestion failures leave free-text search available and show an honest status',async()=>{
  for(const fetch of [
    async()=>{throw new Error('offline');},
    async()=>({ok:false,status:404}),
    async()=>({ok:true,json:async()=>({})})
  ]){
    const {elements}=await load(fetch);
    assert.match(elements.get('vet-company-status').textContent,/still type any company name/);
  }
});

test('vet form does not ask for a separate decision',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/vet-category|Decision \(optional\)/);
});

test('report category follows the current lens without a decision field',async()=>{
  for(const [role,category] of [
    ['customer','supplier'],['vendor','vendor'],['investor','invest'],
    ['scout','general'],['','general'],['unknown','general']
  ]){
    let activeRole='customer';
    let reportUrl;
    const {elements,context}=await load(async url=>{
      if(url==='/data/public-companies-seed.json')return {ok:true,json:async()=>seed};
      reportUrl=url;
      // Stop after capturing the request; no live evidence sources are needed.
      return {ok:false,status:503};
    },()=>activeRole);
    activeRole=role;
    await vm.runInContext("report({kind:'custom',name:'Example Inc.'})",context);
    assert.equal(new URL(reportUrl,'http://localhost').searchParams.get('category'),category);
    assert.equal(elements.has('vet-category'),false);
  }
});
