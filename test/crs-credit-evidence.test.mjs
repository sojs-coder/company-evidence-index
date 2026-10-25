// CRS credit evidence: live-schema normalization, PII discipline, honest states.
// Fixture: trimmed capture of the REAL CalHacks sandbox response for the
// sponsor's synthetic persona (api-sandbox.stitchcredit.com, 2026-10-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsCreditStatus, normalizeCreditReport, fetchPrincipalCreditEvidence, creditEvidenceSection, SPEC_PERSONA } from '../crs-credit-evidence.mjs';

const ENV = { CRS_SANDBOX_USERNAME: 'CalhacksDev120', CRS_SANDBOX_PASSWORD: 'secret-pw' };
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const FIXTURE = {
  "requestData": {
    "firstName": "MARGARET",
    "lastName": "OKAFOR"
  },
  "repositoryIncluded": {
    "transunion": false,
    "experian": true,
    "equifax": false
  },
  "responseDetail": {
    "dateRequested": "2026-10-25T14:08:43.912591Z",
    "requestingParty": {
      "name": "CALHACKS13"
    }
  },
  "responseAlertMessages": [],
  "scores": [
    {
      "borrowerSourceType": "Borrower",
      "modelName": "VantageScore 4.0",
      "modelNameType": "V4",
      "sourceType": "Experian",
      "factaInquiriesIndicator": false,
      "scoreValue": "790",
      "scoreRankPercentileValue": "71",
      "scoreMaximumValue": "850",
      "scoreMinimumValue": "300",
      "scoreFactors": [
        {
          "scoreFactorCode": "49",
          "scoreFactorText": "Not enough balance paid down over time on revolving accounts"
        },
        {
          "scoreFactorCode": "67",
          "scoreFactorText": "No open real estate secured loans in your credit file"
        },
        {
          "scoreFactorCode": "28",
          "scoreFactorText": "Average credit limit on open bankcards is too low"
        },
        {
          "scoreFactorCode": "32",
          "scoreFactorText": "Oldest bankcard was opened too recently"
        }
      ]
    }
  ],
  "inquiries": [
    {
      "creditorName": "CAPITAL AUTO FINANCE",
      "borrowerSourceType": "Borrower",
      "inquiryDate": "2026-08-19",
      "businessType": "Finance",
      "subscriberCode": "1640540",
      "sourceType": "Experian"
    }
  ],
  "tradelines": [
    {
      "accountIdentifier": "CALHACKS-REV-1",
      "accountOpenedDate": "2010-10-19",
      "accountOwnershipType": "Individual",
      "accountReportedDate": "2026-09-19",
      "accountStatusType": "Open",
      "accountType": "Revolving",
      "borrowerSourceType": "Borrower",
      "creditLimitAmount": "5000",
      "derogatoryDataIndicator": false,
      "highBalanceAmount": "2000",
      "lastActivityDate": "2026-09-19",
      "monthsReviewedCount": "99",
      "creditorName": "NORTHSTAR BANK VISA",
      "subscriberCode": "2375173",
      "pastDueAmount": "0",
      "currentBalanceAmount": "400",
      "businessType": "Banking",
      "loanType": "CreditCard",
      "_30DayLates": "0",
      "_60DayLates": "0",
      "_90DayLates": "0",
      "currentRatingCode": "C",
      "currentRatingType": "AsAgreed",
      "paymentPatternData": "CCCCCCCCCCCCCCCCCCCCCCCC",
      "paymentPatternStartDate": "2026-09-19",
      "sourceType": "Experian"
    }
  ],
  "publicRecords": [],
  "summaries": {
    "tradeSummary": {
      "mortgageTradesCount": "0",
      "mortgageBalanceTotal": "0",
      "mortgageHighCreditTotal": "0",
      "mortgagePaymentsTotal": "0",
      "mortgagePastDueTotal": "0",
      "autoTradesCount": "3",
      "autoBalanceTotal": "15600",
      "autoHighCreditTotal": "37560",
      "autoPaymentsTotal": "326",
      "autoPastDueTotal": "0",
      "educationTradesCount": "0",
      "educationBalanceTotal": "0",
      "educationHighCreditTotal": "0",
      "educationPaymentsTotal": "0",
      "educationPastDueTotal": "0",
      "openTradesCount": "0",
      "openBalanceTotal": "0",
      "openHighCreditTotal": "0",
      "openPaymentsTotal": "0",
      "openPastDueTotal": "0",
      "revolvingTradesCount": "9",
      "revolvingBalanceTotal": "2800",
      "revolvingHighCreditTotal": "44800",
      "revolvingPaymentsTotal": "0",
      "revolvingPastDueTotal": "0",
      "unknownTradesCount": "0",
      "unknownBalanceTotal": "0",
      "unknownHighCreditTotal": "0",
      "unknownPaymentsTotal": "0",
      "unknownPastDueTotal": "0",
      "installmentOtherTradesCount": "0",
      "installmentOtherBalanceTotal": "0",
      "installmentOtherHighCreditTotal": "0",
      "installmentOtherPaymentsTotal": "0",
      "installmentOtherPastDueTotal": "0",
      "applicableMortgagePaymentsTotal": "0",
      "applicableAutoPaymentsTotal": "326",
      "applicableEducationPaymentsTotal": "0",
      "applicableOpenPaymentsTotal": "0",
      "applicableRevolvingPaymentsTotal": "0",
      "applicableUnknownPaymentsTotal": "0",
      "applicableInstallmentPaymentsTotal": "326",
      "applicableInstallmentOtherPaymentsTotal": "0",
      "applicableMortgageHighCreditTotal": "0",
      "applicableAutoHighCreditTotal": "25960",
      "applicableEducationHighCreditTotal": "0",
      "applicableOpenHighCreditTotal": "0",
      "applicableRevolvingHighCreditTotal": "35000",
      "applicableUnknownHighCreditTotal": "0",
      "applicableInstallmentHighCreditTotal": "25960",
      "applicableInstallmentOtherHighCreditTotal": "0",
      "tradesCount": "12",
      "balanceTotal": "18400",
      "applicablePaymentsTotal": "326",
      "applicableHighCreditTotal": "60960",
      "highCreditTotal": "82360",
      "paymentsTotal": "326",
      "pastDueTotal": "0",
      "securedDebtBalanceTotal": "15600",
      "unsecuredDebtBalanceTotal": "2800",
      "oldestTradelineDate": "2010-10-19",
      "oldestTradelineCreditorName": "NORTHSTAR BANK VISA",
      "revolvingCreditUtilization": "8",
      "totalDebtHighCreditRatio": "30"
    },
    "derogatorySummary": {
      "chargeOffsCount": "0",
      "collectionsCount": "0",
      "bankruptciesCount": "0",
      "publicRecordsCount": "0",
      "satisfactoryTradelineCount": "12",
      "_30DayLates": "0",
      "_60DayLates": "0",
      "_90DayLates": "0",
      "inquiriesCount": "1",
      "mostRecentLateDate": "",
      "disputesCount": "0",
      "currentAdverseTradelineCount": "0",
      "priorAdverseTradelineCount": "0",
      "otherCount": "0",
      "securedDebtBalanceTotal": "15600",
      "unsecuredDebtBalanceTotal": "2800"
    }
  }
};

