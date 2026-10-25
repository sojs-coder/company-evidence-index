import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../packs.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../packs.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../mentions.css', import.meta.url), 'utf8');

test('mentions inherit the shared page shell and theme tokens', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="theme-color" content="#f5f4f4"/);
  assert.match(html, /href="cal-hacks-tokens\.css\?v=\d+"/);
  assert.match(html, /href="styles\.css\?v=\d+"/);
  assert.match(html, /class="hero">\s*<h1>Public mentions<\/h1>/);
  assert.match(html, /class="snapshot-banner" role="note"/);
  assert.doesNotMatch(html, /data-(?:default-theme|dark-color|light-color)/);
  // Local CSS must compose the workspace, not create another design system.
  assert.doesNotMatch(css, /--[\w-]+\s*:/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\.mentions-page\s+(?:main|\.topbar|\.hero|\.small-note)\s*\{/);
});

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

// CRS panel renders the new backend shape (crs-credit-evidence.mjs):
// { ok, demonstration, label, evidence } - not the retired scoreSummary/
// billable/sections envelope.
const crsDemo = {
  ok:true, demonstration:true, config:'exp-prequal-vantage4',
  label:'Principal credit check demonstrated on the CRS sponsor <sandbox> synthetic test persona. Not business credit.',
  evidence:{
    score:{ model:'VantageScore 4.0', value:790, minimum:300, maximum:850, percentile:71 },
    tradelines:{ count:12, openCount:8, balanceTotal:18400, pastDueTotal:0, revolvingUtilizationPercent:8 },
    riskFlags:[{ flag:'no_derogatory_marks_in_file' }]
  }
};
async function renderCrs(payload) {
  const wrap = { innerHTML:'' };
  const context = {
    document:{ querySelector(s) { return s==='#crs-live'?wrap:null; }, addEventListener(){} },
    window:{},
    fetch:async()=>({ json:async()=>payload })
  };
  const script = source.replace('\nboot();\nbootCrs();', '\n');
  await runInNewContext(`${script}\nbootCrs();`, context);
  return wrap;
}

test('CRS panel shows the normalized demo score, tradelines, utilization and risk flags', async()=>{
  const { innerHTML } = await renderCrs(crsDemo);
  assert.match(innerHTML, /REACHABLE/);
  assert.match(innerHTML, /790 \(VantageScore 4\.0\)/);
  assert.match(innerHTML, /12 reported · 8 open/);
  assert.match(innerHTML, /8%/);
  assert.match(innerHTML, /No derogatory marks in file/);
  assert.match(innerHTML, /&lt;sandbox&gt;/, 'label is escaped');
  assert.doesNotMatch(innerHTML, /scoreSummary|billable|Response sections/);
});

test('CRS panel states an honest error instead of a fake score', async()=>{
  const { innerHTML } = await renderCrs({ ok:false, error:'auth_failed' });
  assert.match(innerHTML, /ERROR/);
  assert.match(innerHTML, /Credit evidence source auth_failed; demonstration unavailable/);
  assert.doesNotMatch(innerHTML, /\d{3} \(/);
});

test('CRS panel without normalized evidence says so instead of rendering zeros', async()=>{
  const { innerHTML } = await renderCrs({ ok:true, demonstration:true, label:'demo' });
  assert.match(innerHTML, /no normalized credit evidence for the demo persona/);
  assert.doesNotMatch(innerHTML, /Demo persona score/);
});
