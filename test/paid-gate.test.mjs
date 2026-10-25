import test from 'node:test';
import assert from 'node:assert/strict';
import { paidGateStatus, buildPaidGate } from '../paid-gate.mjs';

test('disabled by default: honest closed state, no network', async () => {
  const st = paidGateStatus({});
  assert.equal(st.state, 'disabled');
  const gate = await buildPaidGate({ env: {} });
  const res = { code: null, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  await gate({ url: '/api/paid/vet/identify?name=Apple' }, res);
  assert.equal(res.code, 503);
  assert.match(res.body, /paid_access_closed/);
});
test('enabled without PAY_TO fails closed before any SDK work', async () => {
  const st = paidGateStatus({ X402_PAID_ENABLED: 'true' });
  assert.equal(st.state, 'closed');
  const gate = await buildPaidGate({ env: { X402_PAID_ENABLED: 'true' } });
  const res = { code: null, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  await gate({ url: '/api/paid/vet/report' }, res);
  assert.equal(res.code, 503);
});
test('enabled with PAY_TO reports enabling on testnet default', () => {
  const st = paidGateStatus({ X402_PAID_ENABLED: 'true', X402_PAY_TO: '0x21e4116204be0d831ffbc0dbe9b5a1ffcb12da45' });
  assert.equal(st.state, 'enabling');
  assert.equal(st.network, 'eip155:84532');
});
