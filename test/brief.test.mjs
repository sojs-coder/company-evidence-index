import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = f => readFile(new URL('../' + f, import.meta.url), 'utf8');
test('brief and picker cover exactly the approved five and four roles', async () => {
  const idx = await read('index.html'), brief = await read('brief.html');
  for (const t of ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA']) { assert.match(idx, new RegExp(`value="${t}"`)); assert.match(brief, new RegExp(`value="${t}"`)); }
  assert.doesNotMatch(idx + brief, /value="GOOGLEBRAND"/);
  for (const r of ['customer', 'vendor', 'investor', 'scout']) assert.match(idx, new RegExp(`value="${r}"`));
});
test('brief renders the /questions contract (roles[role] of {q,cite}) and never calls it an answer', async () => {
  const js = await read('brief.js');
  assert.match(js, /ans\.roles\[role\]/); assert.match(js, /x\.cite/); assert.doesNotMatch(js, /Direct answer/);
});
test('brief reads stored evidence only (no paid or collecting endpoints)', async () => {
  const js = await read('brief.js');
  assert.match(js, /\/api\/packs/); assert.match(js, /\/api\/analysis\//);
  const urls=[...js.matchAll(/(?:fetch|getJSON)\(\s*['"`]([^'"`]+)/g)].map(m=>m[1]);
  assert.ok(urls.length>=2);
  for(const u of urls) assert.match(u,/^\/api\/(packs|analysis\/|vet\/supplier\?name=)/);
});
test('role gate is opt-out on picker and brief pages', async () => {
  assert.match(await read('index.html'), /data-no-role-gate/);
  assert.match(await read('brief.html'), /data-no-role-gate/);
  assert.match(await read('role.js'), /data-no-role-gate/);
});
test('picker keeps the evaluation question and the old paid vet flow is not loaded', async () => {
  const idx = await read('index.html');
  assert.match(idx, /name="question"/); assert.doesNotMatch(idx, /vet\.js/);
});
