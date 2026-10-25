// Company+question cited research report (Cal Hacks 13.0 scope direction):
// input is any company name plus the buyer's actual evaluation question;
// output is a cited evidence report that answers through quoted findings and
// stated limitations. Two phases: identify (candidates, explicitly labeled)
// then report (one explicitly selected identity). Nothing is fabricated.
// No LLM in the backend: synthesis is extractive templates over live sources.
// Context.dev connectors activate only when CONTEXT_DEV_API_KEY is configured;
// without it they report not_configured and the pack still builds from keyless
// public sources.

const STOP_TOKENS = new Set(['inc','llc','ltd','corp','corporation','company','co','the','lp','llp','holdings','technologies','systems']);
const nameTokens = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !STOP_TOKENS.has(t));
const nameMatches = (candidate, toks) => {
  const rt = new Set(nameTokens(candidate));
  return toks.length > 0 && toks.every(t => rt.has(t));
};

const CATEGORIES = {
  invest:   { label: 'investment evaluation' },
  supplier: { label: 'supplier qualification' },
  vendor:   { label: 'vendor contract review' },
  general:  { label: 'general vetting' }
};

async function ctxCall(path, body, key) {
  const r = await fetch('https://api.context.dev/v1' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

// Identity candidates: SEC public-company registry (keyless) + USASpending
// legal recipient names + Context.dev company search when configured.
async function resolveIdentities(name, queryToks, key, sources) {
  const identities = [];
  // SEC company registry: public companies only, exact-ish ticker/name match.
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'user-agent': 'company-evidence-index/1.0 (student hackathon research project)', accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      for (const row of Object.values(j)) {
        if (nameMatches(row.title, queryToks)) {
          identities.push({ kind: 'public_company', name: row.title, ticker: row.ticker, cik: row.cik_str, basis: 'SEC company registry name match', state: 'registry_match' });
        }
      }
      sources.push({ key: 'sec_registry', name: 'SEC company registry', url: 'https://www.sec.gov/files/company_tickers.json', fetched: identities.length, mode: 'live' });
    } else {
      sources.push({ key: 'sec_registry', name: 'SEC company registry', url: 'https://www.sec.gov/files/company_tickers.json', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
    }
  } catch (e) {
    sources.push({ key: 'sec_registry', name: 'SEC company registry', url: 'https://www.sec.gov/files/company_tickers.json', fetched: 0, mode: 'error', detail: String(e.message || e) });
  }
  // Context.dev brand auto-complete: broader registry incl. private companies,
  // returns candidates with official domains used later for cited page reads.
  if (key) {
    try {
      const r = await fetch('https://api.context.dev/v1/brand/search?query=' + encodeURIComponent(name) + '&country=US', { headers: { authorization: 'Bearer ' + key, accept: 'application/json' } });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      const j = await r.json();
      const rows = j.results || j.brands || j.data || [];
      for (const c of (Array.isArray(rows) ? rows : []).slice(0, 5)) {
        const cn = c.name || c.title || c.company;
        if (cn) identities.push({ kind: 'brand_match', name: cn, domain: c.domain || null, description: c.description || null, basis: 'Context.dev brand registry match', state: nameMatches(cn, queryToks) ? 'registry_match' : 'candidate_match' });
      }
      sources.push({ key: 'ctx_brand', name: 'Context.dev brand search', url: 'https://www.context.dev/', fetched: Array.isArray(rows) ? Math.min(rows.length, 5) : 0, mode: 'live', creditsCounted: 1 });
    } catch (e) {
      sources.push({ key: 'ctx_brand', name: 'Context.dev brand search', url: 'https://www.context.dev/', fetched: 0, mode: 'error', detail: String(e.message || e) });
    }
  } else {
    sources.push({ key: 'ctx_brand', name: 'Context.dev brand search', url: 'https://www.context.dev/', fetched: 0, mode: 'not_configured', detail: 'CONTEXT_DEV_API_KEY not set; this connector is off, not failed.' });
  }
  return identities;
}

// Phase 1: identity candidates only. No company-specific synthesis happens
// until the buyer explicitly selects one candidate (or refines the name).
export async function buildVetIdentify(name) {
  const key = process.env.CONTEXT_DEV_API_KEY || null;
  const queryToks = nameTokens(name);
  const fetchedAt = new Date().toISOString();
  const sources = [];
  const pack = {
    company: name, fetchedAt, provenance: 'fetched_live', phase: 'identify',
    identities: [], recipientGroups: [], sources,
    caveats: [
      'Identity candidates come from registry name matches; distinct legal entities can share name tokens, and acquisitions or subsidiaries are not resolved automatically. Select the exact entity before any company-specific report.',
      'Absence of a record here is not evidence of absence.'
    ]
  };
  pack.identities = await resolveIdentities(name, queryToks, key, sources);

  // USASpending: federal award history grouped by exact legal recipient name.
  try {
    const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filters: { recipient_search_text: [name], award_type_codes: ['A', 'B', 'C', 'D'] },
        fields: ['Award ID', 'Recipient Name', 'Start Date', 'Award Amount', 'Awarding Agency', 'Description'],
        limit: 25, sort: 'Start Date', order: 'desc'
      })
    });
    if (r.ok) {
      const j = await r.json();
      const awards = (j.results || []).filter(a => nameMatches(a['Recipient Name'], queryToks)).map(a => ({
        awardId: a['Award ID'] || null,
        recipient: a['Recipient Name'] || null,
        startDate: a['Start Date'] || null,
        obligatedAmountUsd: (typeof a['Award Amount'] === 'number' ? a['Award Amount'] : null),
        agency: a['Awarding Agency'] || null,
        description: a['Description'] || null,
        sourceUrl: a['Award ID'] ? ('https://www.usaspending.gov/award/' + encodeURIComponent(a['Award ID'])) : null
      }));
      const groups = new Map();
      for (const a of awards) {
        const k = a.recipient || '(recipient not recorded)';
        if (!groups.has(k)) groups.set(k, { recipient: k, awardCount: 0, totalObligatedUsd: 0, totalComplete: true, awards: [] });
        const g = groups.get(k);
        g.awardCount += 1;
        if (a.obligatedAmountUsd == null) g.totalComplete = false; else g.totalObligatedUsd += a.obligatedAmountUsd;
        g.awards.push(a);
      }
      pack.recipientGroups = [...groups.values()].sort((a, b) => b.awardCount - a.awardCount)
        .map(g => ({ recipient: g.recipient, awardCount: g.awardCount, totalObligatedUsd: g.totalComplete ? g.totalObligatedUsd : null, awards: g.awards }));
      for (const g of pack.recipientGroups) {
        pack.identities.push({ kind: 'legal_recipient', name: g.recipient, awardCount: g.awardCount, basis: 'USASpending recorded legal recipient name', state: 'registry_match' });
      }
      sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: awards.length, mode: 'live' });
    } else {
      sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
    }
  } catch (e) {
    sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: 0, mode: 'error', detail: String(e.message || e) });
  }

  return pack;
}

