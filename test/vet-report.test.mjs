// Regression tests for the vet identify/report builders. Offline and
// deterministic: every network call is stubbed. Run before any commit that
// touches vet-report.mjs: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.CONTEXT_DEV_API_KEY; // exercises the not_configured path

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const AWARD = { 'Award ID': 'T1', 'Recipient Name': 'CATERPILLAR INC', 'Start Date': '2026-01-01', 'Award Amount': 1000, 'Awarding Agency': 'Test Agency', 'Description': 'TEST AWARD' };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('usaspending.gov')) return ok({ results: [AWARD] });
  if (u.includes('ntrs.nasa.gov')) return ok({ results: [] });
  if (u.includes('sec.gov')) return ok({});
  throw new Error('unexpected fetch in test: ' + u);
};

const { buildVetIdentify, buildVetReport } = await import('../vet-report.mjs');

test('identify returns seeded SEC identity candidates (regression: must not throw report-scope errors)', async () => {
  const r = await buildVetIdentify('Caterpillar');
  assert.ok(Array.isArray(r.identities), 'identities array');
  const cat = r.identities.find(i => i.name === 'CATERPILLAR INC');
  assert.ok(cat, 'seeded match present');
  assert.equal(cat.kind, 'public_company');
  const sec = r.sources.find(s => s.key === 'sec_registry');
  assert.equal(sec.mode, 'seeded_snapshot');
});

test('report scopes federal-award findings to the selected identity kind', async () => {
  const r = await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'public_company', name: 'CATERPILLAR INC' });
  assert.ok(r.answer, 'answer assembled');
  assert.ok(Array.isArray(r.conflictChecks), 'conflictChecks array');
  const f = r.findings.find(x => x.topic === 'federal_awards');
  assert.ok(f, 'federal_awards finding present');
  assert.match(f.statement, /SEC-registered public-company name/);
  assert.doesNotMatch(f.statement, /buyer-typed/);
});

test('buyer-typed scope wording is reserved for custom identities', async () => {
  const r = await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'custom', name: 'Caterpillar' });
  const f = r.findings.find(x => x.topic === 'federal_awards');
  assert.ok(f);
  assert.match(f.statement, /buyer-typed \(not registry-verified\)/);
  assert.ok(r.caveats.some(c => /not registry-verified/.test(c)), 'custom caveat present');
});

test('synthesis stays absent and labeled when no key is configured', async () => {
  const r = await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'public_company', name: 'CATERPILLAR INC' });
  assert.equal(r.synthesis, undefined);
  const ca = r.sources.find(s => s.key === 'ctx_answers');
  assert.ok(ca, 'ctx_answers source row present');
  assert.equal(ca.mode, 'not_configured');
});

test('synthesis claim check flags $ figures lacking ceiling/obligated/revenue qualifiers', async () => {
  process.env.CONTEXT_DEV_API_KEY = 'test-key';
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('context.dev/v1/web/answers')) return ok({
      json_content: {
        summary: 'Caterpillar Inc. was awarded a $1.284 billion contract in 2022.',
        evidence_points: ['It holds a maximum $5 million ceiling contract.', 'Revenue grew last year.'],
        open_questions: []
      },
      sources: [{ title: 'Issuer page', url: 'https://example.gov/src' }],
      partial: false
    });
    return prev(url);
  };
  try {
    const r = await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'public_company', name: 'CATERPILLAR INC' });
    assert.ok(r.synthesis && r.synthesis.amountCheck, 'amountCheck present');
    assert.ok(r.synthesis.amountCheck.flagged.some(s => s.includes('$1.284 billion')), 'flattened figure flagged: ' + JSON.stringify(r.synthesis.amountCheck.flagged));
    assert.ok(!r.synthesis.amountCheck.flagged.some(s => /maximum/.test(s)), 'qualified sentence not flagged');
  } finally { globalThis.fetch = prev; delete process.env.CONTEXT_DEV_API_KEY; }
});

test('URL-only evidence points are moved to synthesis sources, not rendered as content', async () => {
  process.env.CONTEXT_DEV_API_KEY = 'test-key';
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('context.dev/v1/web/answers')) return ok({
      json_content: { summary: 'Summary without figures.', evidence_points: ['https://example.gov/page', 'A real evidence point.'], open_questions: [] },
      sources: [{ title: 'Issuer page', url: 'https://example.gov/src' }],
      partial: false
    });
    return prev(url);
  };
  try {
    const r = await buildVetReport('Caterpillar', 'federal contracts?', 'supplier', { kind: 'public_company', name: 'CATERPILLAR INC' });
    assert.deepEqual(r.synthesis.content.evidence_points, ['A real evidence point.']);
    const urls = r.synthesis.sources.map(s => s.url);
    assert.ok(urls.includes('https://example.gov/page'), 'URL-only point became a source');
    assert.ok(urls.includes('https://example.gov/src'), 'provider source kept');
  } finally { globalThis.fetch = prev; delete process.env.CONTEXT_DEV_API_KEY; }
});
