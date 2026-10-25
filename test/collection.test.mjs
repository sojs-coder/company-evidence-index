import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../collection.js', import.meta.url), 'utf8');
const now = Date.parse('2026-10-25T12:00:00Z');

test('collection merges sources chronologically and keeps gaps in the same stream', async () => {
  const stream = { setAttribute(name, value) { this[name] = value; } };
  const count = {};
  await runInNewContext(source, {
    document: { querySelector: selector => selector === '#collect-live' ? stream : count },
    setInterval() {},
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

test('collection formats relative times across units and handles future dates', () => {
  const context = { Intl, Date };
  runInNewContext(source.replace(/boot\(\);\s*$/, ''), context);
  for (const [seconds, expected] of [
    [-12, '12 seconds ago'],
    [-780, '13 minutes ago'],
    [-3600, '1 hour ago'],
    [-86400, '1 day ago'],
    [-2592000, '1 month ago'],
    [-31536000, '1 year ago'],
    [60, 'in 1 minute']
  ]) {
    context.timestamp = now + seconds * 1000;
    context.now = now;
    assert.equal(runInNewContext('relativeTime(timestamp,now)', context), expected);
  }
});

test('collection renders exact timestamps, gaps, sorted rows, and refreshed labels', async () => {
  const wrap = { innerHTML: '', setAttribute() {}, querySelectorAll: () => [] };
  let refresh;
  const context = {
    Intl, Date,
    document: { querySelector: selector => selector === '#collect-live' ? wrap : {} },
    fetch: async () => ({
      ok: true,
      json: async () => ({ mode: 'live', items: [
        { date: '2026-10-25T11:59:48Z', title: 'Older' },
        { date: '2026-10-25T12:00:00Z', title: 'Newer' },
        { date: 'invalid', title: 'Unknown date' }
      ] })
    }),
    setInterval: callback => { refresh = callback; }
  };
  await runInNewContext(source, context);
  assert.match(wrap.innerHTML, /<time datetime="2026-10-25T11:59:48.000Z" title="[^"]+">/);
  assert.ok(wrap.innerHTML.indexOf('Newer') < wrap.innerHTML.indexOf('Older'));
  assert.match(wrap.innerHTML, /collection-date">—<\/span>/);
  const time = { dateTime: new Date(Date.now() - 12000).toISOString() };
  wrap.querySelectorAll = () => [time];
  refresh();
  assert.equal(time.textContent, '12 seconds ago');
});