// Phase 2: company-specific report for ONE explicitly selected identity,
// answering the buyer's free-text question through quoted findings plus
// stated limitations. Identity must be a candidate returned by identify
// (kind + name), or { kind: 'custom', name } when the buyer typed a refined
// legal name themselves - labeled as buyer-asserted, not registry-verified.
export async function buildVetReport(name, question, categoryKey, identity) {
  if (!identity || !identity.name) { const e = new Error('identity_selection_required'); e.status = 400; throw e; }
  const key = process.env.CONTEXT_DEV_API_KEY || null;
  const category = CATEGORIES[categoryKey] || CATEGORIES.general;
  const idToks = nameTokens(identity.name);
  const fetchedAt = new Date().toISOString();
  const sources = [];
  const pack = {
    company: name, question: question || null, category: category.label,
    identity: { name: identity.name, kind: identity.kind || 'custom', state: identity.kind === 'custom' ? 'buyer_asserted' : (identity.state || 'registry_match') },
    fetchedAt, provenance: 'fetched_live', phase: 'report',
    findings: [], quotes: [], sources,
    caveats: [
      'Findings quote their sources; a quoted source supports what it says, not a verdict on whether the company deserves trust. The call stays yours.',
      'Award history shows agencies agreed to buy; it does not by itself establish reliability, quality, or qualification.',
      'Absence of a record here is not evidence of absence. Public sources only; no login-walled or paywalled collection.'
    ]
  };
  if (identity.kind === 'custom') pack.caveats.push('The entity name was typed by the buyer and is not registry-verified; records below are name matches under it.');

  // USASpending scoped to the selected legal name.
  try {
    const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filters: { recipient_search_text: [identity.name], award_type_codes: ['A', 'B', 'C', 'D'] },
        fields: ['Award ID', 'Recipient Name', 'Start Date', 'Award Amount', 'Awarding Agency', 'Description'],
        limit: 25, sort: 'Start Date', order: 'desc'
      })
    });
    if (r.ok) {
      const j = await r.json();
      const awards = (j.results || []).filter(a => nameMatches(a['Recipient Name'], idToks)).map(a => ({
        awardId: a['Award ID'] || null,
        recipient: a['Recipient Name'] || null,
        startDate: a['Start Date'] || null,
        obligatedAmountUsd: (typeof a['Award Amount'] === 'number' ? a['Award Amount'] : null),
        agency: a['Awarding Agency'] || null,
        description: a['Description'] || null,
        sourceUrl: a['Award ID'] ? ('https://www.usaspending.gov/award/' + encodeURIComponent(a['Award ID'])) : null
      }));
      pack.awards = awards;
      if (awards.length) {
        const total = awards.every(a => a.obligatedAmountUsd != null) ? awards.reduce((n, a) => n + a.obligatedAmountUsd, 0) : null;
        pack.findings.push({
          topic: 'federal_awards',
          statement: `${identity.name} has ${awards.length} recorded federal contract award${awards.length === 1 ? '' : 's'}${total != null ? ' totaling $' + Math.round(total).toLocaleString('en-US') : ''} in USASpending under this exact legal name.`,
          confidence: 'source-stated',
          source: { name: 'USASpending award search', url: 'https://www.usaspending.gov/' }
        });
      }
      sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: awards.length, mode: 'live' });
    } else {
      sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
    }
  } catch (e) {
    sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: 0, mode: 'error', detail: String(e.message || e) });
  }

  // NASA NTRS: affiliation-verified citations under the selected legal name.
  try {
    const r = await fetch('https://ntrs.nasa.gov/api/citations/search?q=' + encodeURIComponent(identity.name) + '&size=8', { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      const seen = new Set();
      pack.citations = (j.results || []).map(c => {
        const orgs = [...new Set((c.authorAffiliations || []).map(a => a && a.meta && a.meta.organization && a.meta.organization.name).filter(Boolean))];
        const matched = orgs.filter(o => nameMatches(o, idToks));
        return {
          title: c.title || null,
          id: c.id || null,
          sourceUrl: c.id ? ('https://ntrs.nasa.gov/citations/' + c.id) : null,
          association: matched.length
            ? { state: 'affiliation_verified', organizations: matched }
            : { state: 'search_match', organizations: orgs.slice(0, 3) }
        };
      }).filter(c => c.title && !seen.has(c.title) && seen.add(c.title));
      const verified = pack.citations.filter(c => c.association.state === 'affiliation_verified');
      if (verified.length) {
        pack.findings.push({
          topic: 'technical_literature',
          statement: `${verified.length} NASA technical report${verified.length === 1 ? '' : 's'} list an author affiliation matching this legal name.`,
          confidence: 'source-stated',
          source: { name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/' }
        });
      }
      sources.push({ key: 'ntrs', name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/', fetched: pack.citations.length, mode: 'live' });
    } else {
      sources.push({ key: 'ntrs', name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
    }
  } catch (e) {
    sources.push({ key: 'ntrs', name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/', fetched: 0, mode: 'error', detail: String(e.message || e) });
  }

  // Context.dev: quoted passages answering the buyer's actual question.
  // Highlights over a web search for the question; every quote carries its URL.
  if (key && question) {
    try {
      const j = await ctxCall('/web/search', { query: identity.name + ' ' + question, numResults: 5 }, key);
      const results = j.results || j.data || [];
      pack.webResults = (Array.isArray(results) ? results : []).slice(0, 5).map(w => ({
        title: w.title || null, url: w.url || w.link || null, snippet: w.snippet || w.description || null
      })).filter(w => w.url);
      sources.push({ key: 'ctx_search', name: 'Context.dev web search', url: 'https://www.context.dev/', fetched: pack.webResults.length, mode: 'live', creditsCounted: 1 });
      for (const w of pack.webResults.slice(0, 2)) {
        try {
          const h = await ctxCall('/web/scrape', { url: w.url, formats: { highlights: true }, highlightsParams: { query: question, maxCharacters: 900 } }, key);
          const passages = h && h.highlights && h.highlights.data ? (Array.isArray(h.highlights.data) ? h.highlights.data : [h.highlights.data]) : [];
          for (const p of passages.slice(0, 2)) {
            pack.quotes.push({ passage: String(p).slice(0, 900), source: { name: w.title || w.url, url: w.url } });
          }
          sources.push({ key: 'ctx_highlights', name: 'Context.dev highlights', url: w.url, fetched: passages.length, mode: 'live', creditsCounted: 1 });
        } catch (e) {
          sources.push({ key: 'ctx_highlights', name: 'Context.dev highlights', url: w.url, fetched: 0, mode: 'error', detail: String(e.message || e) });
        }
      }
    } catch (e) {
      sources.push({ key: 'ctx_search', name: 'Context.dev web search', url: 'https://www.context.dev/', fetched: 0, mode: 'error', detail: String(e.message || e) });
    }
  } else {
    sources.push({ key: 'ctx_search', name: 'Context.dev web search', url: 'https://www.context.dev/', fetched: 0, mode: key ? 'skipped' : 'not_configured', detail: key ? 'No evaluation question given.' : 'CONTEXT_DEV_API_KEY not set; this connector is off, not failed.' });
  }

  // Answer assembly: extractive only. Quotes speak first; limitations state
  // what the sources could not establish for this question.
  pack.answer = {
    question: question || null,
    quotedEvidence: pack.quotes,
    findings: pack.findings,
    limitations: [
      pack.quotes.length ? null : 'No quoted passages answered the question directly from the searched public pages.',
      pack.findings.length ? null : 'No structured public records matched this exact legal name.',
      'This report does not judge whether the company deserves trust; it shows cited evidence and its limits.'
    ].filter(Boolean)
  };
  return pack;
}
