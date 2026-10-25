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
