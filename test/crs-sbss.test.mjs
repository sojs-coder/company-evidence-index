import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSbssRequest, submitSbssDecision, crsStatus, CRS_SANDBOX_BASE } from '../crs-sbss.mjs';

// Request shape copied from the published OpenAPI example "basicExperian"
// (https://sbss-sandbox.crscreditapi.com/openapi.yaml, read 2026-10-24).
const specExample = {
  productCategory: 'COMMERCIAL_CARD',
  principals: [{
    firstName: 'MICHAEL', middleInitial: 'A', lastName: 'KLEMM', ssn: '666630555',
    address: { street: '5046 WYNN PARK DR', city: 'OREGON', state: 'OR', zip: '43616' },
    experian: { riskModel: 'F9' }
  }],
  business: { legalName: 'Gorman Manufacturing Company, Inc.' }
};

test('spec example request validates', () => {
  assert.deepEqual(validateSbssRequest(specExample), { ok: true });
});

test('birthdate alone satisfies the ssn-or-birthdate rule (Equifax example)', () => {
  const req = structuredClone(specExample);
  delete req.principals[0].ssn;
  req.principals[0].birthdate = '1980-05-15';
  delete req.principals[0].experian;
  req.principals[0].equifax = { riskModel: '05206' };
  assert.equal(validateSbssRequest(req).ok, true);
});

test('rejects both bureaus on one principal', () => {
  const req = structuredClone(specExample);
  req.principals[0].equifax = { riskModel: '05206' };
  const r = validateSbssRequest(req);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('exactly one of experian or equifax')));
});

test('rejects three principals and a bad product category', () => {
  const req = structuredClone(specExample);
  req.productCategory = 'MORTGAGE';
  req.principals = [req.principals[0], req.principals[0], req.principals[0]];
  const r = validateSbssRequest(req);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('productCategory')));
  assert.ok(r.errors.some(e => e.includes('1 or 2')));
});

test('not_configured: no key means no network call', async () => {
  let called = false;
  const r = await submitSbssDecision(specExample, { env: {}, fetchImpl: () => { called = true; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_configured');
  assert.equal(called, false);
  assert.equal(crsStatus({}).state, 'not_configured');
  assert.equal(crsStatus({}).baseUrl, CRS_SANDBOX_BASE);
});

test('sandbox call: correct URL, auth header, and defensive parse', async () => {
  const seen = {};
  const fakeFetch = async (url, opts) => {
    seen.url = url; seen.auth = opts.headers.authorization;
    return { ok: true, json: async () => ({ status: 'SUCCESSFUL', business: { fico: { sbss: { type: 'SBSS70', model: '763', scorable: true, score: 247, reasonCodes: [] } } } }) };
  };
  const r = await submitSbssDecision(specExample, { env: { CRS_API_KEY: 'test-key' }, fetchImpl: fakeFetch, descriptions: true });
  assert.equal(r.ok, true);
  assert.equal(seen.url, `${CRS_SANDBOX_BASE}/sbss?descriptions=true`);
  assert.equal(seen.auth, 'Bearer test-key');
  assert.equal(r.businessSbss.score, 247);
  assert.equal(r.sandbox, true);
});

test('crs error surface: non-2xx returns problem, never throws', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({ title: 'Invalid Bearer Token' }) });
  const r = await submitSbssDecision(specExample, { env: { CRS_API_KEY: 'bad' }, fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'crs_error');
  assert.equal(r.httpStatus, 401);
});