test('status: not_configured without env, configured with both vars', () => {
  assert.equal(crsCreditStatus({}).state, 'not_configured');
  assert.equal(crsCreditStatus({ CRS_SANDBOX_USERNAME: 'u' }).state, 'not_configured');
  assert.equal(crsCreditStatus(ENV).state, 'configured');
});

test('normalizeCreditReport maps the real top-level schema (scores, summaries, inquiries)', () => {
  const ev = normalizeCreditReport(FIXTURE);
  assert.equal(ev.subject.firstName, 'MARGARET');
  assert.deepEqual(ev.bureaus, ['experian']);
  assert.equal(ev.score.model, 'VantageScore 4.0');
  assert.equal(ev.score.value, 790);
  assert.equal(ev.score.minimum, 300);
  assert.equal(ev.score.maximum, 850);
  assert.equal(ev.score.percentile, 71);
  assert.ok(ev.score.factors.length >= 1);
  assert.equal(ev.tradelines.count, 12);
  assert.equal(ev.tradelines.openCount, 1);
  assert.equal(ev.tradelines.balanceTotal, 18400);
  assert.equal(ev.tradelines.revolvingUtilizationPercent, 8);
  assert.equal(ev.tradelines.oldestTradelineDate, '2010-10-19');
  assert.equal(ev.derogatory.bankruptcies, 0);
  assert.equal(ev.derogatory.latePayments30, 0);
  assert.equal(ev.inquiries.count, 1);
  assert.equal(ev.inquiries.recent[0].creditor, 'CAPITAL AUTO FINANCE');
  assert.deepEqual(ev.riskFlags, [{ flag: 'no_derogatory_marks_in_file' }]);
  assert.equal(ev.requestingParty, 'CALHACKS13');
  assert.ok(ev.pulledAt);
});

