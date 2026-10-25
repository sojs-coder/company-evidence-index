import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfigStatus, extractBrokeredSecret } from '../runtime-config.mjs';

const SECRET = 'apify-token-abc123';
const CANARY = 'serviceCredential-privileged-value-xyz'; // must never escape
const ENV = { RUNTIME_CONFIG_URL: 'https://api.signalor.app/api/internal/runtime-config/snapshot', RUNTIME_CONFIG_TOKEN: 'runtime-token' };
const envelope = () => JSON.stringify({ data: { secrets: { APIFY_API_TOKEN: SECRET }, serviceCredential: CANARY, trustedCredentials: [CANARY] } });

test('not_configured: no env means no network call', async () => {
  let called = false;
  const r = await extractBrokeredSecret('APIFY_API_TOKEN', { env: {}, fetchImpl: () => { called = true; } });
  assert.deepEqual(r, { ok: false, error: 'not_configured' });
  assert.equal(called, false);
  assert.equal(runtimeConfigStatus({}).state, 'not_configured');
});

test('extracts only data.secrets.APIFY_API_TOKEN; privileged envelope fields never escape', async () => {
  const seen = {};
  const fakeFetch = async (url, opts) => { seen.key = opts.headers['x-api-key']; return { ok: true, text: async () => envelope() }; };
  const r = await extractBrokeredSecret('APIFY_API_TOKEN', { env: ENV, fetchImpl: fakeFetch });
  assert.deepEqual(r, { ok: true, value: SECRET });
  assert.equal(seen.key, 'runtime-token');
  assert.ok(!JSON.stringify(r).includes(CANARY));
  assert.ok(!('snapshot' in r) && !('body' in r) && !('raw' in r));
});

test('missing key -> not_found, still no envelope leak', async () => {
  const r = await extractBrokeredSecret('MISSING_KEY', { env: ENV, fetchImpl: async () => ({ ok: true, text: async () => envelope() }) });
  assert.deepEqual(r, { ok: false, error: 'not_found' });
  assert.ok(!JSON.stringify(r).includes(CANARY));
});

test('secret and canary never leak into status or failure output', async () => {
  const st = runtimeConfigStatus({ RUNTIME_CONFIG_URL: 'https://api.signalor.app/x', RUNTIME_CONFIG_TOKEN: SECRET });
  assert.ok(!JSON.stringify(st).includes(SECRET));
  const errCases = [
    await extractBrokeredSecret('APIFY_API_TOKEN', { env: { RUNTIME_CONFIG_URL: 'https://h/x', RUNTIME_CONFIG_TOKEN: SECRET }, fetchImpl: async () => ({ ok: false, status: 403, text: async () => `denied ${SECRET} ${CANARY}` }) }),
    await extractBrokeredSecret('APIFY_API_TOKEN', { env: { RUNTIME_CONFIG_URL: 'https://h/x', RUNTIME_CONFIG_TOKEN: SECRET }, fetchImpl: async () => ({ ok: true, text: async () => `not json ${SECRET} ${CANARY}` }) }),
    await extractBrokeredSecret('APIFY_API_TOKEN', { env: { RUNTIME_CONFIG_URL: 'https://h/x', RUNTIME_CONFIG_TOKEN: SECRET }, fetchImpl: async () => { throw new Error(`boom ${SECRET} ${CANARY}`); } })
  ];
  for (const r of errCases) {
    assert.equal(r.ok, false);
    const s = JSON.stringify(r);
    assert.ok(!s.includes(SECRET) && !s.includes(CANARY), `leak in ${s}`);
  }
});

test('oversize and non-object payloads rejected; keyPath override works', async () => {
  const big = await extractBrokeredSecret('K', { env: ENV, fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(70000) }), maxBytes: 65536 });
  assert.equal(big.error, 'oversize_snapshot');
  const arr = await extractBrokeredSecret('K', { env: ENV, fetchImpl: async () => ({ ok: true, text: async () => '[1,2]' }) });
  assert.equal(arr.error, 'non_object_snapshot');
  const alt = await extractBrokeredSecret('K', { env: ENV, keyPath: 'data.secrets.APIFY_API_TOKEN', fetchImpl: async () => ({ ok: true, text: async () => envelope() }) });
  assert.equal(alt.value, SECRET);
});
