// CRS credit evidence - normalized principal credit data for supplier/vendor vetting.
//
// Grounding: request/response schema verified against the LIVE CalHacks sandbox
// (POST https://api-sandbox.stitchcredit.com/api/experian/credit-report/standard/exp-prequal-vantage4,
// captured 2026-10-25). The real response has TOP-LEVEL scores[], tradelines[],
// inquiries[], publicRecords[], summaries{} and creditFiles[] - it has NO
// top-level creditResponse, billable, or errorMessages keys. The older
// crs-sandbox.mjs demo extractor reads data.creditResponse.score, which is why
// the live /api/credit/sandbox-demo returns scoreSummary:null today. This module
// replaces that extraction; crs-sandbox.mjs stays as-is for the builder to retire.
//
// SCOPE HONESTY (unchanged from crs-sandbox.mjs):
// - The CalHacks sandbox answers with the sponsor's SYNTHETIC test personas. A
//   persona match is not billable and touches no real consumer (portal statement).
//   It is NOT business credit data and says NOTHING about any company the user
//   vets. Apple/Microsoft/etc. can never be subjects here.
// - Legitimate product fit: in the supplier/vendor qualification flow, credit
//   evidence about a small business's PRINCIPAL is a real diligence input when
//   the buyer has a permitted purpose. The sandbox demonstrates that pipeline
//   end-to-end with a synthetic principal. Every output carries that label.
//
// SECRETS: username/password arrive via environment only. Neither value, nor the
// bearer token, is ever logged, returned, or persisted. Token cached in memory.
//
// PII DISCIPLINE: normalized output carries the subject's name only. Never SSN,
// addresses, date of birth, account identifiers, subscriber codes, or employer
// names - even though the synthetic persona's values are not a real person's.

const DEFAULT_BASE = 'https://api-sandbox.stitchcredit.com/api';
const DEFAULT_CONFIG = 'exp-prequal-vantage4';

// Documented synthetic test persona from the sponsor's own spec request example.
// Non-billable, not a real consumer.
export const SPEC_PERSONA = {
  firstName: 'MARGARET', lastName: 'OKAFOR', ssn: '666701001',
  addresses: [{ addressLine1: '1420 WILLOW CREEK DR', city: 'SAN JOSE', state: 'CA', postalCode: '95125', borrowerResidencyType: 'Current' }]
};

export function crsCreditStatus(env = process.env) {
  const configured = Boolean(env.CRS_SANDBOX_USERNAME && env.CRS_SANDBOX_USERNAME.trim() && env.CRS_SANDBOX_PASSWORD && env.CRS_SANDBOX_PASSWORD.trim());
  return {
    configured,
    state: configured ? 'configured' : 'not_configured',
    detail: configured ? 'Credit evidence source connected.' : 'Credit evidence source not connected.'
  };
}

const tokenCache = new Map(); // key: base + username -> { token, expiresAt }

const FETCH_TIMEOUT_MS = 12_000;
// Bounded fetch: an unreachable sandbox must degrade to an honest error state,
// never hang the request handler. Aborts surface as network_error upstream.
async function timedFetch(fetchImpl, url, opts, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
async function login(env, fetchImpl) {
  const base = (env.CRS_SANDBOX_BASE && env.CRS_SANDBOX_BASE.trim()) || DEFAULT_BASE;
  const ck = base + '|' + env.CRS_SANDBOX_USERNAME;
  const cached = tokenCache.get(ck);
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;
  const r = await timedFetch(fetchImpl, base + '/users/login', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username: env.CRS_SANDBOX_USERNAME, password: env.CRS_SANDBOX_PASSWORD })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.token) { const e = new Error('sandbox login failed (HTTP ' + r.status + ')'); e.status = r.status || 502; throw e; }
  tokenCache.set(ck, { token: j.token, expiresAt: j.expires ? Date.parse(j.expires) || Date.now() + 3_600_000 : Date.now() + 3_600_000 });
  return j.token;
}

