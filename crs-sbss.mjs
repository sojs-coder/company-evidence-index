// CRS Credit API - SBSS (FICO Small Business Scoring Service) sandbox client.
// Grounded in the published CRS sandbox OpenAPI spec:
//   https://sbss-sandbox.crscreditapi.com/openapi.yaml  (read 2026-10-24)
// Auth: Bearer token issued by CRS (portal signup + CRS-side risk-model
// provisioning - both are user decisions, not done from code).
//
// Honest states: when CRS_API_KEY is absent the client reports
// not_configured and never makes a network call. The default base URL is the
// CRS SANDBOX. Nothing here performs a real consumer or business credit
// pull; whether any real pull is permitted depends on the actual product
// and purpose, which is a human decision.

export const CRS_SANDBOX_BASE = 'https://sbss-sandbox.crscreditapi.com';

export const PRODUCT_CATEGORIES = ['COMMERCIAL_CARD', 'LINE_OF_CREDIT', 'TERM_LOAN', 'LEASE', 'START_UP'];

export function crsStatus(env = process.env) {
  const configured = Boolean(env.CRS_API_KEY && env.CRS_API_KEY.trim());
  const baseUrl = (env.CRS_BASE_URL && env.CRS_BASE_URL.trim()) || CRS_SANDBOX_BASE;
  return {
    configured,
    state: configured ? 'configured' : 'not_configured',
    baseUrl,
    sandbox: baseUrl.includes('sandbox'),
    detail: configured ? 'Credit evidence source connected.' : 'Credit evidence source not connected.'
  };
}

// Validate a request body against the SbssRequest schema (spec #/components/schemas/SbssRequest).
// Returns { ok: true } or { ok: false, errors: [...] }. Never mutates the input.
export function validateSbssRequest(req) {
  const errors = [];
  if (!req || typeof req !== 'object') return { ok: false, errors: ['request body must be an object'] };
  if (!PRODUCT_CATEGORIES.includes(req.productCategory)) {
    errors.push(`productCategory must be one of ${PRODUCT_CATEGORIES.join('|')}`);
  }
  const principals = req.principals;
  if (!Array.isArray(principals) || principals.length < 1 || principals.length > 2) {
    errors.push('principals must be an array of 1 or 2 entries');
  } else {
    principals.forEach((p, i) => {
      const tag = `principals[${i}]`;
      if (!p || typeof p !== 'object') { errors.push(`${tag} must be an object`); return; }
      if (typeof p.firstName !== 'string' || !p.firstName || p.firstName.length > 15) errors.push(`${tag}.firstName required (max 15 chars)`);
      if (typeof p.lastName !== 'string' || !p.lastName) errors.push(`${tag}.lastName required`);
      if (p.middleInitial !== undefined && (typeof p.middleInitial !== 'string' || p.middleInitial.length > 1)) errors.push(`${tag}.middleInitial max 1 char`);
      if (!p.address || typeof p.address !== 'object') {
        errors.push(`${tag}.address required`);
      } else {
        for (const f of ['street', 'city', 'state', 'zip']) {
          if (typeof p.address[f] !== 'string' || !p.address[f]) errors.push(`${tag}.address.${f} required`);
        }
      }
      if (!p.ssn && !p.birthdate) errors.push(`${tag}: either ssn or birthdate must be provided`);
      const hasExp = p.experian !== undefined, hasEq = p.equifax !== undefined;
      if (hasExp === hasEq) errors.push(`${tag}: exactly one of experian or equifax must be present`);
      if (hasExp && (typeof p.experian !== 'object' || typeof p.experian.riskModel !== 'string' || !p.experian.riskModel)) errors.push(`${tag}.experian.riskModel required`);
      if (hasEq && (typeof p.equifax !== 'object' || typeof p.equifax.riskModel !== 'string' || !p.equifax.riskModel)) errors.push(`${tag}.equifax.riskModel required`);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// Submit an SBSS decision request. POST {base}/sbss with Bearer auth.
// With no API key: returns not_configured WITHOUT any network call.
// Never throws on HTTP/parse failure; returns { ok: false, ... } instead.
export async function submitSbssDecision(request, { env = process.env, fetchImpl = fetch, descriptions = false } = {}) {
  const st = crsStatus(env);
  if (!st.configured) return { ok: false, error: 'not_configured', status: st };
  const v = validateSbssRequest(request);
  if (!v.ok) return { ok: false, error: 'invalid_request', details: v.errors };
  const url = `${st.baseUrl}/sbss${descriptions ? '?descriptions=true' : ''}`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${env.CRS_API_KEY}`, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(request)
    });
  } catch (e) {
    return { ok: false, error: 'network_error', detail: String(e && e.message || e) };
  }
  let data = null;
  try { data = await res.json(); } catch { /* RFC 9457 errors are JSON; anything else stays null */ }
  if (!res.ok) {
    return { ok: false, error: 'crs_error', httpStatus: res.status, problem: data || null };
  }
  // Defensive extraction per the spec's success shape:
  // business.fico.sbss { type, model, scorable, score, reasonCodes[] }
  const businessSbss = data && data.business && data.business.fico && data.business.fico.sbss ? data.business.fico.sbss : null;
  return {
    ok: true,
    status: data && data.status || null,
    businessSbss,
    sandbox: st.sandbox,
    raw: data
  };
}
