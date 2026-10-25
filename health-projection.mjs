// Public /api/health projection. Whitelist only operator-safe states - never
// internal config: no base URLs, no env var names, no sandbox flags, no
// account details. Internal status objects keep their detail for server-side
// use; this projection is the only thing the public endpoint may serve.
export function healthProjection({ gateStatus, crs, runtimeConfig, seeded }) {
  const x402 = { state: gateStatus && gateStatus.state || 'unknown' };
  x402.detail = {
    disabled: 'Paid access is off; endpoints are free.',
    enabled: 'Paid access is on.',
    closed: 'Paid access is enabled but not initialized; data routes fail closed (503) with no data.'
  }[x402.state] || 'Paid access state unknown; data routes fail closed.';
  const safe = (s, on, off) => ({ configured: !!s.configured, state: s.state, detail: s.configured ? on : off });
  return {
    status: 'ok',
    service: 'company-evidence-index',
    seeded: !!seeded,
    x402,
    crs: safe(crs, 'Credit evidence source connected.', 'Credit evidence source not connected.'),
    runtimeConfig: safe(runtimeConfig, 'Runtime configuration connected.', 'Runtime configuration not connected.')
  };
}