// Pure normalizer: raw sandbox credit report -> credit evidence object.
// Defensive throughout: any missing section yields nulls/empties, never throws.
// PII-minimal by construction (see header).
export function normalizeCreditReport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // The sandbox serializes many numeric fields as strings ("790"); coerce
  // numeric strings, reject everything else.
  const num = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const req = raw.requestData || {};
  const detail = raw.responseDetail || {};
  const bureaus = Object.entries(raw.repositoryIncluded || {}).filter(([, v]) => v === true).map(([k]) => k);

  const scoreRow = Array.isArray(raw.scores) && raw.scores.length ? raw.scores[0] : null;
  const score = scoreRow ? {
    model: str(scoreRow.modelName) || str(scoreRow.modelNameType),
    value: num(scoreRow.scoreValue),
    minimum: num(scoreRow.scoreMinimumValue),
    maximum: num(scoreRow.scoreMaximumValue),
    percentile: num(scoreRow.scoreRankPercentileValue),
    factors: (Array.isArray(scoreRow.scoreFactors) ? scoreRow.scoreFactors : [])
      .map(f => str(f && f.scoreFactorText)).filter(Boolean).slice(0, 6)
  } : null;

  const ts = raw.summaries && raw.summaries.tradeSummary ? raw.summaries.tradeSummary : {};
  const ds = raw.summaries && raw.summaries.derogatorySummary ? raw.summaries.derogatorySummary : {};
  const tradelines = Array.isArray(raw.tradelines) ? raw.tradelines : [];
  const openCount = tradelines.filter(t => t && t.accountStatusType === 'Open').length;

  const inquiries = (Array.isArray(raw.inquiries) ? raw.inquiries : [])
    .map(i => ({ creditor: str(i && i.creditorName), date: str(i && i.inquiryDate), businessType: str(i && i.businessType) }))
    .filter(i => i.creditor || i.date).slice(0, 10);

  // Derived flags: stated as data summaries, never as a trust verdict.
  const riskFlags = [];
  if (num(ds.bankruptciesCount) > 0) riskFlags.push({ flag: 'bankruptcy_on_file', count: num(ds.bankruptciesCount) });
  if (num(ds.collectionsCount) > 0) riskFlags.push({ flag: 'collections_on_file', count: num(ds.collectionsCount) });
  if (num(ds.chargeOffsCount) > 0) riskFlags.push({ flag: 'charge_offs_on_file', count: num(ds.chargeOffsCount) });
  const lates = (num(ds._30DayLates) || 0) + (num(ds._60DayLates) || 0) + (num(ds._90DayLates) || 0);
  if (lates > 0) riskFlags.push({ flag: 'late_payments_recorded', count: lates, mostRecentLateDate: str(ds.mostRecentLateDate) || null });
  if (num(ts.revolvingCreditUtilization) != null && num(ts.revolvingCreditUtilization) >= 50) riskFlags.push({ flag: 'elevated_revolving_utilization', utilizationPercent: num(ts.revolvingCreditUtilization) });
  if (num(ds.pastDueTotal) > 0 || num(ts.pastDueTotal) > 0) riskFlags.push({ flag: 'past_due_balance', amount: num(ts.pastDueTotal) != null ? num(ts.pastDueTotal) : num(ds.pastDueTotal) });
  if (!riskFlags.length && score) riskFlags.push({ flag: 'no_derogatory_marks_in_file' });

  return {
    subject: { firstName: str(req.firstName), lastName: str(req.lastName) },
    bureaus,
    pulledAt: str(detail.dateRequested),
    requestingParty: str(detail.requestingParty && detail.requestingParty.name),
    alertMessages: Array.isArray(raw.responseAlertMessages) ? raw.responseAlertMessages.filter(a => typeof a === 'string' && a).slice(0, 5) : [],
    score,
    tradelines: {
      count: num(ts.tradesCount) != null ? num(ts.tradesCount) : tradelines.length,
      openCount,
      satisfactoryCount: num(ds.satisfactoryTradelineCount),
      balanceTotal: num(ts.balanceTotal),
      pastDueTotal: num(ts.pastDueTotal),
      revolvingUtilizationPercent: num(ts.revolvingCreditUtilization),
      oldestTradelineDate: str(ts.oldestTradelineDate)
    },
    derogatory: {
      bankruptcies: num(ds.bankruptciesCount),
      collections: num(ds.collectionsCount),
      chargeOffs: num(ds.chargeOffsCount),
      publicRecords: num(ds.publicRecordsCount),
      latePayments30: num(ds._30DayLates),
      latePayments60: num(ds._60DayLates),
      latePayments90: num(ds._90DayLates),
      mostRecentLateDate: str(ds.mostRecentLateDate) || null,
      disputes: num(ds.disputesCount)
    },
    inquiries: { count: num(ds.inquiriesCount) != null ? num(ds.inquiriesCount) : inquiries.length, recent: inquiries },
    riskFlags
  };
}

