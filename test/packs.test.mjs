import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../packs.js', import.meta.url), 'utf8');
const packs = [
  { ticker:'AAPL', company:'Apple <Inc>', itemCount:7000, sources:[], collectedAt:'2026-10-25' },
  { ticker:'MSFT', company:'Microsoft', itemCount:2834, sources:[], collectedAt:'2026-10-25' }
];
const signal = {
  model:'test-model', basis:'Model readings, not verified facts.', generatedAt:'2026-10-25',
  coverage:{ analyzed:2333, collected:2834, dupes:5, noText:496 },
  sentiment:{ positive:387, mixed:52, neutral:1152, negative:742 },
  topAspects:[{ aspect:'cloud', count:100, positive:20, negative:30 }]
};

async function render(data=packs, hasSignals=true) {
  const buttons = data.map(p=>({
    dataset:{ ticker:p.ticker }, attributes:{}, handlers:{},
    setAttribute(k,v) { this.attributes[k]=v; },
    addEventListener(k,fn) { this.handlers[k]=fn; }
  }));
  const panels = data.map((p,i)=>({ dataset:{company:p.ticker}, hidden:i!==0 }));
  const wrap = {
    innerHTML:'', attributes:{},
    setAttribute(k,v) { this.attributes[k]=v; },
    querySelectorAll(s) { return s==='.company-option'?buttons:panels; }
  };
  const count = {};
  const listeners = {};
  const context = {
    document:{
      querySelector(s) { return s==='#packs-live'?wrap:s==='#packs-count'?count:null; },
      addEventListener(k,fn) { listeners[k]=fn; }
    },
    window:{ CEI_ROLE:{get:()=> 'scout'} },
    fetch:async path=>({
      ok:hasSignals,
      json:async()=>path==='/api/packs'?{packs:data}:path==='/api/analysis'?{analysis:[]}:signal
    })
  };
  // Invoke boot explicitly so the async render is fully awaited.
  const script = source.replace('\nboot();\nbootCrs();', '\n');
  await runInNewContext(`${script}\nboot();`, context);
  return { wrap, count, buttons, panels, listeners };
}

test('mentions render a selected workspace with coverage, provenance and escaped names', async()=>{
  const {wrap,count,listeners}=await render();
  assert.equal(wrap.attributes['aria-busy'],'false');
  assert.equal(count.textContent,'2 company packs · 9,834 collected posts');
  assert.match(wrap.innerHTML,/Apple &lt;Inc&gt;/);
  assert.match(wrap.innerHTML,/data-company="MSFT" hidden/);
  assert.match(wrap.innerHTML,/2,333/);
  assert.match(wrap.innerHTML,/Sources &amp; coverage/);
  assert.match(wrap.innerHTML,/Model readings, not verified facts/);
  assert.match(wrap.innerHTML,/AI synthesis not yet generated/);
  assert.equal(typeof listeners['cei-role'],'function');
});

test('company selection changes the visible detail and pressed state', async()=>{
  const {buttons,panels}=await render();
  buttons[1].handlers.click();
  assert.equal(buttons[0].attributes['aria-pressed'],'false');
  assert.equal(buttons[1].attributes['aria-pressed'],'true');
  assert.equal(panels[0].hidden,true);
  assert.equal(panels[1].hidden,false);
});

test('empty collection clears loading and offers an honest retry message', async()=>{
  const {wrap,count}=await render([]);
  assert.equal(wrap.attributes['aria-busy'],'false');
  assert.equal(count.textContent,'0 company packs · 0 collected posts');
  assert.match(wrap.innerHTML,/empty or unavailable/);
  assert.match(wrap.innerHTML,/Reload to try again/);
});

test('missing signals stay unavailable instead of becoming zero-valued analysis', async()=>{
  const {wrap}=await render(packs,false);
  assert.match(wrap.innerHTML,/Sentiment analysis is not available/);
  assert.match(wrap.innerHTML,/<strong>—<\/strong><span>Analyzed posts/);
  assert.doesNotMatch(wrap.innerHTML,/class="sig-bar"/);
});
