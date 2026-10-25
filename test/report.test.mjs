import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../report.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(script.replace(/\nboot\(\);?\s*$/,''),context);
const render=aspects=>context.renderAspectSentiment(aspects);

test('aspect bars share a centered scale and include neutral counts in accessible text',()=>{
  const html=render([{aspect:'price',count:100,negative:45,neutral:30,positive:25}]);
  assert.match(html,/aspect-negative"><span style="width:45%"/);
  assert.match(html,/aspect-positive"><span style="width:25%"/);
  assert.match(html,/45 negative, 30 neutral, 25 positive/);
  assert.match(html,/Net sentiment -20 percentage points/);
  assert.match(html,/tabindex="0"/);
  assert.match(html,/100 mentions/);
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
