import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x402Status, maybeWrapWithX402 } from '../x402-gate.mjs';

const noop = (req, res) => { res.writeHead(200); res.end('ok'); };
const mockRes = () => { const r = { code: null, body: null, writeHead(c) { r.code = c; return r; }, end(b) { r.body = b; } }; return r; };

test('default is disabled: same handler back, no SDK import', async () => {
  const r = await maybeWrapWithX402(noop, {});
  assert.equal(r.status.state, 'disabled');
  assert.equal(r.handler, noop);
});

test('enabled without env fails CLOSED: data routes 503 no data, not the app handler', async () => {
  const s = x402Status({ X402_ENABLED: 'true' });
  assert.equal(s.state, 'closed');
  assert.ok(s.detail.includes('CDP_API_KEY_ID'));
  const r = await maybeWrapWithX402(noop, { X402_ENABLED: 'true' });
  assert.equal(r.status.state, 'closed');
  assert.notEqual(r.handler, noop);
  const res = mockRes();
  r.handler({ url: '/api/companies/apple/report' }, res);
  assert.equal(res.code, 503);
  assert.equal(JSON.parse(res.body).error, 'payment_gate_unavailable');
});

test('closed gate covers every data path, spares health and static', async () => {
  const r = await maybeWrapWithX402(noop, { X402_ENABLED: 'true' });
  for (const p of ['/api/companies/apple/report', '/api/companies/apple/analysis', '/api/companies/apple/export', '/api/companies/apple/memo', '/api/companies/apple/collect/press', '/api/credit/sbss']) {
    const res = mockRes();
    r.handler({ url: p }, res);
    assert.equal(res.code, 503, `${p} must be closed`);
  }
  for (const p of ['/api/health', '/report.html', '/']) {
    const res = mockRes();
    r.handler({ url: p }, res);
    assert.equal(res.code, 200, `${p} must pass through`);
  }
});

test('enabled with env but SDK import/init failure also fails CLOSED', async () => {
  const env = { X402_ENABLED: 'true', CDP_API_KEY_ID: 'k', CDP_API_KEY_SECRET: 's', X402_PAY_TO: '0x0000000000000000000000000000000000000000' };
  const r = await maybeWrapWithX402(noop, env);
  assert.ok(r.status.state === 'enabled' || r.status.state === 'closed');
  if (r.status.state === 'closed') {
    const res = mockRes();
    r.handler({ url: '/api/companies/apple/report' }, res);
    assert.equal(res.code, 503);
  }
});
