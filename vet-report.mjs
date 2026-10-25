// Company+question cited research report (Cal Hacks 13.0 scope direction):
// input is any company name plus the buyer's actual evaluation question;
// output is a cited evidence report that answers through quoted findings and
// stated limitations. Two phases: identify (candidates, explicitly labeled)
// then report (one explicitly selected identity). Nothing is fabricated.
// No LLM in the backend: synthesis is extractive templates over live sources.
// Context.dev connectors activate only when CONTEXT_DEV_API_KEY is configured;
// without it they report not_configured and the pack still builds from keyless
// public sources.

import { readFile } from 'node:fs/promises';

const STOP_TOKENS = new Set(['inc','llc','ltd','corp','corporation','company','co','the','lp','llp','holdings','technologies','systems']);
// Generic name tokens: overlap on these alone is not identity evidence
// (every robotics company shares 'robotics'). Used to hide weak brand
// candidates before rendering rather than leaning on the disclaimer.
const GENERIC_TOKENS = new Set(['robotics','technology','technologies','systems','solutions','labs','industries','group','global','international','ai','software','services','research','space','digital','analytics','automation']);
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

// Identity candidates: SEC public-company listings (seeded snapshot first,
// live fetch as fallback) + USASpending legal recipient names + Context.dev
// brand search when configured.
const SEED_PATH = new URL('./data/public-companies-seed.json', import.meta.url);
async function loadSecSeed() {
  try {
    const j = JSON.parse(await readFile(SEED_PATH, 'utf8'));
    return Array.isArray(j.companies) && j.companies.length ? j : null;
  } catch { return null; }
}
async function resolveIdentities(name, queryToks, key, sources) {
  const identities = [];
  let hiddenWeak = 0;
  // SEC public listings: seeded snapshot (name/ticker/exchange, incl. NYSE)
  // first so identity never depends on a live fetch; live fetch is fallback.
  const seed = await loadSecSeed();
  if (seed) {
    for (const row of seed.companies) {
      if (nameMatches(row.name, queryToks)) {
        identities.push({ kind: 'public_company', name: row.name, ticker: row.ticker, exchange: row.exchange || null, cik: row.cik, basis: 'SEC public-listing registry name match (seeded snapshot ' + seed.snapshot + ')', state: 'registry_match' });
      }
    }
    sources.push({ key: 'sec_registry', name: 'SEC public-listing registry (seeded snapshot ' + seed.snapshot + ')', url: seed.source, fetched: identities.length, mode: 'seeded_snapshot', detail: seed.count + ' listed companies in snapshot' });
  } else {
    try {
      const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'user-agent': 'company-evidence-index/1.0 (student hackathon research project)', accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        for (const row of Object.values(j)) {
          if (nameMatches(row.title, queryToks)) {
            identities.push({ kind: 'public_company', name: row.title, ticker: row.ticker, cik: row.cik_str, basis: 'SEC company registry name match', state: 'registry_match' });
          }
        }
        sources.push({ key: 'sec_registry', name: 'SEC company registry', url: 'https://www.sec.gov/files/company_tickers.json', fetched: identities.length, mode: 'live', detail: 'Seed snapshot not deployed; fetched live.' });
      } else {
        sources.push({ key: 'sec_registry', name: 'SEC company registry', url: 'https://www.sec.gov/files/company_tickers.json', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
      }
    } catch (e) {
      sources.push({ key: 'sec_registry', name: 'SEC company registry', url: 'https://www.sec.gov/files/company_tickers.json', fetched: 0, mode: 'error', detail: String(e.message || e) });
    }
  }
  // Context.dev brand auto-complete: broader registry incl. private companies,
  // returns candidates with official domains used later for cited page reads.
  if (key) {
    try {
      const r = await fetch('https://api.context.dev/v1/brand/search?query=' + encodeURIComponent(name) + '&country=US', { headers: { authorization: 'Bearer ' + key, accept: 'application/json' } });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      const j = await r.json();
      const rows = j.results || j.brands || j.data || [];
      // Relevance gate: a brand candidate must share at least one distinctive
      // (non-generic) query token with the typed name or its domain; token
      // overlap on generic words alone ('robotics', 'labs') is not identity
      // evidence and those candidates are hidden, not disclaimed.
      const distinctiveQuery = queryToks.filter(t => !GENERIC_TOKENS.has(t));
      for (const c of (Array.isArray(rows) ? rows : []).slice(0, 8)) {
        const cn = c.name || c.title || c.company;
        if (!cn) continue;
        const cnToks = nameTokens(cn);
        const dom = String(c.domain || '').toLowerCase();
        const shared = queryToks.filter(t => cnToks.includes(t) || (dom && dom.includes(t)));
        if (distinctiveQuery.length && !shared.some(t => !GENERIC_TOKENS.has(t))) { hiddenWeak++; continue; }
        identities.push({ kind: 'brand_match', name: cn, domain: c.domain || null, description: c.description || null, basis: 'Context.dev brand registry match', state: nameMatches(cn, queryToks) ? 'registry_match' : 'candidate_match' });
      }
      sources.push({ key: 'ctx_brand', name: 'Context.dev brand search', url: 'https://www.context.dev/', fetched: Array.isArray(rows) ? Math.min(rows.length, 8) : 0, mode: 'live', creditsCounted: 1, detail: hiddenWeak ? hiddenWeak + ' weak match' + (hiddenWeak === 1 ? '' : 'es') + ' hidden: generic-token overlap only' : undefined });
    } catch (e) {
      sources.push({ key: 'ctx_brand', name: 'Context.dev brand search', url: 'https://www.context.dev/', fetched: 0, mode: 'error', detail: String(e.message || e) });
    }
  } else {
    sources.push({ key: 'ctx_brand', name: 'Context.dev brand search', url: 'https://www.context.dev/', fetched: 0, mode: 'not_configured', detail: 'CONTEXT_DEV_API_KEY not set; this connector is off, not failed.' });
  }
  return { identities, hiddenWeak };
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
  const rid = await resolveIdentities(name, queryToks, key, sources);
  pack.identities = rid.identities;
  if (rid.hiddenWeak) pack.hiddenWeakBrandMatches = rid.hiddenWeak;

  // USASpending: federal award history grouped by exact legal recipient name.
  try {
    const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filters: { recipient_search_text: [name], award_type_codes: ['A', 'B', 'C', 'D'] },
        fields: ['Award ID', 'Recipient Name', 'Start Date', 'Award Amount', 'Awarding Agency', 'Description'],
        limit: 100, sort: 'Start Date', order: 'desc'
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
        limit: 100, sort: 'Start Date', order: 'desc'
      })
    });
    if (r.ok) {
      const j = await r.json();
      // Selected legal recipient: exact recorded-name match only - token
      // matching would silently pool distinct legal entities (LLC vs LTD.).
      // Buyer-asserted (custom) names fall back to token matching, and the
      // pack already labels those as not registry-verified.
      const exact = (identity.kind === 'legal_recipient');
      const keep = (a) => {
        const rn = String(a['Recipient Name'] || '');
        return exact ? rn.trim().toUpperCase() === identity.name.trim().toUpperCase() : nameMatches(rn, idToks);
      };
      const rawCount = (j.results || []).length;
      // Fewer records than the page size means the search's full result set
      // came back in one page; a full page means this is a sample.
      const complete = rawCount < 100;
      pack.awardCoverage = complete ? 'complete_result_set' : 'first_page_sample';
      const awards = (j.results || []).filter(keep).map(a => ({
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
          statement: (() => {
            const n = awards.length, pl = n === 1 ? '' : 's';
            const scope = {
              legal_recipient: 'under this exact legal name',
              public_company: 'name-matching this SEC-registered public-company name',
              brand_match: 'name-matching this brand-registry name (registry match, not legal-entity resolution)'
            }[identity.kind] || 'name-matching the buyer-typed (not registry-verified) name';
            const totalStr = total != null ? ' totaling $' + Math.round(total).toLocaleString('en-US') : '';
            return complete
              ? `USASpending award search ${scope} returned ${n} award record${pl} - the complete result set of that search -${totalStr} across those records.`
              : `USASpending award search ${scope} returned ${n} matching award record${pl} from the first page of results - a sample, not the full award history -${totalStr} across the returned records.`;
          })(),
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

  // NASA NTRS: citations whose author-reported affiliation org name matches
  // the selected name by token overlap. That is not legal-entity verification.
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
            ? { state: 'author_affiliation_orgname_match', organizations: matched, method: 'organization-name token overlap on author-reported affiliation; not legal-entity verification' }
            : { state: 'search_match', organizations: orgs.slice(0, 3) }
        };
      }).filter(c => c.title && !seen.has(c.title) && seen.add(c.title));
      const verified = pack.citations.filter(c => c.association.state === 'author_affiliation_orgname_match');
      if (verified.length) {
        pack.findings.push({
          topic: 'technical_literature',
          statement: `${verified.length} NASA technical report${verified.length === 1 ? '' : 's'} list an author affiliation whose organization name matches this name by token overlap - an author-reported affiliation string, not legal-entity verification.`,
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
  // Deterministic extractive conflict checks. No LLM: only string/registry
  // signals, each labeled with its method. Findings are surfaced, not resolved.
  pack.conflictChecks = [];
  // 1. Name variants inside quoted passages: sources may call the entity by
  // other names. Variants are shown as written, never merged or equated.
  try {
    const baseToks = nameTokens(identity.name).filter(t => !GENERIC_TOKENS.has(t));
    if (baseToks.length) {
      const variants = new Set();
      const rx = /\b([A-Z][A-Za-z0-9&]*(?: [A-Z][A-Za-z0-9&]*){0,5} (?:LLC|LLP|LP|Inc\.?|Ltd\.?|Corp\.?|Corporation|Company|Co\.))\b/g;
      for (const q of (pack.quotes || [])) {
        const text = String(q.passage || '');
        let m;
        while ((m = rx.exec(text))) {
          const v = m[1].replace(/\s+/g, ' ').trim();
          const vt = nameTokens(v);
          if (baseToks.every(t => vt.includes(t)) && v.toUpperCase() !== identity.name.trim().toUpperCase()) variants.add(v);
        }
      }
      if (variants.size) {
        pack.conflictChecks.push({
          check: 'name_variants_in_sources',
          finding: 'Quoted sources also refer to: ' + [...variants].slice(0, 4).map(v => '"' + v + '"').join(', ') + '. Name variants are shown exactly as written; they are not verified to be the same legal entity as the selected one.',
          method: 'capitalized-name + legal-suffix extraction over quoted passages; token overlap with the selected name'
        });
      }
    }
  } catch { /* a failed conflict check is omitted, never fabricated */ }
  // 2. Brand-domain redirect: a selected brand identity whose domain redirects
  // to a different host signals possible acquisition/rebrand drift.
  try {
    if (identity.kind === 'brand_match' && identity.domain) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const rr = await fetch('https://' + identity.domain, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'company-evidence-index/1.0 (student hackathon research project)' } });
      clearTimeout(to);
      const finalHost = new URL(rr.url).hostname.replace(/^www\./, '');
      const origHost = String(identity.domain).replace(/^www\./, '');
      if (finalHost && origHost && finalHost !== origHost) {
        pack.conflictChecks.push({
          check: 'domain_redirect',
          finding: identity.domain + ' redirects to ' + finalHost + '. That can signal an acquisition, merger or rebrand; this report does not resolve identity drift automatically.',
          method: 'HTTP redirect resolution of the registry-listed domain; final host compared to the recorded host'
        });
      }
    }
  } catch { /* unreachable domain: no claim either way */ }

  // Third-party synthesis: Context.dev Web Answers writes an LLM-generated
  // summary from public sources it cites. This is a generated synthesis -
  // NOT extractive evidence and NOT a deterministic check - kept in its own
  // field, labeled with its method, and rendered separately in the UI.
  if (key && question) {
    try {
      const j = await ctxCall('/web/answers', {
        mode: 'fast',
        task: 'Research the company ' + identity.name + ' for this buyer question: ' + question + '. Answer only from public sources you can cite. Preserve exact money semantics: a contract ceiling or maximum value must be stated as a maximum ("a maximum $X contract"), never as obligated spend, received funds, or revenue. If the sources do not establish which, say so.',
        json_format: { summary: 'string', evidence_points: ['string'], open_questions: ['string'] }
      }, key);
      const content = j.json_content || null;
      // A bare URL is not an evidence point: move URL-only entries to the
      // synthesis source list; they are sources, not analytical content.
      if (content && Array.isArray(content.evidence_points)) {
        const kept = [], urlPts = [];
        for (const p of content.evidence_points) {
          const s2 = String(p).trim();
          (/^https?:\/\/\S+$/.test(s2) ? urlPts : kept).push(s2);
        }
        content.evidence_points = kept;
        for (const u of urlPts) j.sources = (Array.isArray(j.sources) ? j.sources : []).concat([u]);
      }
      // Deterministic claim check: sentences carrying a $ figure but no
      // amount-semantics qualifier (maximum/ceiling/obligated/revenue...) are
      // flagged and rendered with the finding. Generation is not trusted to
      // keep ceiling-vs-obligated straight; this check does not resolve the
      // figure, it marks what needs source verification.
      const QUALIFIER = /maximum|ceiling|up to|obligat|outlay|revenue|appropriat|totaling|award of|valued at/i;
      const FIGURE = /\$[\d.,]+\s*(?:billion|million|thousand|trillion)?/i;
      const flagged = [];
      if (content) {
        const scan = [content.summary || '', ...(Array.isArray(content.evidence_points) ? content.evidence_points : [])];
        for (const t of scan) {
          for (const s of String(t).split(/(?<=[.!?])\s+/)) {
            if (FIGURE.test(s) && !QUALIFIER.test(s)) flagged.push(s.trim());
          }
        }
      }
      pack.synthesis = {
        provider: 'Context.dev Web Answers',
        method: 'third-party LLM synthesis over cited public sources; generated, not extractive, not deterministic',
        mode: 'fast',
        content,
        amountCheck: {
          method: 'deterministic sentence scan: $ figure without a ceiling/obligated/revenue qualifier; flags for source verification, does not resolve',
          flagged
        },
        sources: (Array.isArray(j.sources) ? j.sources : []).map(s => {
          if (typeof s === 'string') return s.startsWith('http') ? { title: null, url: s } : null;
          const url = s && (s.url || s.link || s.href || s.source_url);
          return url ? { title: (s.title || s.name || null), url } : null;
        }).filter(Boolean),
        partial: !!j.partial
      };
      sources.push({ key: 'ctx_answers', name: 'Context.dev Web Answers (third-party LLM synthesis)', url: 'https://www.context.dev/', fetched: pack.synthesis.sources.length, mode: 'live', creditsCounted: 10, detail: pack.synthesis.partial ? 'partial synthesis' : 'synthesis generated from cited sources' });
    } catch (e) {
      pack.synthesis = { unavailable: 'The third-party synthesis call failed (' + String(e.message || e) + '). The extractive evidence and deterministic checks above are unaffected.' };
      sources.push({ key: 'ctx_answers', name: 'Context.dev Web Answers (third-party LLM synthesis)', url: 'https://www.context.dev/', fetched: 0, mode: 'error', detail: String(e.message || e) });
    }
  } else {
    sources.push({ key: 'ctx_answers', name: 'Context.dev Web Answers (third-party LLM synthesis)', url: 'https://www.context.dev/', fetched: 0, mode: key ? 'skipped' : 'not_configured', detail: key ? 'No evaluation question given.' : 'CONTEXT_DEV_API_KEY not set; this connector is off, not failed.' });
  }


  return pack;
}