test('normalizer output never carries PII or account identifiers present in the raw response', () => {
  const s = JSON.stringify(normalizeCreditReport(FIXTURE));
  for (const banned of ['666701001', 'WILLOW CREEK', 'CALHACKS-REV-1', 'subscriberCode', 'TL DESIGN', 'paymentPatternData']) {
    assert.ok(!s.includes(banned), 'leaked: ' + banned);
  }
});

test('normalizer flags derogatory data when present', () => {
  const fx = JSON.parse(JSON.stringify(FIXTURE));
  fx.summaries.derogatorySummary.collectionsCount = 2;
  fx.summaries.derogatorySummary._30DayLates = 1;
  fx.summaries.derogatorySummary.mostRecentLateDate = '2026-07-01';
  fx.summaries.tradeSummary.revolvingCreditUtilization = 72;
  const ev = normalizeCreditReport(fx);
  const flags = ev.riskFlags.map(f => f.flag);
  assert.ok(flags.includes('collections_on_file'));
  assert.ok(flags.includes('late_payments_recorded'));
  assert.ok(flags.includes('elevated_revolving_utilization'));
  assert.ok(!flags.includes('no_derogatory_marks_in_file'));
});

test('normalizeCreditReport: null/garbage in, null out; empty object yields empty evidence; never throws', () => {
  assert.equal(normalizeCreditReport(null), null);
  assert.equal(normalizeCreditReport('nope'), null);
  const ev = normalizeCreditReport({});
  assert.equal(ev.score, null);
  assert.equal(ev.tradelines.count, 0);
  assert.deepEqual(ev.bureaus, []);
  assert.deepEqual(ev.riskFlags, []);
});

test('fetchPrincipalCreditEvidence: login once, spec persona body, labeled demo output, no secret leakage', async () => {
  const seen = [];
  const fakeFetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts.headers.authorization || null, body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).endsWith('/users/login')) return ok({ token: 'tok-1', expires: new Date(Date.now() + 3600e3).toISOString() });
    return ok(FIXTURE);
  };
  const r = await fetchPrincipalCreditEvidence({ env: ENV, fetchImpl: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.demonstration, true);
  assert.match(r.label, /synthetic test persona/);
  assert.match(r.label, /not business credit/i);
  assert.equal(r.evidence.score.value, 790);
  assert.equal(seen[0].url, 'https://api-sandbox.stitchcredit.com/api/users/login');
  assert.equal(seen[1].auth, 'Bearer tok-1');
  assert.equal(seen[1].body.firstName, SPEC_PERSONA.firstName);
  const s = JSON.stringify(r);
  assert.ok(!s.includes('secret-pw') && !s.includes('tok-1'), 'no credentials or tokens in output');
});