// Fetch + normalize the synthetic-persona report as a LABELED demonstration of
// the principal-credit step in supplier/vendor vetting. Never throws on HTTP or
// parse failure; returns { ok:false, error } states instead.
async function fetchPrincipalCreditEvidenceFresh({ env = process.env, fetchImpl = fetch, persona = SPEC_PERSONA, config } = {}) {
  const st = crsCreditStatus(env);
  if (!st.configured) return { ok: false, error: 'not_configured' };
  const base = (env.CRS_SANDBOX_BASE && env.CRS_SANDBOX_BASE.trim()) || DEFAULT_BASE;
  const cfg = (config && String(config).trim()) || (env.CRS_SANDBOX_CONFIG && env.CRS_SANDBOX_CONFIG.trim()) || DEFAULT_CONFIG;
  let token;
  try { token = await login(env, fetchImpl); } catch (e) { return { ok: false, error: 'auth_failed', detail: String(e.message || e) }; }
  let r;
  try {
    r = await timedFetch(fetchImpl, base + '/experian/credit-report/standard/' + encodeURIComponent(cfg), {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(persona)
    });
  } catch (e) { return { ok: false, error: 'network_error', detail: String(e && e.message || e) }; }
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) return { ok: false, error: 'crs_error', httpStatus: r.status };
  const evidence = normalizeCreditReport(data);
  if (!evidence) return { ok: false, error: 'unrecognized_response' };
  return {
    ok: true,
    demonstration: true,
    label: 'Principal credit check demonstrated on the CRS sponsor sandbox\'s synthetic test persona (' +
      (evidence.subject.firstName || '') + ' ' + (evidence.subject.lastName || '') +
      ', from the sponsor\'s own spec example). Not a real consumer, not business credit, not about any company in this tool. ' +
      'In a live supplier/vendor workflow this step evaluates a business principal with a permitted purpose.',
    config: cfg,
    evidence
  };
}

// Short response cache + inflight coalescing. The demo route is public, so
// every page load would otherwise make a fresh sandbox login+report call.
// Successful results replay from memory for the TTL (default 5 minutes,
// CRS_CREDIT_CACHE_TTL_MS to change); concurrent callers share one in-flight
// fetch; failures are never cached. In-memory only, per process.
const responseCache = new Map(); // key -> { at, value }
const inflight = new Map();      // key -> Promise
export async function fetchPrincipalCreditEvidence({ env = process.env, fetchImpl = fetch, persona = SPEC_PERSONA, config, cacheTtlMs } = {}) {
  const base = (env.CRS_SANDBOX_BASE && env.CRS_SANDBOX_BASE.trim()) || DEFAULT_BASE;
  const cfg = (config && String(config).trim()) || (env.CRS_SANDBOX_CONFIG && env.CRS_SANDBOX_CONFIG.trim()) || DEFAULT_CONFIG;
  const ttl = Number.isFinite(cacheTtlMs) ? cacheTtlMs : (Number(env.CRS_CREDIT_CACHE_TTL_MS) || 300_000);
  const ck = base + '|' + String(env.CRS_SANDBOX_USERNAME || '') + '|' + cfg + '|' + JSON.stringify(persona);
  const hit = responseCache.get(ck);
  if (hit && Date.now() - hit.at < ttl) return { ...structuredClone(hit.value), cached: true };
  if (inflight.has(ck)) return inflight.get(ck);
  const p = fetchPrincipalCreditEvidenceFresh({ env, fetchImpl, persona, config });
  inflight.set(ck, p);
  try {
    const r = await p;
    if (r && r.ok && ttl > 0) responseCache.set(ck, { at: Date.now(), value: structuredClone(r) });
    return r;
  } finally {
    inflight.delete(ck);
  }
}

// Report-ready section for the vet pack. The builder calls this when the
// buyer's role is supplier/vendor qualification; the section is self-labeling
// and safe to render verbatim. Returns an honest unavailable state, never throws.
export async function creditEvidenceSection({ env = process.env, fetchImpl = fetch } = {}) {
  const r = await fetchPrincipalCreditEvidence({ env, fetchImpl });
  if (!r.ok) {
    return {
      section: 'principal_credit_evidence',
      state: r.error === 'not_configured' ? 'not_configured' : 'unavailable',
      detail: r.error === 'not_configured'
        ? 'Credit evidence source not connected.'
        : 'Credit evidence source did not return data for this demonstration (' + r.error + ').'
    };
  }
  return {
    section: 'principal_credit_evidence',
    state: 'demonstration',
    demonstration: true,
    label: r.label,
    pulledAt: r.evidence.pulledAt,
    evidence: r.evidence,
    caveats: [
      'Synthetic sandbox persona: these values describe no real person and no company.',
      'A consumer credit score is not a business credit rating and is not, alone, a supplier qualification decision.'
    ]
  };
}
