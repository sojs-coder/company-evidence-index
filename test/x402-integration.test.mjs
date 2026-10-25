// Runtime integration test with the REAL installed SDK (not mocks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { maybeWrapWithX402 } from '../x402-gate.mjs';

const DATA = JSON.stringify({ secret: 'paid-data' });
const appHandler = (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(DATA);
};

async function withServer(handler, fn) {
  const srv = createServer(handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

test('disabled mode serves free (demo)', async () => {
  const { handler, status } = await maybeWrapWithX402(appHandler, {});
  assert.equal(status.state, 'disabled');
  const body = await withServer(handler, async b => await (await fetch(`${b}/api/companies/apple/report`)).text());
  assert.equal(body, DATA);
});

test('enabled + valid-format env + real SDK: request WITHOUT payment gets no data (402 or gate error, never the payload)', async () => {
  const env = {
    X402_ENABLED: 'true',
    CDP_API_KEY_ID: '00000000-0000-0000-0000-000000000000',
    CDP_API_KEY_SECRET: 'test-secret-not-real',
    X402_PAY_TO: '0x0000000000000000000000000000000000000001'
  };
  const { handler, status } = await maybeWrapWithX402(appHandler, env);
  assert.ok(status.state === 'enabled' || status.state === 'closed', `unexpected state ${status.state}`);
  for (const path of ['/api/companies/apple/report', '/api/companies/apple/analysis', '/api/companies/apple/export', '/api/companies/apple/memo']) {
    const { code, body } = await withServer(handler, async b => {
      const r = await fetch(`${b}${path}`);
      return { code: r.status, body: await r.text() };
    });
    assert.notEqual(code, 200, `${path} served data with state=${status.state}`);
    assert.ok(!body.includes('paid-data'), `${path} leaked data`);
  }
});

test('enabled + missing env: every data path closed 503, health + static pass', async () => {
  const { handler, status } = await maybeWrapWithX402(appHandler, { X402_ENABLED: 'true' });
  assert.equal(status.state, 'closed');
  for (const path of ['/api/companies/apple/report', '/api/companies/apple/collect/press', '/api/credit/sbss']) {
    const r = await withServer(handler, async b => await fetch(`${b}${path}`));
    assert.equal(r.status, 503, `${path} should be 503`);
    const body = await r.json();
    assert.equal(body.error, 'payment_gate_unavailable');
  }
  const h = await withServer(handler, async b => await fetch(`${b}/api/health`));
  assert.equal(h.status, 200); // passes through to appHandler here (real app answers health)
});

test('enabled + garbage payment header: still no data', async () => {
  const env = {
    X402_ENABLED: 'true',
    CDP_API_KEY_ID: '00000000-0000-0000-0000-000000000000',
    CDP_API_KEY_SECRET: 'test-secret-not-real',
    X402_PAY_TO: '0x0000000000000000000000000000000000000001'
  };
  const { handler, status } = await maybeWrapWithX402(appHandler, env);
  const { code, body } = await withServer(handler, async b => {
    const r = await fetch(`${b}/api/companies/apple/report`, { headers: { 'payment-signature': 'garbage' } });
    return { code: r.status, body: await r.text() };
  });
  assert.notEqual(code, 200);
  assert.ok(!body.includes('paid-data'));
});