test('auth failure surfaces as auth_failed, never throws', async () => {
  const fakeFetch = async () => ok({ message: 'bad credentials' }, 401);
  const r = await fetchPrincipalCreditEvidence({ env: { CRS_SANDBOX_USERNAME: 'other', CRS_SANDBOX_PASSWORD: 'x' }, fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'auth_failed');
});

test('not_configured: no network call', async () => {
  let called = false;
  const r = await fetchPrincipalCreditEvidence({ env: {}, fetchImpl: () => { called = true; } });
  assert.equal(r.error, 'not_configured');
  assert.equal(called, false);
});

test('creditEvidenceSection: report-ready, self-labeling; honest unavailable state', async () => {
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/users/login')) return ok({ token: 'tok-1', expires: new Date(Date.now() + 3600e3).toISOString() });
    return ok(FIXTURE);
  };
  const sec = await creditEvidenceSection({ env: ENV, fetchImpl: fakeFetch });
  assert.equal(sec.section, 'principal_credit_evidence');
  assert.equal(sec.state, 'demonstration');
  assert.equal(sec.demonstration, true);
  assert.ok(Array.isArray(sec.caveats) && sec.caveats.length === 2);
  const off = await creditEvidenceSection({ env: {}, fetchImpl: () => { throw new Error('must not be called'); } });
  assert.equal(off.state, 'not_configured');
});

test('response cache: a second call within the TTL makes no network call and marks cached', async () => {
  let fetches = 0;
  const fakeFetch = async (url) => {
    fetches++;
    if (String(url).endsWith('/users/login')) return ok({ token: 'tok-c', expires: new Date(Date.now() + 3600e3).toISOString() });
    return ok(FIXTURE);
  };
  const env = { CRS_SANDBOX_USERNAME: 'cache-user-1', CRS_SANDBOX_PASSWORD: 'pw' };
  const first = await fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch });
  assert.equal(first.ok, true);
  assert.equal(first.cached, undefined);
  const after = fetches;
  const second = await fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch });
  assert.equal(second.ok, true);
  assert.equal(second.cached, true);
  assert.equal(fetches, after, 'no network on cache hit');
  assert.equal(second.evidence.score.value, 790);
});

test('inflight coalescing: concurrent callers share one sandbox round trip', async () => {
  let reportCalls = 0;
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/users/login')) return ok({ token: 'tok-d', expires: new Date(Date.now() + 3600e3).toISOString() });
    reportCalls++;
    await new Promise(r => setTimeout(r, 20));
    return ok(FIXTURE);
  };
  const env = { CRS_SANDBOX_USERNAME: 'cache-user-2', CRS_SANDBOX_PASSWORD: 'pw' };
  const [a, b] = await Promise.all([
    fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch }),
    fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch })
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(reportCalls, 1);
});

test('failures are never cached: a retry after auth_failed reaches the network', async () => {
  let fetches = 0;
  const fakeFetch = async () => { fetches++; return ok({ message: 'bad credentials' }, 401); };
  const env = { CRS_SANDBOX_USERNAME: 'cache-user-3', CRS_SANDBOX_PASSWORD: 'pw' };
  const r1 = await fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch });
  assert.equal(r1.error, 'auth_failed');
  const r2 = await fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch });
  assert.equal(r2.error, 'auth_failed');
  assert.equal(fetches, 2, 'each failed attempt hit the network');
});

test('expired TTL refetches', async () => {
  let reportCalls = 0;
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/users/login')) return ok({ token: 'tok-e', expires: new Date(Date.now() + 3600e3).toISOString() });
    reportCalls++;
    return ok(FIXTURE);
  };
  const env = { CRS_SANDBOX_USERNAME: 'cache-user-4', CRS_SANDBOX_PASSWORD: 'pw' };
  await fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch, cacheTtlMs: 1 });
  await new Promise(r => setTimeout(r, 5));
  const r = await fetchPrincipalCreditEvidence({ env, fetchImpl: fakeFetch, cacheTtlMs: 1 });
  assert.equal(r.cached, undefined);
  assert.equal(reportCalls, 2);
});
