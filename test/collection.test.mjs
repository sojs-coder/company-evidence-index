import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('collection merges sources chronologically and keeps gaps in the same stream', async () => {
  const script = await readFile(new URL('../collection.js', import.meta.url), 'utf8');
  const stream = { setAttribute(name, value) { this[name] = value; } };
  const count = {};
  const nodes = {
    '#collect-live': stream,
    '#collect-count': count,
    '.theme-toggle': { addEventListener() {} },
  };
  const context = vm.createContext({
    document: { querySelector: selector => nodes[selector] },
    fetch: async url => {
      const key = url.split('/').at(-1);
      if (key === 'news') throw new Error('offline');
      if (key === 'verge') return { ok: false, status: 503 };
      const items = key === 'edgar'
        ? [{ date: '2025-01-01', form: '10-K', description: 'Annual filing', link: 'https://example.com/filing' }]
        : key === 'newsroom'
          ? [{ date: 'Tue, 04 Feb 2025 12:00:00 GMT', title: 'A <new> "release"', link: 'https://example.com/news' }]
          : key === 'hackernews'
            ? [{ date: 'unknown', title: 'Undated story', points: 0 }]
            : [];
      return { ok: true, json: async () => ({ mode: 'live', items }) };
    },
  });
  // The page's final boot() expression returns its loading promise.
  await vm.runInContext(script, context);
  assert.equal(count.textContent, '11 OF 13 SOURCES REPORTING LIVE');
  assert.equal(stream['aria-busy'], 'false');
  const html = stream.innerHTML;
  assert.ok(html.indexOf('2025-02-04') < html.indexOf('2025-01-01'));
  assert.ok(html.indexOf('Form 10-K') < html.indexOf('Undated story'));
  assert.ok(html.indexOf('Undated story') < html.indexOf('Live fetch failed'));
  assert.match(html, /A &lt;new&gt; &quot;release&quot;/);
  assert.match(html, /href="https:\/\/example.com\/filing"/);
  assert.match(html, /0 pts/);
  assert.match(html, /HTTP 503/);
  assert.match(html, /UNAVAILABLE/);
  assert.match(html, /Source returned no items/);
  assert.match(html, /OpenSecrets/);
  assert.match(html, /Google Patents/);
  assert.doesNotMatch(html, /collect-card|<article/);
});
