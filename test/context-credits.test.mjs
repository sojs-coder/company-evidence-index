import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLastContextCredits, buildVetReport } from '../vet-report.mjs';

const okJson = (body, headers) => ({ ok: true, headers: { get: (k) => (headers || {})[k] ?? null }, json: async () => body });

test('ctxCall captures X-Credits-Used and key_metadata without exposing the key', async () => {
  process.env.CONTEXT_DEV_API_KEY = 'test-key';
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('context.dev/v1/web/answers')) return okJson(
      { json_content: { summary: 's', evidence_points: [], open_questions: [] }, sources: [], partial: false, key_metadata: { credits_consumed: 42, credits_remaining: 958 } },
      { 'x-credits-used': '10' });
    return okJson({ results: [] });
  };
  try {
    await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'public_company', name: 'CATERPILLAR INC' });
    const c = getLastContextCredits();
    assert.ok(c, 'credits captured');
    assert.equal(c.lastRequestCreditsUsed, 10);
    assert.equal(c.creditsRemaining, 958);
    assert.equal(c.creditsConsumed, 42);
    assert.ok(!JSON.stringify(c).includes('test-key'), 'no key material in the captured record');
  } finally { globalThis.fetch = prev; delete process.env.CONTEXT_DEV_API_KEY; }
});

test('highlighted scrape ledger counts base + highlights modifier per docs', async () => {
  process.env.CONTEXT_DEV_API_KEY = 'test-key';
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('context.dev/v1/web/search')) return okJson({ results: [{ title: 't', url: 'https://example.gov/a', snippet: 's' }] });
    if (u.includes('context.dev/v1/web/scrape')) return okJson({ highlights: { data: ['a real passage about the contract'] } });
    if (u.includes('context.dev/v1/web/answers')) return okJson({ json_content: { summary: 's', evidence_points: [], open_questions: [] }, sources: [], partial: false });
    if (u.includes('context.dev/v1/brand/search')) return okJson({ results: [] });
    return okJson({});
  };
  try {
    const r = await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'public_company', name: 'CATERPILLAR INC' });
    const hl = r.sources.filter(s => s.key === 'ctx_highlights' && s.mode === 'live');
    assert.ok(hl.length >= 1, 'highlight scrapes ran');
    for (const h of hl) assert.equal(h.creditsCounted, 2, 'scrape base + highlights modifier');
  } finally { globalThis.fetch = prev; delete process.env.CONTEXT_DEV_API_KEY; }
});
