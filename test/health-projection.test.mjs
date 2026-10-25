// /api/health must never expose internal config: no base URLs, no env var
// names, no sandbox flags, no account details - only whitelisted states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthProjection } from '../health-projection.mjs';
import { crsStatus } from '../crs-sbss.mjs';
import { x402Status } from '../x402-gate.mjs';

test('health projection whitelists safe states only', () => {
  const h = healthProjection({
    gateStatus: x402Status({ X402_ENABLED: 'true' }), // closed, detail names missing vars internally
    crs: crsStatus({ CRS_API_KEY: 'k' }),
    runtimeConfig: { configured: true, state: 'configured' },
    seeded: true
  });
  const s = JSON.stringify(h);
  assert.ok(!s.includes('CDP_API_KEY_ID'), 'no env var names');
  assert.ok(!s.includes('sbss-sandbox'), 'no internal base URLs');
  assert.ok(!s.includes('"sandbox"'), 'no sandbox flag');
  assert.ok(!s.includes('baseUrl'), 'no baseUrl field');
  assert.equal(h.crs.state, 'configured');
  assert.equal(h.x402.state, 'closed');
  assert.equal(h.x402.detail, 'Paid access is enabled but not initialized; data routes fail closed (503) with no data.');
});

test('disabled x402 health projection stays generic', () => {
  const h = healthProjection({ gateStatus: x402Status({}), crs: crsStatus({}), runtimeConfig: { configured: false, state: 'not_configured' }, seeded: true });
  assert.equal(h.x402.state, 'disabled');
  assert.equal(h.crs.detail, 'Credit evidence source not connected.');
});
