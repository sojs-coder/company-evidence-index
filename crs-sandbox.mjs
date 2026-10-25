// CRS CalHacks sandbox integration - sponsor demonstration only.
// Grounded in the official CalHacks OpenAPI spec (portal developer-resources,
// read 2026-10-25): base https://api-sandbox.stitchcredit.com/api, bearerAuth
// with a token from POST /users/login {username, password}.
//
// SCOPE HONESTY:
// - Sandbox responses use the sponsor's TEST PERSONAS. A persona match is not
//   billable and touches no real consumer (portal statement). It is NOT
//   business credit data and says NOTHING about any company the user vets.
// - This module powers a separate "sponsor sandbox demonstration" surface.
//   Its output must never be blended into a company's evidence pack.
// - The earlier SBSS route targeted a different sandbox host whose token
//   issuance is undocumented for this account; it is deprecated, not deleted.
//
// SECRETS: username/password arrive via environment (Railway vars populated
// through the broker/vault path). Neither value is ever logged, returned, or
// rendered. The bearer token is cached in memory only, never persisted.

const DEFAULT_BASE = 'https://api-sandbox.stitchcredit.com/api';
// Documented test persona from the official spec's own request example.
// Non-billable, no real consumer.
const SPEC_PERSONA = {
  firstName: 'MARGARET', lastName: 'OKAFOR', ssn: '666701001',
  addresses: [{ addressLine1: '1420 WILLOW CREEK DR', city: 'SAN JOSE', state: 'CA', postalCode: '95125', borrowerResidencyType: 'Current' }]
};
const DEFAULT_CONFIG = 'exp-prequal-vantage4';

export function crsSandboxStatus(env = process.env) {
  const configured = Boolean(env.CRS_SANDBOX_USERNAME && env.CRS_SANDBOX_USERNAME.trim() && env.CRS_SANDBOX_PASSWORD && env.CRS_SANDBOX_PASSWORD.trim());
  return {
    configured,
    state: configured ? 'configured' : 'not_configured',
    detail: configured ? 'Credit evidence source connected.' : 'Credit evidence source not connected.'
  };
}

const tokenCache = new Map(); // key: base + username -> { token, expiresAt }
async function login(env, fetchImpl) {
  const base = (env.CRS_SANDBOX_BASE && env.CRS_SANDBOX_BASE.trim()) || DEFAULT_BASE;
  const ck = base + '|' + env.CRS_SANDBOX_USERNAME;
  const cached = tokenCache.get(ck);
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;
  const r = await fetchImpl(base + '/users/login', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username: env.CRS_SANDBOX_USERNAME, password: env.CRS_SANDBOX_PASSWORD })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.token) { const e = new Error('sandbox login failed (HTTP ' + r.status + ')'); e.status = r.status || 502; throw e; }
  tokenCache.set(ck, { token: j.token, expiresAt: j.expires ? Date.parse(j.expires) || Date.now() + 3_600_000 : Date.now() + 3_600_000 });
  return j.token;
}

// Fetch the sponsor's documented synthetic test-persona credit report.
// Returns a LABELED demonstration object; never throws on HTTP failure.
export async function fetchSandboxDemoReport({ env = process.env, fetchImpl = fetch } = {}) {
  const st = crsSandboxStatus(env);
  if (!st.configured) return { ok: false, error: 'not_configured' };
  const base = (env.CRS_SANDBOX_BASE && env.CRS_SANDBOX_BASE.trim()) || DEFAULT_BASE;
  const config = (env.CRS_SANDBOX_CONFIG && env.CRS_SANDBOX_CONFIG.trim()) || DEFAULT_CONFIG;
  let token;
  try { token = await login(env, fetchImpl); } catch (e) { return { ok: false, error: 'auth_failed', detail: String(e.message || e) }; }
  let r;
  try {
    r = await fetchImpl(base + '/experian/credit-report/standard/' + encodeURIComponent(config), {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(SPEC_PERSONA)
    });
  } catch (e) { return { ok: false, error: 'network_error', detail: String(e && e.message || e) }; }
  const data = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, error: 'crs_error', httpStatus: r.status };
  // Never return raw PII fields of the persona beyond what the demo shows.
  return {
    ok: true,
    demonstration: true,
    label: 'CRS sponsor sandbox demonstration - synthetic test persona (MARGARET OKAFOR, from the sponsor\'s own spec example). Not a real consumer, not business credit, not about any company in this tool.',
    billable: data && typeof data.billable === 'boolean' ? data.billable : null,
    errorMessages: data && data.errorMessages ? data.errorMessages : null,
    scoreSummary: data && data.creditResponse && data.creditResponse.score ? { model: data.creditResponse.score.model || null, score: data.creditResponse.score.score || null } : null,
    sections: data ? Object.keys(data).slice(0, 12) : []
  };
}
