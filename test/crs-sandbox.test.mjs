// CRS CalHacks sandbox integration: documented login-token auth, synthetic
// test persona only, no secret leakage, honest failure states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsSandboxStatus, fetchSandboxDemoReport } from '../crs-sandbox.mjs';

const ENV = { CRS_SANDBOX_USERNAME: 'CalhacksDev120', CRS_SANDBOX_PASSWORD: 'secret-pw' };
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('status: not_configured without env, configured with both vars', () => {
  assert.equal(crsSandboxStatus({}).state, 'not_configured');
  assert.equal(crsSandboxStatus({ CRS_SANDBOX_USERNAME: 'u' }).state, 'not_configured');
  assert.equal(crsSandboxStatus(ENV).state, 'configured');
});

test('demo report: login once, Bearer on fixture call, spec persona body', async () => {
  const seen = [];
  const fakeFetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts.headers.authorization || null, body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).endsWith('/users/login')) return ok({ token: 'tok-1', expires: new Date(Date.now() + 3600e3).toISOString() });
    return ok({ billable: false, creditResponse: { score: { model: 'VANTAGE4', score: 720 } } });
  };
  const r = await fetchSandboxDemoReport({ env: ENV, fetchImpl: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.demonstration, true);
  assert.match(r.label, /synthetic test persona/);
  assert.match(r.label, /not business credit/i);
  assert.equal(seen[0].url, 'https://api-sandbox.stitchcredit.com/api/users/login');
  assert.equal(seen[0].body.username, 'CalhacksDev120');
  assert.equal(seen[1].auth, 'Bearer tok-1');
  assert.equal(seen[1].body.firstName, 'MARGARET');
  assert.equal(seen[1].body.ssn, '666701001'); // the spec's own documented test persona
  // no secret or token anywhere in the returned object
  const s = JSON.stringify(r);
  assert.ok(!s.includes('secret-pw') && !s.includes('tok-1'), 'no credentials or tokens in output');
});

test('auth failure surfaces as auth_failed, never throws', async () => {
  const fakeFetch = async () => ok({ message: 'bad credentials' }, 401);
  const r = await fetchSandboxDemoReport({ env: { CRS_SANDBOX_USERNAME: 'other-user', CRS_SANDBOX_PASSWORD: 'x' }, fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'auth_failed');
});

test('not_configured: no network call', async () => {
  let called = false;
  const r = await fetchSandboxDemoReport({ env: {}, fetchImpl: () => { called = true; } });
  assert.equal(r.error, 'not_configured');
  assert.equal(called, false);
});
