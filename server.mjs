// Company Evidence Index - demo backend (Cal Hacks 13.0)
// One process: serves the static frontend and the JSON API under /api/*.
// Zero dependencies (Node >=20). Seeded demo data only - no live source
// fetching, no LLM, no OTP provider: those are unapproved open dependencies
// (docs/auth-backend-spec.md §9). Admin mutations return an honest
// not-provisioned state instead of a fake gate. Public GETs only.
import { createServer } from 'node:http';
import { buildVetIdentify, buildVetReport } from './vet-report.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { maybeWrapWithX402, x402Status } from './x402-gate.mjs';
import { crsSandboxStatus, fetchSandboxDemoReport } from './crs-sandbox.mjs';
import { runtimeConfigStatus, extractBrokeredSecret } from './runtime-config.mjs';
import { healthProjection } from './health-projection.mjs';

const PORT = process.env.PORT || 3000;
const ROOT = new URL('.', import.meta.url).pathname;
const seed = JSON.parse(await readFile(join(ROOT, 'data', 'seed.json'), 'utf8'));

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

// Abuse controls (spec §4): per-IP token bucket, bounded inputs, enumerated filters.
const buckets = new Map();
const LIMIT = 120, WINDOW = 60_000;
function allowed(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > WINDOW) { b = { start: now, n: 0 }; buckets.set(ip, b); }
  return ++b.n <= LIMIT;
}
const STATUSES = new Set(['all', 'supported', 'unresolved', 'contradicted']);
const COMPANY = 'apple';

function send(res, code, obj, extra = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

let gateStatus = { state: 'disabled' };
function readBody(req, cap = 65536) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > cap) { reject(new Error('body_too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url, ip) {
  if (!allowed(ip)) return send(res, 429, { error: 'rate_limited', detail: 'Per-IP request budget exhausted; retry shortly.' });
  const p = url.pathname;
  // DEPRECATED 2026-10-25: this route targeted sbss-sandbox.crscreditapi.com,
  // a different CRS sandbox whose bearer-token issuance is undocumented for
  // this account and which is not part of the CalHacks sandbox spec. Kept as
  // an explicit unavailable state rather than silently removed.
  if (p === '/api/credit/sbss') {
    return send(res, 410, { error: 'deprecated', state: 'unavailable', detail: 'The SBSS sandbox host is not part of the CalHacks sandbox and its token issuance is not documented for this account. Use /api/credit/sandbox-demo for the sponsor sandbox demonstration.' });
  }
  // Sponsor sandbox demonstration: the CRS CalHacks sandbox answers with
  // synthetic TEST PERSONAS (non-billable, no real consumer). This is a demo
  // of the sponsor integration, NOT evidence about any company.
  if (p === '/api/credit/sandbox-demo') {
    const r = await fetchSandboxDemoReport();
    return send(res, r.ok ? 200 : (r.error === 'not_configured' ? 200 : 502), r);
  }

  // Per-company public-mention data packs (X/Twitter via Apify actor).
  // Admin-gated (PACK_ADMIN_TOKEN), hard spend guard. User voice 2026-10-25
  // 00:40 (iMessage): "total overall expenditure out of approved budget is
  // $10 ... do whatever you need to within that ... ask me for another 10
  // once that expires" - ONE $10 across ALL paid work (Apify + OpenAI +
  // infra). Apify share bounded at $5 here to preserve analysis headroom;
  // $0.008 already spent on the first verified scrape.
  // Public posts only; no login/private data.
  if (p === '/api/packs/collect' && req.method === 'POST') {
    if (!process.env.PACK_ADMIN_TOKEN || req.headers['x-admin-token'] !== process.env.PACK_ADMIN_TOKEN) {
      return send(res, 403, { error: 'forbidden', detail: 'Pack collection requires the admin token (PACK_ADMIN_TOKEN).' });
    }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad_json' }); }
    const ticker = String(body.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
    const company = String(body.name || '').slice(0, 120);
    const terms = Array.isArray(body.terms) ? body.terms.map(t => String(t).slice(0, 120)).filter(Boolean).slice(0, 5) : [];
    const maxItems = Math.min(Math.max(parseInt(body.maxItems, 10) || 2000, 1), 3000);
    if (!ticker || !terms.length) return send(res, 400, { error: 'invalid_request', detail: 'ticker and non-empty terms[] are required.' });
    const PER_ITEM_USD = 0.0004; // apidojo/tweet-scraper: "$0.40 per 1000 tweets" (actor description, verified 2026-10-25) and corroborated by a measured $0.008/20-item run
    const estUsd = maxItems * PER_ITEM_USD;
    store.apifySpend = store.apifySpend || { confirmedUsd: 0.008, estimatedUsd: 0, runs: [] };
    if (store.apifySpend.confirmedUsd + store.apifySpend.estimatedUsd + estUsd > 5.0) {
      return send(res, 429, { error: 'spend_guard', detail: 'Refusing run: projected Apify spend would exceed its $5 share of the $10 total build budget.', projectedUsd: +(store.apifySpend.confirmedUsd + store.apifySpend.estimatedUsd + estUsd).toFixed(3) });
    }
    let token = (process.env.APIFY_API_TOKEN || '').trim();
    if (!token) {
      const r = await extractBrokeredSecret('APIFY_API_TOKEN').catch(() => ({ ok: false }));
      if (r.ok) token = r.value;
    }
    if (!token) return send(res, 200, { ok: false, error: 'not_configured', detail: 'No Apify token in env or brokered runtime config.' });
    const actorId = process.env.APIFY_PACK_ACTOR || 'apidojo~tweet-scraper';
    const input = { searchTerms: terms, maxItems, sort: 'Latest', tweetLanguage: 'en', start: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) };
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 300_000);
    let rows;
    try {
      const r = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: ac.signal
      });
      clearTimeout(t);
      if (!r.ok) return send(res, 502, { ok: false, error: 'apify_http_' + r.status });
      rows = await r.json();
    } catch (e) { clearTimeout(t); return send(res, 502, { ok: false, error: 'apify_fetch_failed', detail: String(e && e.message || e) }); }
    const items = (Array.isArray(rows) ? rows : []).map(x => ({
      text: String(x.text || x.full_text || x.title || '').slice(0, 500),
      date: x.createdAt || x.created_at || '',
      link: x.url || x.twitterUrl || '',
      author: (x.author && (x.author.userName || x.author.username)) || x.author || '',
      likes: x.likeCount ?? x.favoriteCount ?? null,
      retweets: x.retweetCount ?? null,
      replies: x.replyCount ?? null
    })).filter(x => x.text);
    store.packs = store.packs || {};
    const prev = store.packs[ticker];
    const seen = new Set((prev ? prev.items : []).map(i => (i.link || '') + '|' + i.text.slice(0, 80)));
    const fresh = items.filter(i => !seen.has((i.link || '') + '|' + i.text.slice(0, 80))).map(i => ({ ...i, src: 'apify-x' }));
    const merged = (prev ? prev.items : []).concat(fresh);
    store.packs[ticker] = { company, ticker, terms, collectedAt: new Date().toISOString(), itemCount: merged.length, estUsd: +((prev ? prev.estUsd : 0) + items.length * PER_ITEM_USD).toFixed(4), sources: (prev ? prev.sources : []).concat([{ source: 'apify-x', at: new Date().toISOString(), collected: items.length, added: fresh.length }]), items: merged };
    store.apifySpend.estimatedUsd = +(store.apifySpend.estimatedUsd + items.length * PER_ITEM_USD).toFixed(4);
    store.apifySpend.runs.push({ ticker, at: store.packs[ticker].collectedAt, items: items.length });
    await saveStore();
    return send(res, 200, { ok: true, ticker, collected: items.length, added: fresh.length, packTotal: merged.length, sample: items.slice(0, 3).map(i => i.text.slice(0, 120)) });
  }
  // Admin-only: recent Apify run outcomes (status/items/charge) so a missing
  // pack is diagnosed from the actor side before any re-launch - never a
  // blind duplicate. Sanitized; no token, no account metadata.
  if (p === '/api/packs/apify-status' && req.method === 'GET') {
    if (!process.env.PACK_ADMIN_TOKEN || req.headers['x-admin-token'] !== process.env.PACK_ADMIN_TOKEN) {
      return send(res, 403, { error: 'forbidden' });
    }
    let token = (process.env.APIFY_API_TOKEN || '').trim();
    if (!token) {
      const r = await extractBrokeredSecret('APIFY_API_TOKEN').catch(() => ({ ok: false }));
      if (r.ok) token = r.value;
    }
    if (!token) return send(res, 200, { ok: false, error: 'not_configured' });
    const actorId = process.env.APIFY_PACK_ACTOR || 'apidojo~tweet-scraper';
    const r = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?limit=10&desc=1`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return send(res, 502, { ok: false, error: 'apify_http_' + r.status });
    const j = await r.json();
    const runs = ((j.data && j.data.items) || []).map(x => ({
      id: x.id, status: x.status, startedAt: x.startedAt, finishedAt: x.finishedAt || null,
      items: (x.stats && x.stats.outputBodySize != null) ? undefined : undefined,
      datasetItems: x.stats && x.stats.datasetItemCount != null ? x.stats.datasetItemCount : undefined,
      chargedUsd: x.usageTotalUsd != null ? x.usageTotalUsd : (x.pricingInfo && x.pricingInfo.totalChargeUsd) || null
    }));
    return send(res, 200, { ok: true, runs });
  }

  if (p.startsWith('/api/packs/') && req.method === 'GET') {
    const ticker = p.slice('/api/packs/'.length).toUpperCase();
    const pack = store.packs && store.packs[ticker];
    if (!pack) return send(res, 404, { error: 'no_pack', detail: 'No data pack collected for ' + ticker + ' yet.' });
    const { estUsd, ...pub } = pack;
    return send(res, 200, pub);
  }
  // Ingest an authorized historical export (e.g. Signalor public-mention
  // extract handed off by the ops owner). Same admin gate; no spend involved.
  if (p === '/api/packs/ingest' && req.method === 'POST') {
    if (!process.env.PACK_ADMIN_TOKEN || req.headers['x-admin-token'] !== process.env.PACK_ADMIN_TOKEN) {
      return send(res, 403, { error: 'forbidden', detail: 'Pack ingest requires the admin token (PACK_ADMIN_TOKEN).' });
    }
    let body;
    try { body = await readBody(req).then(b => JSON.parse(b)); } catch { return send(res, 400, { error: 'bad_json' }); }
    const ticker = String(body.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
    const company = String(body.name || '').slice(0, 120);
    const src = String(body.source || 'export').slice(0, 60);
    const rows = Array.isArray(body.items) ? body.items.slice(0, 20000) : [];
    if (!ticker || !rows.length) return send(res, 400, { error: 'invalid_request', detail: 'ticker and non-empty items[] are required.' });
    const items = rows.map(x => ({
      text: String(x.text || '').slice(0, 500),
      date: String(x.date || ''),
      link: String(x.link || ''),
      author: '',
      likes: null, retweets: null, replies: null,
      engagement: x.engagement ?? null,
      platform: String(x.platform || ''),
      sentiment: x.sentiment ? String(x.sentiment) : null,
      sentimentConfidence: x.sentimentConfidence != null ? Number(x.sentimentConfidence) : null,
      hasText: Boolean(String(x.text || '').trim()),
      src
    }));
    store.packs = store.packs || {};
    const prev = store.packs[ticker];
    const seen = new Set((prev ? prev.items : []).map(i => (i.link || '') + '|' + i.text.slice(0, 80)));
    const fresh = items.filter(i => !seen.has((i.link || '') + '|' + i.text.slice(0, 80)));
    const merged = (prev ? prev.items : []).concat(fresh);
    const at = new Date().toISOString();
    store.packs[ticker] = { company: company || (prev && prev.company) || ticker, ticker, terms: prev ? prev.terms : [], collectedAt: at, itemCount: merged.length, estUsd: prev ? prev.estUsd : 0, sources: (prev ? prev.sources : []).concat([{ source: src, at, collected: items.length, added: fresh.length }]), items: merged };
    await saveStore();
    return send(res, 200, { ok: true, ticker, source: src, received: items.length, added: fresh.length, packTotal: merged.length, withText: merged.filter(i => i.hasText !== false && i.text).length });
  }

  if (p === '/api/packs' && req.method === 'GET') {
    // Public: counts and provenance only. Spend/cost fields stay server-side
    // (private budget ledger in the run store), never on public routes.
    const packs = Object.values(store.packs || {}).map(({ items, estUsd, ...meta }) => meta);
    return send(res, 200, { packs });
  }
  if (p === '/api/vet/identify') {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 120);
    if (!name) return send(res, 400, { error: 'missing_name', detail: 'Pass ?name=<company>.' });
    try { return send(res, 200, await buildVetIdentify(name)); }
    catch (e) { return send(res, 500, { error: 'vet_identify_failed', detail: String(e.message || e) }); }
  }
  if (p === '/api/vet/report') {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 120);
    const question = (url.searchParams.get('question') || '').trim().slice(0, 400);
    const category = (url.searchParams.get('category') || 'general').trim().slice(0, 24);
    const identityName = (url.searchParams.get('identityName') || '').trim().slice(0, 200);
    const identityKind = (url.searchParams.get('identityKind') || 'custom').trim().slice(0, 32);
    if (!name) return send(res, 400, { error: 'missing_name', detail: 'Pass ?name=<company>.' });
    if (!identityName) return send(res, 400, { error: 'identity_selection_required', detail: 'Select an identity candidate from /api/vet/identify first (identityKind + identityName).' });
    try { return send(res, 200, await buildVetReport(name, question, category, { kind: identityKind, name: identityName })); }
    catch (e) { return send(res, e.status || 500, { error: 'vet_report_failed', detail: String(e.message || e) }); }
  }
  if (p === '/api/vet/supplier') {
    const name = (url.searchParams.get('name') || '').trim();
    if (!name) return send(res, 400, { error: 'missing_name', detail: 'Pass ?name=<supplier> to build a vetting evidence pack.' });
    return send(res, 200, await buildSupplierPack(name));
  }
  if (p === '/api/health') return send(res, 200, healthProjection({ gateStatus, crs: crsSandboxStatus(), runtimeConfig: runtimeConfigStatus(), seeded: true }));

  const claims = () => {
    const q = (url.searchParams.get('q') || '').slice(0, 120).toLowerCase();
    const s = url.searchParams.get('status') || 'all';
    if (!STATUSES.has(s)) return null;
    return seed.claims.filter(c => (s === 'all' || c.status === s) && `${c.claim} ${c.source} ${c.attribution}`.toLowerCase().includes(q));
  };

  if (p === `/api/companies/${COMPANY}/overview`) {
    const byStatus = {};
    for (const c of seed.claims) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    const classes = new Set(seed.claims.map(c => c.source)).size;
    return send(res, 200, {
      company: seed.company, latestSnapshot: seed.snapshots.at(-1),
      metrics: { claimsIndexed: seed.claims.length, sourceClasses: classes, contradicted: byStatus.contradicted || 0, byStatus, sourcesChecked: seed.sources.filter(s => s.state === 'checked').length, sourcesTotal: seed.sources.length, sentiment: { state: 'not_connected' } },
      banner: { changes: seed.changes.length, text: `${seed.changes.length} changes since the previous snapshot: 1 new claim from Apple Newsroom, 1 source status updated.` },
      illustrative: true
    });
  }
  if (p === `/api/companies/${COMPANY}/claims`) {
    const rows = claims();
    if (!rows) return send(res, 400, { error: 'bad_filter', detail: 'status must be one of all|supported|unresolved|contradicted' });
    return send(res, 200, { total: seed.claims.length, count: rows.length, claims: rows, illustrative: true });
  }
  const claimMatch = p.match(/^\/api\/claims\/(CL-\d{4})$/);
  if (claimMatch) {
    const c = seed.claims.find(x => x.id === claimMatch[1]);
    return c ? send(res, 200, { ...c, illustrative: true }) : send(res, 404, { error: 'not_found', detail: `No claim ${claimMatch[1]} in this demo snapshot.` });
  }
  if (p === `/api/companies/${COMPANY}/coverage`) return send(res, 200, { checked: seed.sources.filter(s => s.state === 'checked').length, total: seed.sources.length, sources: seed.sources, illustrative: true });
  if (p === `/api/companies/${COMPANY}/sentiment`) return send(res, 200, { state: 'not_connected', detail: 'No sentiment registry is connected for this demo, so no aggregate is served. A production view serves extract-backed aggregates with sample size, window, platforms and method (spec §7).', illustrative: true });
  if (p === `/api/companies/${COMPANY}/changes`) return send(res, 200, { snapshots: seed.snapshots, changes: seed.changes, illustrative: true });

  // Live collection (public Apple material only). Real fetches, marked live;
  // failures reported honestly. Host allowlist + caps per spec §4.
  const collectMatch = p.match(/^\/api\/companies\/apple\/collect\/([a-z0-9_]+)$/);
  if (collectMatch && ALLOWED[collectMatch[1]]) return send(res, 200, await collect(collectMatch[1]));
  if (p === '/api/companies/apple/report') return send(res, 200, await runReport());
  if (p === '/api/companies/apple/export') {
    const report = await runReport();
    const v = validateClaims(report);
    const L = [];
    L.push('# Apple Inc. (AAPL) - evidence export');
    L.push(`Generated ${report.generatedAt} by a live collection run across ${report.liveCount} live sources.`);
    L.push('');
    L.push('## Claim checks');
    const card = (c, kind) => {
      L.push(`### ${c.claim}`);
      L.push(`- Kind: ${kind}; Basis: ${c.basis}${c.date && !c.basis.includes(c.date) ? '; Date: ' + c.date : ''}`);
      if (c.link) L.push(`- Claim source: ${c.link}`);
      L.push(`- Status: ${c.status}`);
      if (c.passages && c.passages.length) for (const p of c.passages) {
        L.push(`- ${p.source}, ${p.date}: "${p.title}" ${p.link}`.trim());
        if (p.excerpt) L.push(`  Passage: "...${p.excerpt}..."`);
        if (p.wording) L.push(`  Wording: ${p.wording} (wording-only observation)`);
        if (p.tension) L.push(`  Tension: negation/failure wording near the matched span - related evidence for review, not counted as coverage`);
      } else L.push('- No matching items collected in this run.');
      L.push('');
    };
    for (const c of v.figureChecks) card(c, 'Filed figure (SEC XBRL)');
    for (const c of v.headlineChecks) card(c, 'Company statement');
    for (const c of (v.contradictions || [])) card(c, 'Figure mismatch candidate');
    L.push('## Related-evidence coverage (wording level)');
    L.push(`${v.coverageScore.score}/100 - ${v.coverageScore.drivers}`);
    L.push(v.coverageScore.scope);
    L.push('');
    L.push('## Method');
    L.push(v.method);
    L.push('');
    L.push('## Sources this run');
    for (const s of report.sources) L.push(`- ${s.name}: ${s.itemCount} collected${s.relevantCount != null ? `, ${s.relevantCount} Apple-relevant` : ''} (${s.mode})`);
    L.push('');
    L.push('Signalor mention analytics: historical aggregate through 2026-10-20, not live; see dashboard panel for sentiment/platform/aspect breakdown.');
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="apple-evidence-export.md"' });
    return res.end(L.join('\n'));
  }
  if (p === '/api/companies/apple/analysis') {
    const report = await runReport();
    const v = validateClaims(report);
    return send(res, 200, { ...report, analysis: matchClaims(report), validation: v, diligence: buildDiligence(report, v), history: store.runs, storeMode: process.env.DATA_DIR ? 'attached-volume' : 'ephemeral', historyNote: process.env.DATA_DIR ? 'Runs persist to an attached Railway volume and survive redeploys.' : 'Runs persist to disk within this deployment only; a redeploy resets the store.' });
  }
  if (p === '/api/companies/apple/memo') {
    const report = await runReport();
    const v = validateClaims(report);
    const md = buildMemo(report, v, buildDiligence(report, v));
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="apple-diligence-memo.md"' });
    return res.end(md);
  }
  const traceMatch = p.match(/^\/api\/companies\/apple\/collect\/([a-z0-9_]+)\/trace$/);
  if (traceMatch && ALLOWED[traceMatch[1]]) {
    const d = await collect(traceMatch[1]);
    const escH = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const itemRows = d.items.map(i => `<tr><td>${escH(i.date || '')}</td><td>${escH(i.form ? `Form ${i.form} · ${i.description || 'filing'}` : (i.title || ''))}</td><td>${escH(i.outlet || (i.rating ? i.rating + '/5' : (i.points != null ? i.points + ' pts' : '')))}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escH(d.name)} - collector execution</title><style>
body{margin:0;background:#f5f4f4;color:#0f1115;font:13px/1.5 ui-monospace,Menlo,monospace;padding:14px 16px}
.h{font-size:10px;letter-spacing:.14em;color:#02205e;text-transform:uppercase;margin:10px 0 4px}
.line{background:#fff;border:1px solid #d8d9dc;padding:8px 10px;word-break:break-all}
pre{background:#fff;border:1px solid #d8d9dc;padding:8px 10px;margin:0;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:hidden;font-size:10.5px;color:#3b3f47}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8d9dc}td{border-top:1px solid #ececef;padding:4px 8px;font-size:10.5px;vertical-align:top}
td:first-child{white-space:nowrap;color:#6b7280;width:78px}td:last-child{color:#6b7280;width:70px}
.badge{color:#1a7f37;border:1px solid #b7e4c7;background:#e9f7ef;padding:0 6px;font-size:10px;letter-spacing:.1em}
.bad{color:#b42318;border:1px solid #f3c2bd;background:#fdf0ef;padding:0 6px;font-size:10px;letter-spacing:.1em}
</style></head><body>
<div class="h">${escH(d.name)} - collector execution ${d.mode==='live'?'<span class="badge">LIVE</span>':'<span class="bad">FAILED</span>'}</div>
<div class="h">1 · Request</div><div class="line">GET ${escH(d.trace ? d.trace.url : d.source)}</div>
<div class="h">2 · Source response</div><div class="line">${d.trace ? `HTTP ${d.trace.status} · ${d.trace.bytes.toLocaleString('en-US')} bytes · ${d.trace.durationMs} ms · fetched ${escH(d.fetchedAt)} · run ${escH(d.runId)}${d.cached?' · served from 10-min run cache':''}` : escH(d.detail || 'fetch failed')}</div>
${d.trace?`<div class="h">3 · Raw response (excerpt)</div><pre>${escH(d.trace.excerpt)}</pre>`:''}
<div class="h">4 · Extracted evidence (${d.items.length} items)</div>
<table>${itemRows || '<tr><td>No items extracted.</td></tr>'}</table>
</body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (p === `/api/companies/${COMPANY}/refresh` || p.startsWith('/api/admin/ingest/')) {
    return send(res, 503, { error: 'admin_gate_not_provisioned', detail: 'Mutations are gated behind a one-time-code admin session (spec §2). No OTP provider or broker is provisioned for this demo, so this route is intentionally unavailable - no fake gate.' });
  }
  return send(res, 404, { error: 'not_found', detail: `${p} is not part of the demo API surface (spec §8).` });
}


// --- Live collectors (public sources only; allowlisted hosts, size/timeout caps) ---
const SOURCES = [
  { key: 'edgar', name: 'SEC EDGAR filings', url: 'https://data.sec.gov/submissions/CIK0000320193.json', label: 'SEC EDGAR submissions API' },
  { key: 'riskfactors', name: 'SEC 10-K risk factors', url: 'https://data.sec.gov/submissions/CIK0000320193.json', label: 'SEC EDGAR submissions API + latest 10-K Item 1A' },
  { key: 'newsroom', name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss', label: 'Apple Newsroom feed' },
  { key: 'news', name: 'Google News', url: 'https://news.google.com/rss/search?q=Apple%20Inc&hl=en-US&gl=US&ceid=US:en', label: 'Google News RSS (query: Apple Inc)' },
  { key: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/Apple_Inc.', label: 'Wikipedia REST summary API' },
  { key: 'hackernews', name: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search?query=Apple&tags=story&hitsPerPage=5', label: 'Hacker News Algolia API' },
  { key: 'hncomments', name: 'Hacker News comments', url: 'https://hn.algolia.com/api/v1/search_by_date?query=Apple&tags=comment&hitsPerPage=6', label: 'Hacker News Algolia API (public comments)' },
  { key: 'macrumors', name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All', label: 'MacRumors RSS' },
  { key: 'ninetofive', name: '9to5Mac', url: 'https://9to5mac.com/feed/', label: '9to5Mac RSS' },
  { key: 'pageviews', name: 'Wikipedia pageviews', url: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Apple_Inc./daily/PVDATES', label: 'Wikimedia pageviews API (Apple Inc. article)' },
  { key: 'itunes', name: 'Apple on the App Store', url: 'https://itunes.apple.com/search?term=Apple&entity=software&limit=50', label: 'iTunes Search API' },
  { key: 'reviews', name: 'App Store reviews', url: 'https://itunes.apple.com/us/rss/customerreviews/id=408709785/sortBy=mostRecent/json', label: 'App Store customer reviews RSS (GarageBand, an Apple app)' },
  { key: 'xbrl', name: 'SEC XBRL facts', url: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json', label: 'SEC EDGAR XBRL company concept API' },
  { key: 'xbrl_ni', name: 'SEC XBRL net income', url: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json', label: 'SEC EDGAR XBRL company concept API' },
  { key: 'xbrl_rd', name: 'SEC XBRL R&D expense', url: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/ResearchAndDevelopmentExpense.json', label: 'SEC EDGAR XBRL company concept API' },
  { key: 'xbrl_eps', name: 'SEC XBRL diluted EPS', url: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/EarningsPerShareDiluted.json', label: 'SEC EDGAR XBRL company concept API' },
  { key: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', label: 'The Verge RSS' },
  { key: 'mastodon', name: 'Mastodon #apple', url: 'https://mastodon.social/api/v1/timelines/tag/apple?limit=40', label: 'Mastodon public tag timeline API' },
  { key: 'lemmy', name: 'Lemmy', url: 'https://lemmy.world/api/v3/search?q=apple&type_=Posts&limit=50&sort=New', label: 'Lemmy public search API' },
  { key: 'reddit', name: 'Reddit r/apple', url: 'https://oauth.reddit.com/r/apple/new?limit=50&raw_json=1', label: 'Reddit OAuth API (script app, read-only)' },
  { key: 'apify', name: 'Apify actors', url: 'https://api.apify.com/v2', label: 'Apify API (actors for X/Twitter, YouTube, Trustpilot, forums; token via env or brokered runtime config)' }
];
const ALLOWED = Object.fromEntries(SOURCES.map(s => [s.key, s.url]));
// Paginated collectors: several pages per source, fetched sequentially with
// per-page caps. Bounded samples, deduplicated within the source by link.
const MULTI = {
  hackernews: Array.from({ length: 10 }, (_, i) => `https://hn.algolia.com/api/v1/search?query=Apple&tags=story&hitsPerPage=100&page=${i}`),
  hncomments: Array.from({ length: 5 }, (_, i) => `https://hn.algolia.com/api/v1/search_by_date?query=Apple&tags=comment&hitsPerPage=100&page=${i}`),
  reviews: Array.from({ length: 10 }, (_, i) => `https://itunes.apple.com/us/rss/customerreviews/page=${i + 1}/id=408709785/sortBy=mostRecent/json`)
};
function resolveUrl(key, url) {
  if (key !== 'pageviews') return url;
  const end = new Date(); const start = new Date(end.getTime() - 364 * 864e5);
  const f = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  return url.replace('PVDATES', `${f(start)}00/${f(end)}00`);
}
const UA = { 'user-agent': 'company-evidence-index-demo (Cal Hacks 13.0; public-data collection)', accept: '*/*' };
const collectCache = new Map();
async function cappedFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const started = Date.now();
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 2_000_000) throw new Error('response too large');
    const body = Buffer.from(buf).toString('utf8');
    return { body, trace: { method: 'GET', url, status: r.status, bytes: buf.byteLength, durationMs: Date.now() - started, excerpt: body.slice(0, 1600) } };
  } finally { clearTimeout(t); }
}
async function fetchArticleText(url) {
  try {
    const { body } = await cappedFetch(url);
    return decodeEntities(body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 4000);
  } catch { return ''; }
}
const items = xml => [...xml.matchAll(/<item[ >][\s\S]*?<\/item>/g)].map(m => m[0]);
const decodeEntities = t => t.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&nbsp;/g, ' ');
const field = (item, name) => { const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim() : ''; };
const linkOf = it => { const m = it.match(/<link[^>]*href="([^"]+)"/) || it.match(/<link[^>]*>([^<]+)</); return m ? m[1].trim() : ''; };
// Latest 10-K Item 1A: category headers are bold spans, risk statements are
// bold-italic spans in the filed HTML. Extractive only - the filed wording is
// quoted, never paraphrased.
function parseRiskFactors(html) {
  const aHits = [...html.matchAll(/Item\s*1A/g)].map(m => m.index);
  const bHits = [...html.matchAll(/Item\s*1B/g)].map(m => m.index);
  if (!aHits.length || !bHits.length) throw new Error('Item 1A/1B markers not found in 10-K');
  const end = Math.max(...bHits);
  const start = Math.max(...aHits.filter(x => x < end));
  const sec = html.slice(start, end);
  const re = /<span[^>]*style="([^"]*font-weight:700[^"]*)"[^>]*>([\s\S]*?)<\/span>/g;
  const out = [];
  let cat = 'Uncategorized';
  let m;
  while ((m = re.exec(sec))) {
    const t = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (m[1].includes('italic')) {
      if (t.length >= 60 && t.length <= 500 && !out.some(x => x.title === t)) out.push({ title: t, category: cat });
    } else if (t.length >= 8 && t.length <= 90 && /risks?$/i.test(t)) cat = t;
  }
  if (!out.length) throw new Error('no bold-italic risk statements extracted from Item 1A');
  return out.slice(0, 30);
}
function parse(kind, raw) {
  if (kind === 'edgar') {
    const r = JSON.parse(raw).filings.recent;
    return r.form.slice(0, 1500).map((f, i) => ({ form: f, date: r.filingDate[i], accession: r.accessionNumber[i], description: (r.primaryDocDescription[i] || '').toUpperCase() === f.toUpperCase() ? '' : (r.primaryDocDescription[i] || ''), link: `https://www.sec.gov/Archives/edgar/data/320193/${String(r.accessionNumber[i]).replace(/-/g, '')}/${r.primaryDocument[i] || ''}` }));
  }
  if (kind === 'newsroom') {
    const entries = [...raw.matchAll(/<entry[ >][\s\S]*?<\/entry>/g)].map(m => m[0]);
    return entries.slice(0, 20).map(it => ({ title: field(it, 'title'), date: field(it, 'updated'), link: linkOf(it) }));
  }
  if (kind === 'news') return items(raw).slice(0, 30).map(it => ({ title: field(it, 'title'), date: field(it, 'pubDate'), outlet: field(it, 'source'), link: field(it, 'link') }));
  if (kind === 'wikipedia') {
    const j = JSON.parse(raw);
    return [{ title: j.title, date: j.timestamp, excerpt: (j.extract || '').slice(0, 220), link: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : '' }];
  }
  if (kind === 'hackernews') {
    const j = JSON.parse(raw);
    return (j.hits || []).map(h => ({ title: h.title, date: (h.created_at || '').slice(0, 10), points: h.points, link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` }));
  }
  if (kind === 'hncomments') {
    const j = JSON.parse(raw);
    return (j.hits || []).map(h => {
      const clean = decodeEntities((h.comment_text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      const hl = (h._highlightResult && h._highlightResult.comment_text && h._highlightResult.comment_text.value) || '';
      const em = (hl.match(/<em>(.*?)<\/em>/i) || [])[1];
      let matched = '';
      if (em) { const pos = clean.toLowerCase().indexOf(decodeEntities(em.replace(/<[^>]+>/g, '')).toLowerCase()); if (pos >= 0) matched = clean.slice(Math.max(0, pos - 60), pos + em.length + 80).trim(); }
      return { title: clean.replace(/^(>\s*)+/, '').slice(0, 200), context: clean.slice(0, 600), matched, date: (h.created_at || '').slice(0, 10), outlet: `comment by ${h.author}`, link: `https://news.ycombinator.com/item?id=${h.objectID}` };
    });
  }
  if (kind === 'pageviews') {
    const j = JSON.parse(raw);
    return (j.items || []).slice().reverse().map(v => ({ title: `${Number(v.views).toLocaleString('en-US')} views of Apple Inc.`, date: `${v.timestamp.slice(0,4)}-${v.timestamp.slice(4,6)}-${v.timestamp.slice(6,8)}`, link: 'https://en.wikipedia.org/wiki/Apple_Inc.' }));
  }
  if (kind.startsWith('xbrl')) {
    const j = JSON.parse(raw);
    const isShares = kind === 'xbrl_eps';
    const metric = kind === 'xbrl_ni' ? 'net income' : kind === 'xbrl_rd' ? 'R&D expense' : isShares ? 'diluted EPS' : 'revenue';
    const tag = j.tag || (kind === 'xbrl_ni' ? 'NetIncomeLoss' : kind === 'xbrl_rd' ? 'ResearchAndDevelopmentExpense' : isShares ? 'EarningsPerShareDiluted' : 'RevenueFromContractWithCustomerExcludingAssessedTax');
    const fmt = v => isShares ? '$' + Number(v).toFixed(2) : '$' + (v / 1e9).toFixed(1) + 'B';
    const unit = isShares ? 'USD/shares' : 'USD';
    // Annual audit: FY flag + 10-K form + ~1-year period, deduped by period end
    // preferring the latest-filed accession (amendments win over originals).
    const rows = ((j.units && (j.units[unit] || j.units.USD)) || []).filter(u => u.fp === 'FY' && u.form === '10-K' && u.start && u.end)
      .filter(u => { const days = (Date.parse(u.end) - Date.parse(u.start)) / 864e5; return days > 300 && days < 400; });
    const byEnd = new Map();
    for (const u of rows) { const prev = byEnd.get(u.end); if (!prev || String(u.filed) > String(prev.filed)) byEnd.set(u.end, u); }
    return [...byEnd.values()].sort((a, b) => String(b.end).localeCompare(String(a.end))).slice(0, 5)
      .map(u => ({ title: `FY${String(u.end).slice(0, 4)} ${metric} ${fmt(u.val)}`, date: u.end, concept: tag, unit, rawVal: u.val, accession: u.accn, filed: u.filed, link: `https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/${tag}.json` }));
  }
  if (kind === 'itunes') {
    const j = JSON.parse(raw);
    return (j.results || []).slice(0, 50).map(a => ({ title: a.trackName, date: (a.currentVersionReleaseDate || '').slice(0, 10), link: a.trackViewUrl, outlet: a.sellerName }));
  }
  if (kind === 'reviews') {
    const j = JSON.parse(raw);
    const entries = ((j.feed && j.feed.entry) || []).filter(e => e['im:rating']);
    return entries.map(e => ({ title: e.title && e.title.label, date: e.updated && e.updated.label && e.updated.label.slice(0, 10), rating: e['im:rating'] && e['im:rating'].label, link: e.link && e.link.attributes ? e.link.attributes.href : '' }));
  }
  if (kind === 'mastodon') {
    const j = JSON.parse(raw);
    return (Array.isArray(j) ? j : []).map(p => { const clean = decodeEntities((p.content || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); return { title: clean.slice(0, 200), context: clean.slice(0, 500), date: (p.created_at || '').slice(0, 10), outlet: `@${(p.account && p.account.acct) || 'unknown'}`, link: p.url || '' }; });
  }
  if (kind === 'lemmy') {
    const j = JSON.parse(raw);
    return (j.posts || []).map(p => ({ title: (p.post.name || '').slice(0, 200), context: (p.post.body || '').slice(0, 500), date: (p.post.published || '').slice(0, 10), outlet: `${p.community ? '!' + p.community.name + ' by ' : ''}${(p.creator && p.creator.name) || 'unknown'}`, link: p.post.ap_id || '' }));
  }
  if (kind === 'stooq') {
    const lines = raw.trim().split('\n').filter(l => /^\d{4}-/.test(l));
    return lines.slice(-5).reverse().map(l => { const [date, open, high, low, close, volume] = l.split(','); return { title: `Close ${close} (vol ${Number(volume).toLocaleString('en-US')})`, date, close, volume }; });
  }
  // macrumors, ninetofive: RSS item feeds; verge: Atom feed
  const its = items(raw);
  if (its.length) return its.slice(0, 30).map(it => ({ title: field(it, 'title'), date: field(it, 'pubDate'), link: linkOf(it), context: field(it, 'description').slice(0, 500) }));
  const entries = [...raw.matchAll(/<entry[ >][\s\S]*?<\/entry>/g)].map(m => m[0]);
  return entries.slice(0, 30).map(it => ({ title: field(it, 'title'), date: field(it, 'published') || field(it, 'updated'), link: linkOf(it), context: (field(it, 'summary') || field(it, 'content')).slice(0, 500) }));
}
// Reddit: official script-app OAuth only (client_credentials, read-only).
// Credentials arrive as Railway env via vault fill, never in code or chat.
// No unauthenticated endpoint probing: without env, report unavailable.
let redditToken = { token: null, exp: 0 };
async function collectReddit() {
  const meta = SOURCES.find(x => x.key === 'reddit');
  const fetchedAt = new Date().toISOString();
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  const ua = process.env.REDDIT_USER_AGENT || 'company-evidence-index-demo/1.0 by u/unknown (Cal Hacks 13.0; read-only public-data collection)';
  if (!id || !secret) return { mode: 'unavailable', source: meta.label, name: meta.name, fetchedAt, detail: 'Reddit OAuth credentials not configured (REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET env vars absent); unauthenticated Reddit endpoints refuse datacenter requests (403), so no fallback is attempted.', items: [] };
  const t0 = Date.now();
  if (!redditToken.token || Date.now() > redditToken.exp) {
    const tr = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ua }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(8000) });
    if (!tr.ok) throw new Error('token endpoint HTTP ' + tr.status);
    const tj = await tr.json();
    redditToken = { token: tj.access_token, exp: Date.now() + Math.max(60, (tj.expires_in || 3600) - 120) * 1000 };
  }
  const res = await fetch(meta.url, { headers: { authorization: 'Bearer ' + redditToken.token, 'user-agent': ua }, signal: AbortSignal.timeout(8000) });
  const raw = await res.text();
  const trace = { method: 'GET', url: meta.url + ' (OAuth client_credentials via www.reddit.com/api/v1/access_token)', status: res.status, bytes: raw.length, durationMs: Date.now() - t0, excerpt: raw.slice(0, 1600) };
  if (!res.ok) throw new Error('listing HTTP ' + res.status + ': ' + raw.slice(0, 120));
  const j = JSON.parse(raw);
  const items = ((j.data && j.data.children) || []).map(c => c.data || {}).map(d => ({ title: d.title || '', context: String(d.selftext || '').replace(/\s+/g, ' ').slice(0, 500), date: d.created_utc ? new Date(d.created_utc * 1000).toISOString().slice(0, 10) : '', outlet: `r/${d.subreddit || 'apple'} · u/${d.author || 'unknown'} · ${d.score != null ? d.score + ' pts' : ''}`, link: d.permalink ? 'https://www.reddit.com' + d.permalink : (d.url || '') }));
  return { mode: 'live', source: meta.label, name: meta.name, fetchedAt, runId: fetchedAt, items, trace };
}

async function collectApify() {
  const fetchedAt = new Date().toISOString();
  const base = { source: 'Apify actors', name: 'Apify (X/Twitter, YouTube, Trustpilot, forums)', fetchedAt, items: [] };
  let token = (process.env.APIFY_API_TOKEN || '').trim();
  if (!token) {
    // Brokered runtime config (extract-only; the rest of the envelope is discarded).
    const r = await extractBrokeredSecret('APIFY_API_TOKEN').catch(() => ({ ok: false }));
    if (r.ok) token = r.value;
  }
  if (!token) return { ...base, mode: 'unavailable', detail: 'not_configured: no Apify token in env (APIFY_API_TOKEN) or brokered runtime config. No run was attempted.' };
  if (process.env.APIFY_ENABLED !== 'true') return { ...base, mode: 'unavailable', detail: 'Apify token present but APIFY_ENABLED is not true. Actor runs stay off until the user approves paid scrape runs.' };
  // Free documented validity check (GET /v2/users/me, no actor cost). Account info is never surfaced.
  try {
    const me = await fetch('https://api.apify.com/v2/users/me', { headers: { authorization: `Bearer ${token}` } });
    if (me.status === 401) return { ...base, mode: 'unavailable', detail: 'invalid_token: the configured Apify token was rejected (401). Local state only; nothing was reported upstream.' };
    if (!me.ok) return { ...base, mode: 'unavailable', detail: `apify_check_failed: users/me returned HTTP ${me.status}.` };
  } catch (e) {
    return { ...base, mode: 'unavailable', detail: `apify_check_failed: ${String(e.message || e)}` };
  }
  const actors = (process.env.APIFY_ACTORS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!actors.length) return { ...base, mode: 'unavailable', detail: 'Token valid, but no actor set configured (APIFY_ACTORS). Specific actors remain proposed, not selected/verified - see the workflow map step 2b.' };
  const items = []; const failures = [];
  for (const actorId of actors) {
    try {
      const r = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: process.env.APIFY_ACTOR_INPUT || '{}' });
      if (!r.ok) { failures.push(`${actorId}: HTTP ${r.status}`); continue; }
      const rows = await r.json();
      for (const row of Array.isArray(rows) ? rows.slice(0, 50) : []) {
        items.push({ title: String(row.title || row.text || row.url || 'item').slice(0, 300), date: row.createdAt || row.date || fetchedAt, link: row.url || row.link || '' });
      }
    } catch (e) { failures.push(`${actorId}: ${String(e.message || e)}`); }
  }
  if (!items.length) return { ...base, mode: 'unavailable', detail: `actor run(s) produced no items${failures.length ? '; failures: ' + failures.join('; ') : ''}` };
  const data = { ...base, mode: 'live', runId: fetchedAt, items, trace: { method: 'POST', url: `${actors.length} actor run(s) via Apify API${failures.length ? ' (' + failures.length + ' failed)' : ''}`, status: 200 } };
  return data;
}

async function collect(kind) {
  const hit = collectCache.get(kind);
  if (hit && Date.now() - hit.at < 600_000) return { ...hit.data, cached: true };
  const meta = SOURCES.find(s => s.key === kind);
  const fetchedAt = new Date().toISOString();
  try {
    if (kind === 'riskfactors') {
      try {
        const { body: subsRaw } = await cappedFetch(meta.url);
        const r = JSON.parse(subsRaw).filings.recent;
        const i = r.form.indexOf('10-K');
        if (i < 0) throw new Error('no 10-K in recent filings');
        const doc = 'https://www.sec.gov/Archives/edgar/data/320193/' + r.accessionNumber[i].replace(/-/g, '') + '/' + r.primaryDocument[i];
        const { body: tenk, trace } = await cappedFetch(doc);
        const items = parseRiskFactors(tenk).map(x => ({ ...x, date: r.filingDate[i], link: doc, form: '10-K', accession: r.accessionNumber[i] }));
        const data = { mode: 'live', source: meta.label, name: meta.name, fetchedAt, runId: fetchedAt, items, trace: { ...trace, url: 'submissions API, then ' + doc } };
        collectCache.set(kind, { at: Date.now(), data });
        return data;
      } catch (e) {
        return { mode: 'unavailable', source: meta.label, name: meta.name, fetchedAt, detail: String(e.message || e), items: [] };
      }
    }
    if (kind === 'apify') {
      const data = await collectApify();
      if (data.mode === 'live') collectCache.set(kind, { at: Date.now(), data }); // never cache not_configured states
      return data;
    }
    if (kind === 'reddit') {
      const data = await collectReddit();
      collectCache.set(kind, { at: Date.now(), data });
      return data;
    }
    if (MULTI[kind]) {
      const urls = MULTI[kind];
      const pages = []; let bytes = 0, ms = 0;
      for (const u of urls) {
        try { const { body, trace } = await cappedFetch(u); pages.push(body); bytes += trace.bytes; ms += trace.durationMs; }
        catch { break; } // stop at first failed page; keep what arrived
      }
      if (!pages.length) throw new Error('all pages failed');
      const seen = new Set();
      const itemsOut = pages.flatMap(b => parse(kind, b)).filter(it => { const k = (it.title || '') + '|' + (it.date || '') + '|' + (it.link || ''); if (seen.has(k)) return false; seen.add(k); return true; });
      const data = { mode: 'live', source: meta.label, name: meta.name, fetchedAt, runId: fetchedAt, items: itemsOut, trace: { method: 'GET', url: `${pages.length} pages, first ${urls[0]}`, status: 200, bytes, durationMs: ms, excerpt: pages[0].slice(0, 1600) } };
      collectCache.set(kind, { at: Date.now(), data });
      return data;
    }
    let raw, trace;
    try { ({ body: raw, trace } = await cappedFetch(resolveUrl(kind, meta.url))); }
    catch (e1) {
      // Lemmy intermittently times out from this host; allow exactly one retry.
      if (kind !== 'lemmy') throw e1;
      await new Promise(r => setTimeout(r, 1500));
      ({ body: raw, trace } = await cappedFetch(resolveUrl(kind, meta.url)));
    }
    const data = { mode: 'live', source: meta.label, name: meta.name, fetchedAt, runId: fetchedAt, items: parse(kind, raw), trace };
    collectCache.set(kind, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { mode: 'unavailable', source: meta.label, name: meta.name, fetchedAt, detail: String(e.message || e), items: [] };
  }
}
// Persistence: JSON store. With DATA_DIR set (attached Railway volume) runs
// survive redeploys; without it the store lives on the deployment's local
// disk and a redeploy resets it.
const STORE_PATH = join(process.env.DATA_DIR || join(ROOT, 'data'), 'run-store.json');
let store = { runs: [], items: {} };
try { store = JSON.parse(await readFile(STORE_PATH, 'utf8')); } catch { /* first boot */ }
async function saveStore() { try { await writeFile(STORE_PATH, JSON.stringify(store)); } catch { /* read-only fs */ } }
const itemTitle = it => it.form ? (`Form ${it.form}` + (it.description ? ` · ${it.description}` : '')) : (it.title || '');
const itemKey = (sourceKey, it) => createHash('sha1').update(sourceKey + '|' + (it.link || (itemTitle(it) + '|' + (it.date || '')))).digest('hex').slice(0, 12);
const STOP = new Set('the a an and or of to in on for with from by at as is are was were be been it its this that these those apple inc company aapl says said new over after before into their they will has have more than'.split(' '));
const tokens = t => (String(t).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter(w => !STOP.has(w));
function matchClaims(report) {
  const pool = [];
  for (const src of report.sources) for (const it of (src.allItems || src.items)) pool.push({ source: src.name, key: src.key, title: itemTitle(it), link: it.link || '' });
  const usedKeys = new Set();
  const claimMatches = new Map();
  const claimsOut = seed.claims.map(c => {
    const ct = new Set(tokens(c.claim));
    const matches = pool.map(it => {
      const shared = [...new Set(tokens(it.title))].filter(w => ct.has(w));
      const distinctive = shared.some(w => w.length >= 7) ? 1 : 0;
      return { ...it, shared, score: shared.length + distinctive };
    }).filter(m => m.score >= 2).sort((a, b) => b.score - a.score).slice(0, 4);
    matches.forEach(m => usedKeys.add(m.key + '|' + m.title));
    return { id: c.id, claim: c.claim, snapshotStatus: c.status, candidateMatches: matches };
  });
  const perSource = report.sources.map(src => {
    const all = src.allItems || src.items;
    const itemsOut = all.map(it => {
      const title = it.form ? `Form ${it.form} ${it.description || ''}` : (it.title || '');
      const feeds = claimsOut.filter(c => c.candidateMatches.some(m => m.key === src.key && m.title === title)).map(c => c.id);
      return { title, link: it.link || '', date: it.date || '', feeds };
    });
    const used = itemsOut.filter(i => i.feeds.length).length;
    return { key: src.key, name: src.name, mode: src.mode, collected: src.itemCount, feedingFindings: used, items: itemsOut };
  });
  return { claims: claimsOut, perSource, totalCollected: pool.length, totalFeeding: usedKeys.size };
}
// Apple relevance: query-matched sources (HN, Google News) and Apple-specific
// endpoints are relevant by construction. General feeds are keyword-filtered;
// the filter is a heuristic, labeled as such on the dashboard.
const FEED_FILTERED = new Set(['verge', 'ninetofive', 'macrumors']);
const APPLE_RE = /\bapple\b|iphone|ipad|\bios\b|ipados|macos|macbook|airpods|homepod|airtag|icloud|\bsiri\b|vision pro|apple tv|apple music|apple pay|apple watch|app store|tim cook|\baapl\b|imac|mac mini|mac studio|mac pro|watchos|xcode|swiftui|itunes|airtag|keynote|wwdc|cupertino|apple park|apple store|final cut|logic pro|garageband|airplay|carplay|touch id|face id|apple intelligence|apple care|apple one|apple card|apple news|apple fitness|apple arcade|\bbeats\b|magsafe|genius bar/i;
// Confirmed non-company false-positive class: drug-checking result posts where
// "Apple" is a pill logo, not the company. Excluded from relevant counts,
// claims and trends; the raw record stays in allItems for audit.
const NON_COMPANY_RE = /\[Apple\][^\n]{0,160}?(\(\s*\d+\s*mg\s*\)|Detected:|Logo:\s*Apple)/i;
function isRelevant(key, text) { if (NON_COMPANY_RE.test(text)) return false; return (FEED_FILTERED.has(key) || QUERY_MATCHED.has(key)) ? APPLE_RE.test(text) : true; }
const QUERY_MATCHED = new Set(['hackernews', 'hncomments', 'news', 'mastodon', 'lemmy']);
function relevanceNote(key, it) {
  const text = itemTitle(it) + ' ' + (it.outlet || '') + ' ' + (it.context || '');
  if (QUERY_MATCHED.has(key)) {
    if (it.matched) return `candidate (query/tag match, not confirmed company coverage) - matched passage: "...${it.matched}..."`;
    const m = (it.context || text).match(/.{0,60}(apple|iphone|ipad|ios|macbook|airpods|vision pro|apple tv|apple watch|app store|tim cook|aapl|imac|siri).{0,80}/i);
    return m ? `candidate (query/tag match, not confirmed company coverage) - matched passage: "...${m[0].trim()}..."` : 'candidate - returned by source query/tag "Apple"; term not in collected excerpt, not confirmed company coverage';
  }
  if (FEED_FILTERED.has(key)) { const m = text.match(APPLE_RE); return m ? `keyword: ${m[0]}` : 'no Apple keyword in title'; }
  if (key === 'reddit') return 'topic community r/apple - Apple-topic by membership, not statement-specific relevance';
  return 'Apple-specific endpoint';
}
// Claim checks (extractive, no LLM): concrete company claims drawn from the
// run itself, each with its supporting passages, citations and dates.
// Syndication heuristic: near-identical wording across outlets is marked an
// echo of the same origin; distinct wording is marked separate coverage.
// Dates in collected feeds vary (ISO, RSS). Normalize to ISO yyyy-mm-dd;
// unparseable stays raw and never counts as date-compatible.
const fmtDate = d => { if (!d) return ''; const t = Date.parse(d); return Number.isNaN(t) ? String(d) : new Date(t).toISOString().slice(0, 10); };
// Event anchors: 2-3 word phrases from capitalized sequences in a claim
// ("Formula 1", "Apple TV", "iPhone Duo", "Manufacturing Program"). A passage
// must share an anchor or several distinctive terms, and be date-compatible.
const anchorPhrases = title => {
  const words = String(title || '').replace(/[®™©]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const runs = []; let run = [];
  for (const w of words) {
    if (/[A-Z0-9]/.test(w)) run.push(w.toLowerCase());
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const out = new Set();
  for (const r of runs) for (let n = 2; n <= Math.min(3, r.length); n++) for (let i = 0; i + n <= r.length; i++) out.add(r.slice(i, i + n).join(' '));
  return [...out];
};
const DAY = 86400000;
const dateCompatible = (claimDate, itemDate) => {
  const c = Date.parse(claimDate || ''), i = Date.parse(itemDate || '');
  if (Number.isNaN(c) || Number.isNaN(i)) return false;
  return i >= c - DAY && i <= c + 45 * DAY;
};
// Fetched article bodies include site navigation/tag soup (no sentence
// punctuation). Drop punctuation-free blobs so nav terms never match claims.
const cleanBody = b => String(b || '').split(/(?<=[.!?])\s+/).filter(x => /[.!?]/.test(x) && x.length <= 600).join(' ');
const jac = (a, b) => { const A = new Set(tokens(a)), B = new Set(tokens(b)); const inter = [...A].filter(w => B.has(w)).length; return inter / Math.max(1, A.size + B.size - inter); };
function validateClaims(report) {
  const pressKeys = ['news', 'verge', 'ninetofive', 'macrumors', 'hackernews'];
  const pressItems = [];
  for (const s of report.sources) if (pressKeys.includes(s.key)) for (const it of (s.relevantItems || s.allItems || [])) pressItems.push({ ...it, source: s.name, key: s.key });
  const newsroom = report.sources.find(s => s.key === 'newsroom');
  const nrItems = newsroom ? (newsroom.relevantItems || newsroom.allItems || []) : [];
  // Figure checks: filed XBRL facts -> look for the same figure in press titles.
  const figureChecks = [];
  for (const xs of report.sources) {
    if (!xs.key.startsWith('xbrl')) continue;
    for (const f of (xs.allItems || []).slice(0, 2)) {  // parser returns newest-first: latest 2 FYs
      const t = f.title || '';
      const mB = t.match(/\$([\d.]+)B/);
      const mS = mB ? null : t.match(/\$([\d.]+)(?!\d|B)/);
      const fig = mB ? mB[1] : mS ? mS[1] : null;
      const figRe = fig ? new RegExp('\\b' + fig.replace(/\./g, '\\.') + '(?!\\d)') : null;
      const withHit = figRe ? pressItems.map(it => { const hay = (it.title || '') + ' ' + (it.context || '') + ' ' + cleanBody(it.body); const hm = hay.match(figRe); return hm ? { ...it, excerpt: hay.slice(Math.max(0, hm.index - 60), hm.index + hm[0].length + 80).trim() } : null; }).filter(Boolean) : [];
      figureChecks.push({ claim: `${t} (filed to the SEC, XBRL)`, basis: 'SEC XBRL company facts, us-gaap:' + (f.concept || 'RevenueFromContractWithCustomerExcludingAssessedTax') + ', annual period ended ' + fmtDate(f.date), figure: fig, link: f.link || '', date: fmtDate(f.date),
        status: withHit.length ? 'cited-in-press' : 'no-additional-press-match-in-run',
        passages: withHit.slice(0, 5).map(it => ({ title: it.title, link: it.link || '', date: fmtDate(it.date), source: it.source, excerpt: it.excerpt })) });
    }
  }
  // Headline checks: company statements -> coverage with echo/separate wording.
  const headlineChecks = nrItems.slice(0, 6).map(h => {
    const ht = new Set(tokens(h.title || ''));
    const anchors = anchorPhrases(h.title);
    const GEN = new Set(['store','available','launch','launches','unveils','announces','worldwide','today','apple','reportedly','update','updates','week','price','prices','united','states','american','incredible','possibilities','locations','latest','weekend','open','opening','arrives','experiences','bring','brings']);
    const anchorTokens = new Set(anchors.flatMap(a => a.split(' ')));
    // An event anchor alone is not enough (every iPhone Duo story is not
    // coverage of every Duo claim): a distinctive claim term must co-occur
    // within 300 chars of the anchor, so the matched passage is about the
    // claim's event, not just the product.
    const proxMatch = (hayRaw, anchors, terms) => {
      for (const a of anchors) { let i = -1; while ((i = hayRaw.indexOf(a, i + 1)) >= 0) {
        for (const w of terms) { let j = -1; while ((j = hayRaw.indexOf(w, j + 1)) >= 0) {
          if (Math.abs(i - j) <= 300) return Math.min(i, j);
        } } } }
      return -1;
    };
    const cov = pressItems.filter(it => {
      if (!dateCompatible(h.date, it.date)) return false;
      const hayRaw = ((it.title || '') + ' ' + (it.context || '') + ' ' + cleanBody(it.body)).toLowerCase();
      const st = new Set(tokens(hayRaw));
      const shared = [...ht].filter(w => st.has(w) && w.length > 3 && !GEN.has(w));
      if (!anchors.length) { it._mi = -2; return shared.length >= 3 && shared.some(w => w.length >= 8 || /\d/.test(w)); }
      const nonAnchor = shared.filter(w => !anchorTokens.has(w));
      it._mi = nonAnchor.length ? proxMatch(hayRaw, anchors, nonAnchor) : -1;
      return it._mi >= 0;
    });
    const seen = new Set();
    // Negation/failure cues near the matched span mark the passage as
    // possible tension with the claim: kept as related evidence for review,
    // never counted as related coverage, and never asserted as a contradiction.
    const TENSION = /\b(not|never|without|no longer|fails?|failed|delays?|delayed|lacks?|lacking|missing|absent|problems?|issues?|bugs?|complaints?|isn'?t|aren'?t|won'?t|don'?t|doesn'?t|didn'?t|cannot|can'?t|unable)\b/i;
    const passages = cov.map(it => {
      const hayFull = (it.title || '') + ' ' + (it.context || '') + ' ' + cleanBody(it.body);
      const win = (it._mi != null && it._mi >= 0) ? hayFull.slice(Math.max(0, it._mi - 150), it._mi + 350) : hayFull.slice(0, 500);
      return { ...it, echo: jac(it.title, h.title) > 0.55, tension: TENSION.test(win) };
    }).filter(it => { const k = it.title; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    const clean = passages.filter(p => !p.tension);
    const separate = clean.filter(p => !p.echo);
    return { claim: h.title, basis: 'Apple Newsroom (company statement)', date: fmtDate(h.date), link: h.link || '',
      outlets: [...new Set(passages.map(p => p.source))],
      status: !passages.length ? 'no-outside-coverage-in-run' : (!clean.length ? 'possible-tension-review' : (separate.length ? 'related-separate-wording' : 'echoed-only')),
      passages: passages.map(p => {
        const hayOrig = (p.title || '') + ' ' + (p.context || '') + ' ' + cleanBody(p.body);
        const hayFull = hayOrig.toLowerCase();
        let idx = (p._mi != null && p._mi >= 0) ? p._mi : -1;
        if (idx < 0) {
          const st2 = new Set(tokens(hayFull));
          const term = [...ht].find(w => st2.has(w) && w.length > 3 && !GEN.has(w) && !anchorTokens.has(w));
          idx = term ? hayFull.indexOf(term) : -1;
        }
        const excerpt = idx >= 0 ? hayOrig.slice(Math.max(0, idx - 60), idx + 200).trim() : (p.context || '').slice(0, 180);
        return { title: p.title, link: p.link || '', date: fmtDate(p.date), source: p.source, excerpt, wording: p.echo ? 'echo' : 'separate', tension: !!p.tension };
      }) };
  });
  // Contradiction candidates: collected items citing a different revenue-scale
  // figure than the filed XBRL values. A mismatch can be a different period or
  // metric - flagged for review, never asserted as an error.
  const filedFigs = new Set(figureChecks.map(c => c.figure).filter(Boolean));
  const figMention = /\$([\d]{2,3}(?:\.\d)?)\s*(?:B|billion)/g;
  const contradictions = [];
  for (const it of pressItems) {
    const hay = (it.title || '') + ' ' + (it.context || '') + ' ' + cleanBody(it.body);
    if (!/revenue|sales|fiscal|annual/i.test(hay)) continue;
    for (const m of hay.matchAll(figMention)) {
      // Only annual-scope mentions are comparable to filed annual figures;
      // quarterly or unscoped figures are not contradiction candidates.
      const around = hay.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
      if (!/fiscal year|fy\s*'?20\d\d|annual|full[- ]year|year ended/i.test(around)) continue;
      if (!filedFigs.has(m[1])) {
        contradictions.push({ claim: `Collected item cites $${m[1]}B, which matches no filed annual revenue figure (${[...filedFigs].map(f => '$' + f + 'B').join(', ')})`, basis: 'Collected items vs SEC XBRL facts', status: 'different-figure-found',
          passages: [{ title: it.title, link: it.link || '', date: fmtDate(it.date), source: it.source, excerpt: hay.slice(Math.max(0, m.index - 60), m.index + m[0].length + 80).trim() }] });
        break;
      }
    }
    if (contradictions.length >= 3) break;
  }
  // Deterministic coverage score: filed figures count double (verified class).
  const figCited = figureChecks.filter(c => c.status === 'cited-in-press').length;
  const headCov = headlineChecks.filter(c => c.status === 'related-separate-wording' || c.status === 'echoed-only').length;
  const tensionN = headlineChecks.reduce((n, c) => n + c.passages.filter(p => p.tension).length, 0);
  const denom = figureChecks.length * 2 + headlineChecks.length;
  const score = denom ? Math.round(((figCited * 2 + headCov) / denom) * 100) : 0;
  const coverageScore = { score, label: 'Related-evidence coverage (wording level)', drivers: `${figCited} of ${figureChecks.length} filed figures' exact value strings found (weight 2x), ${headCov} of ${headlineChecks.length} company statements with related collected evidence (echo or distinct wording only); ${tensionN} passage(s) flagged possible tension and excluded`, scope: 'Presence of related wording within items collected this run only. This is not corroboration, support, or verification of any claim, and absence means the collected set lacks related items, not that coverage does not exist.' };
  return { figureChecks, headlineChecks, contradictions, coverageScore, method: `Extractive matching over titles, feed summaries, and fetched article bodies (${(report.articleBodies || {}).fetched || 0} of ${(report.articleBodies || {}).of || 0} newest press items) collected in this run: identical figures (word-boundary matched), and date-compatible passages where a distinctive claim term appears within 300 characters of an event anchor phrase (or at least three distinctive terms for anchor-less claims); site navigation stripped from fetched bodies. Matched passages are quoted so the basis of each match is visible. Relationship classes: "echo" = near-identical wording (same origin likely); "related" = distinct wording, date-compatible anchor/term proximity - relevance only, never support; "possible tension" = negation or failure wording near the matched span, excluded from coverage and flagged for review, never asserted as a contradiction. "Not found in collected items" means exactly that - it is not evidence that coverage or a citation does not exist.` };
}
async function runReport() {
  const runAt = new Date().toISOString();
  const settled = await Promise.allSettled(SOURCES.map(s => collect(s.key)));
  const sources = settled.map((r, i) => {
    const d = r.status === 'fulfilled' ? r.value : { mode: 'unavailable', source: SOURCES[i].label, name: SOURCES[i].name, fetchedAt: runAt, detail: String(r.reason), items: [] };
    for (const it of d.items) it.relevance = relevanceNote(SOURCES[i].key, it);
    const relevant = d.items.filter(it => isRelevant(SOURCES[i].key, itemTitle(it) + ' ' + (it.outlet || '') + ' ' + (it.context || '') + ' ' + (it.matched || '')));
    return { key: SOURCES[i].key, name: d.name, source: d.source, mode: d.mode, fetchedAt: d.fetchedAt, cached: !!d.cached, itemCount: d.items.length, relevantCount: relevant.length, candidateCount: QUERY_MATCHED.has(SOURCES[i].key) ? relevant.length : 0, items: d.items.slice(0, 3), allItems: d.items, relevantItems: relevant, detail: d.detail };
  });
  // Bounded article-body depth: bodies for the 12 newest collected press items,
  // so claim checks inspect passages, not only titles and summaries.
  const PRESS_BODY_KEYS = new Set(['news', 'verge', 'ninetofive', 'macrumors']);
  const pressPool = [];
  for (const s of sources) { if (!PRESS_BODY_KEYS.has(s.key)) continue; for (const it of (s.relevantItems || [])) if (it.link) pressPool.push(it); }
  pressPool.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const bodyTargets = pressPool.slice(0, 12);
  const bodies = await Promise.allSettled(bodyTargets.map(it => fetchArticleText(it.link)));
  let bodiesFetched = 0;
  bodies.forEach((r, i) => { if (r.status === 'fulfilled' && r.value && r.value.length > 200) { bodyTargets[i].body = r.value; bodiesFetched++; } });
  const TREND_KEYS = new Set(['hackernews', 'hncomments', 'reviews', 'mastodon', 'lemmy', 'news', 'verge', 'ninetofive', 'macrumors']);
  const byDay = {};
  for (const s of sources) { if (!TREND_KEYS.has(s.key)) continue; for (const it of (s.relevantItems || [])) { const d = (it.date || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue; byDay[d] = (byDay[d] || 0) + 1; } }
  const trendDays = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([day, count]) => ({ day, count }));
  const report = {
    company: 'Apple Inc. (AAPL)', generatedAt: runAt,
    articleBodies: { fetched: bodiesFetched, of: bodyTargets.length },
    trends: { days: trendDays, scope: 'Collected press/forum/social/review items per UTC day. Collection windows differ per source; this is collected volume, not total internet volume.' },
    liveCount: sources.filter(s => s.mode === 'live').length, downCount: sources.filter(s => s.mode !== 'live').length,
    relevantTotal: sources.reduce((n, s) => n + (s.relevantCount || 0), 0),
    candidateTotal: sources.reduce((n, s) => n + (s.candidateCount || 0), 0),
    sources
  };
  let newItems = 0, seenBefore = 0;
  for (const s of sources) for (const it of s.allItems) {
    const k = itemKey(s.key, it);
    const rec = store.items[k];
    if (rec) { rec.lastSeenAt = runAt; rec.runCount++; seenBefore++; }
    else { store.items[k] = { source: s.name, title: itemTitle(it), link: it.link || '', date: it.date || '', firstSeenAt: runAt, lastSeenAt: runAt, runCount: 1 }; newItems++; }
  }
  store.runs.push({ generatedAt: runAt, live: report.liveCount, down: report.downCount, items: sources.reduce((n, s) => n + s.itemCount, 0), newItems });
  if (store.runs.length > 50) store.runs.shift();
  await saveStore();
  report.persistence = { runs: store.runs.length, uniqueItems: Object.keys(store.items).length, newThisRun: newItems, seenBeforeThisRun: seenBefore, storage: process.env.DATA_DIR ? 'attached Railway volume (' + process.env.DATA_DIR + ')' : 'on-disk JSON within this deployment', resetsOn: process.env.DATA_DIR ? 'volume deletion or service rebuild without the volume' : 'redeploy or container replacement' };
  return report;
}

// ===== Diligence workflow: fundamentals, risk-cued coverage, competitive
// co-mentions, open questions, cited memo. Extractive over this run's collected
// records only; no LLM, no invented judgments. Missing evidence is listed, not filled.
const RISK_RE = /\b(lawsuit|sued|antitrust|fined|regulatory fine|penalt\w+|recall|layoffs?|laid off|outage|data breach|security breach|vulnerabilit\w+|exploit\w*|investigation|probe|downgrades?|banned|tariffs?|settlement|complaint|delayed|delays|misses|missed|declin\w+|doj|ftc)\b/i;
const COMPETITORS = ['Samsung', 'Google', 'Microsoft', 'Meta', 'Huawei', 'Xiaomi', 'OpenAI', 'Amazon', 'Nvidia'];function buildDiligence(report, v) {
  const all = [];
  for (const s of report.sources) for (const it of (s.relevantItems || [])) all.push({ ...it, source: s.name, key: s.key });
  const concepts = [['xbrl', 'Revenue'], ['xbrl_ni', 'Net income'], ['xbrl_rd', 'R&D expense'], ['xbrl_eps', 'Diluted EPS']];
  const fyMap = {};
  for (const [k, label] of concepts) {
    const src = report.sources.find(x => x.key === k);
    for (const it of (src && src.allItems) || []) {
      const fy = (it.title || '').slice(0, 6);
      if (!/^FY\d{4}$/.test(fy)) continue;
      (fyMap[fy] = fyMap[fy] || { fy, date: fmtDate(it.date), rows: {} }).rows[label] = { value: (it.title || '').replace(/^FY\d{4}\s*(revenue|net income|R&D expense|diluted EPS)\s*/i, ''), raw: it.rawVal, unit: it.unit || '', accession: it.accession || '', filed: it.filed || '', concept: it.concept || '', link: it.link || '' };
    }
  }
  const fundamentals = Object.values(fyMap).sort((a, b) => b.fy.localeCompare(a.fy)).slice(0, 2);
  const deltas = [];
  if (fundamentals.length >= 2) {
    const [cur, prev] = fundamentals;
    for (const m of concepts.map(c => c[1])) {
      const a = cur.rows[m] && cur.rows[m].raw, b = prev.rows[m] && prev.rows[m].raw;
      if (a != null && b != null && b !== 0) deltas.push({ metric: m, cur: cur.rows[m].value, prev: prev.rows[m].value, pct: ((a - b) / Math.abs(b) * 100).toFixed(1), unit: cur.rows[m].unit });
    }
  }
  // Filing-disclosed risk factors (latest 10-K, Item 1A).
  const rfSrc = report.sources.find(x => x.key === 'riskfactors');
  const riskFactors = rfSrc && rfSrc.mode === 'live' ? (rfSrc.allItems || []) : [];
  const rfMeta = riskFactors.length ? { filed: fmtDate(riskFactors[0].date), accession: riskFactors[0].accession, link: riskFactors[0].link } : null;
  // Risk-cued coverage: confirmed-relevant items only (candidates excluded).
  const confirmed = all.filter(it => !/^candidate/.test(it.relevance || ''));
  const riskCues = confirmed.filter(it => RISK_RE.test((it.title || '') + ' ' + (it.context || '')))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 10)
    .map(it => ({ title: (it.title || '').slice(0, 200), source: it.source, date: fmtDate(it.date), link: it.link || '', cue: (((it.title || '') + ' ' + (it.context || '')).match(RISK_RE) || [])[0] || '' }));
  // Cross-reference: collected risk-cued coverage vs the company's own disclosed
  // risk factors. Shared significant terms only; a match means the coverage
  // touches a risk the company itself disclosed, not that the risk is realized.
  // Fixed lexicon groups (disclosed in Method): the 10-K states risk areas in
  // generic legal wording, so verbatim token overlap alone misses real topical
  // matches (e.g. "DOJ" vs "legal proceedings"). Each group pairs a coverage
  // pattern with the filed-wording pattern for the same risk area.
  const RISK_LEXICON = [
    { group: 'legal and regulatory proceedings', cue: /\b(antitrust|doj|ftc|lawsuit|sued|deposition|investigation|probe|settlement|regulatory|penalt\w+)\b/i, risk: /\b(legal|lawsuits?|investigations?|regulat\w+|penalt\w+|proceedings|legislation|scrutiny)\b/i },
    { group: 'data security and confidentiality', cue: /\b(breach|vulnerabilit\w*|exploit\w*|hack\w*|scamm\w*)\b/i, risk: /\b(confidential|unauthorized|information technology|network disruptions|cyber)\b/i },
    { group: 'carrier and channel performance', cue: /\b(verizon|at&t|t-mobile|carrier\w*|reseller\w*)\b/i, risk: /\b(carriers?|resellers?)\b/i },
    { group: 'supply chain and manufacturing', cue: /\b(tariff\w*|supply|component\w*|manufactur\w*|shortage\w*)\b/i, risk: /\b(component\w*|manufactur\w*|supply|outsourcing|tariff\w*)\b/i },
    { group: 'workforce and talent', cue: /\b(layoffs?|laid off|hiring|recruit\w*)\b/i, risk: /\b(team members|employees|personnel|culture|talents)\b/i }
  ];
  const riskCross = [];
  for (const cue of riskCues) {
    const hay = cue.title;
    for (const g of RISK_LEXICON) {
      if (!g.cue.test(hay)) continue;
      // Prefer the statement whose category names the same risk area (a
      // Business Risks statement mentioning "legal" must not stand in for the
      // Legal and Regulatory Compliance Risks statement).
      const catWord = g.group.split(' ')[0];
      const rf = riskFactors.find(x => g.risk.test(x.title) && (x.category || '').toLowerCase().includes(catWord))
        || riskFactors.find(x => g.risk.test(x.title));
      if (rf) { riskCross.push({ cue, risk: rf, group: g.group }); break; }
    }
  }
  // Co-mention exploration appendix (all collected items incl. candidates and old stories).
  const compCounts = {}, compExamples = {};
  let oldest = null;
  for (const it of all) {
    const t = (it.title || '') + ' ' + (it.context || '');
    const dte = fmtDate(it.date);
    if (dte && (!oldest || dte < oldest)) oldest = dte;
    for (const c of COMPETITORS) if (new RegExp('\\b' + c + '\\b', 'i').test(t)) { compCounts[c] = (compCounts[c] || 0) + 1; if (!compExamples[c]) compExamples[c] = { title: (it.title || '').slice(0, 160), source: it.source, date: dte, link: it.link || '' }; }
  }
  const competitors = Object.entries(compCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, example: compExamples[name] }));
  // Evidence balance: business facts only - filed figures, dated coverage events,
  // disclosed risks matched by coverage. Wording-coverage metrics never enter here.
  const toward = [], against = [];
  const growing = deltas.filter(d => parseFloat(d.pct) > 0).map(d => d.metric);
  const shrinking = deltas.filter(d => parseFloat(d.pct) < 0).map(d => d.metric);
  if (growing.length) toward.push({ text: `Filed figures up year over year: ${growing.join(', ')} (computed from the SEC XBRL citations in Fundamentals)`, link: '' });
  if (shrinking.length) against.push({ text: `Filed figures down year over year: ${shrinking.join(', ')} (computed from the SEC XBRL citations in Fundamentals)`, link: '' });
  const tensions = [];
  for (const c of v.headlineChecks) for (const p of (c.passages || [])) if (p.tension) tensions.push({ claim: c.claim, p });
  for (const t of tensions) against.push({ text: `Possible tension on "${t.claim}": ${t.p.source}, ${t.p.date}: "${t.p.title}"`, link: t.p.link });
  for (const r of riskCues.slice(0, 3)) against.push({ text: `Risk-cued coverage: ${r.date} · ${r.source}: "${r.title}" (cue: ${r.cue})`, link: r.link });
  for (const x of riskCross.slice(0, 3)) against.push({ text: `Coverage touches a risk area the company itself discloses in its 10-K (${x.group}): "${x.cue.title}" (${x.cue.source})`, link: x.cue.link });
  // Research questions with resolution status (coverage findings live here, not in the balance).
  const researchQuestions = [];
  for (const f of (v.figureChecks || [])) researchQuestions.push({ q: `What is the filed ${(/FY\d{4} [a-z& ]+/i.exec(f.claim) || [f.claim])[0].trim()}?`, status: 'resolved-primary-source', detail: f.basis, link: f.link || '' });
  for (const c of (v.headlineChecks || [])) researchQuestions.push({ q: `Is there coverage beyond company channels of: ${c.claim}?`, status: c.status === 'no-outside-coverage-in-run' ? 'open-no-coverage-collected' : 'resolved-' + c.status, detail: (c.passages && c.passages[0]) ? `${c.passages[0].source}: "${c.passages[0].title}"` : 'no collected passage', link: (c.passages && c.passages[0] && c.passages[0].link) || c.link || '' });
  const knownGaps = [
    { area: 'X/Twitter coverage', detail: 'Not part of the collected source set in this run.' },
    { area: 'Employee commentary', detail: 'No collected source verifies employee self-attribution; forum and social items are unknown-speaker commentary.' },
    { area: 'Public mention analytics', detail: 'Historical aggregate as of 2026-10-20, not a live feed.' }
  ];
  const openQuestions = [...knownGaps];
  for (const s of report.sources) if (s.mode !== 'live') openQuestions.push({ area: s.name + ' unavailable this run', detail: (s.detail || 'fetch failed').slice(0, 220) });
  return { fundamentals, deltas, riskCues, riskFactors, rfMeta, riskCross, competitors, competitorsOldest: oldest, toward, against, researchQuestions, openQuestions,
    labels: { fundamentals: 'Filed SEC XBRL facts (exact us-gaap concept, USD unit, 10-K form, annual period), deduped by period end preferring the latest-filed accession.',
      deltas: 'Year-over-year arithmetic on the cited filed figures above - computed values, not independent estimates.',
      risk: 'Keyword-cued coverage in confirmed-relevant items (query-match candidates excluded) - cues for review, not a risk assessment.',
      riskFactors: 'Extracted verbatim from Item 1A of the latest 10-K. The company\'s own disclosed risk wording - not this analysis\'s conclusions.',
      riskCross: 'Collected coverage items matched to the company\'s disclosed risk areas through a fixed, disclosed term lexicon (see Method). A match means the coverage touches a disclosed risk area, not that the risk is realized.',
      balance: 'Business facts collected this run, for and against - filed figures, dated coverage events, and disclosed-risk cross-references. Coverage/wording metrics are reported separately as research questions and never count as evidence here.',
      competitors: 'Exploration appendix: name co-occurrence across ALL collected items (any date, including older stories and candidate query-matches) - raw co-occurrence, not current competitive analysis.',
      open: 'Known missing coverage and unavailable sources. Absence here is not proof a fact or coverage does not exist.' } };
}
function buildMemo(report, v, d) {
  const L = [];
  const total = report.sources.reduce((n, s) => n + s.itemCount, 0);
  L.push('# Diligence memo - Apple Inc. (AAPL)');
  L.push(`Generated ${report.generatedAt} from ${total.toLocaleString('en-US')} collected public records across ${report.liveCount} live sources (${(report.candidateTotal || 0).toLocaleString('en-US')} candidate query-matches counted separately). Run history: ${report.persistence.runs} recorded runs, ${report.persistence.uniqueItems.toLocaleString('en-US')} unique records on file (${report.persistence.storage}).`);
  L.push('');
  L.push('Every section cites the collected evidence it rests on. What this run cannot confirm is listed under Open questions - missing evidence is never filled with invented conclusions. Nothing here is an investment recommendation.');
  L.push('');
  L.push('## 1. Fundamentals (filed SEC XBRL facts)');
  L.push(d.labels.fundamentals); L.push('');
  for (const fy of d.fundamentals) {
    L.push(`### ${fy.fy} (annual period ended ${fy.date})`);
    for (const [label, r] of Object.entries(fy.rows)) L.push(`- ${label}: ${r.value} - us-gaap:${r.concept} (${r.unit}) - accession ${r.accession}, filed ${r.filed} - ${r.link}`);
    L.push('');
  }
  L.push('## 2. Financial interpretation (computed)');
  L.push(d.labels.deltas); L.push('');
  if (d.deltas.length) for (const x of d.deltas) L.push(`- ${x.metric}: ${x.cur} vs ${x.prev} - ${x.pct}% YoY (${x.unit})`);
  else L.push('- Not enough annual periods collected to compute.');
  L.push('');
  L.push('## 3. Evidence balance (business facts)');
  L.push(d.labels.balance); L.push('');
  L.push('Leans toward:'); for (const t of d.toward) L.push(`- ${t.text}${t.link ? ' - ' + t.link : ''}`);
  L.push(''); L.push('Leans against / unresolved:'); for (const a of d.against) L.push(`- ${a.text}${a.link ? ' - ' + a.link : ''}`);
  L.push('');
  L.push('## 4. Filing-disclosed risk factors (latest 10-K, Item 1A)');
  L.push(d.labels.riskFactors);
  if (d.rfMeta) L.push(`Source: 10-K for the annual period ended ${d.fundamentals[0] ? d.fundamentals[0].date : ''}, accession ${d.rfMeta.accession}, filed ${d.rfMeta.filed} - ${d.rfMeta.link}`);
  L.push('');
  if (d.riskFactors.length) {
    let cat = null;
    for (const rf of d.riskFactors) { if (rf.category !== cat) { cat = rf.category; L.push(`### ${cat}`); } L.push(`- ${rf.title}`); }
  } else L.push('- Not collected this run.');
  L.push('');
  L.push('## 5. Coverage vs disclosed risks');
  L.push(d.labels.riskCross); L.push('');
  if (d.riskCross.length) for (const x of d.riskCross) L.push(`- ${x.cue.date} · ${x.cue.source}: "${x.cue.title}" ${x.cue.link}\n  Disclosed risk area: ${x.group} - filed wording (${x.risk.category}): "${x.risk.title}"`);
  else L.push('- No collected coverage item shares significant terms with a disclosed risk factor this run.');
  L.push('');
  L.push('## 6. Risk-cued coverage');
  L.push(d.labels.risk); L.push('');
  if (d.riskCues.length) for (const r of d.riskCues) L.push(`- ${r.date} · ${r.source}: "${r.title}" (cue: ${r.cue}) ${r.link}`);
  else L.push('- No risk-cued items in confirmed-relevant coverage this run.');
  L.push('');
  L.push('## 7. Claim checks (related-evidence coverage, wording level)');
  L.push(`${v.coverageScore.score}/100 - ${v.coverageScore.drivers}`);
  L.push(v.coverageScore.scope); L.push('');
  for (const c of v.figureChecks) L.push(`- [${c.status}] ${c.claim} - ${c.basis}${c.link ? ' - ' + c.link : ''}`);
  L.push('');
  for (const c of v.headlineChecks) L.push(`- [${c.status}] ${c.claim}${c.date ? ' (' + c.date + ')' : ''}`);
  L.push('');
  L.push('## 8. Counter-evidence and unresolved checks');
  L.push('Passages flagged possible tension (negation/failure wording near the matched span - related evidence for review, never counted as coverage), figure mismatches, and checks without additional press match (the primary SEC citation stands in Fundamentals).');
  L.push('');
  if (tensionsFromV(v).length) for (const t of tensionsFromV(v)) L.push(`- TENSION on "${t.claim}": ${t.p.source}, ${t.p.date}: "${t.p.title}" ${t.p.link}${t.p.excerpt ? '\n  Passage: "...' + t.p.excerpt + '..."' : ''}`);
  else L.push('- No tension-flagged passages this run.');
  for (const c of (v.contradictions || [])) L.push(`- FIGURE MISMATCH CANDIDATE: ${c.claim} - ${c.basis}`);
  L.push('');
  L.push('## 9. Research questions and resolution status');
  for (const q of d.researchQuestions) L.push(`- [${q.status}] ${q.q} - ${q.detail}${q.link ? ' - ' + q.link : ''}`);
  L.push('');
  L.push('## 10. Open questions (known gaps)');
  L.push(d.labels.open); L.push('');
  for (const q of d.openQuestions) L.push(`- ${q.area}: ${q.detail}`);
  L.push('');
  L.push('## Appendix. Co-mention exploration');
  L.push(d.labels.competitors + (d.competitorsOldest ? ` Oldest collected item dates back to ${d.competitorsOldest}.` : '')); L.push('');
  if (d.competitors.length) for (const c of d.competitors) L.push(`- ${c.name}: ${c.count} collected item(s). Example: ${c.example.date} · ${c.example.source}: "${c.example.title}" ${c.example.link}`);
  else L.push('- None this run.');
  L.push('');
  L.push('## Method and limits');
  L.push(v.method);
  L.push('Coverage-to-disclosed-risk matching uses a fixed lexicon of five term groups (legal and regulatory proceedings; data security and confidentiality; carrier and channel performance; supply chain and manufacturing; workforce and talent), each pairing a coverage pattern with the filed-wording pattern of the same risk area; the groups are fixed in the source, not generated per run.');
  L.push('Public sources only; no login-walled or paywalled collection; no LLM in the backend; matching is extractive and quoted. Query/tag-matched items are candidates, counted separately and excluded from risk cues. Collection cadence and per-source windows differ; deduplicated records persist on an attached volume across runs.');
  return L.join('\n');
}
function tensionsFromV(v) {
  const out = [];
  for (const c of v.headlineChecks) for (const p of (c.passages || [])) if (p.tension) out.push({ claim: c.claim, p });
  return out;
}


// Supplier vetting vertical slice (Cal Hacks 13.0, SpaceXSI track direction):
// broad company-vetting product; this pack is the space-supplier example built
// on REAL space data (USASpending award records + NASA NTRS citations), both
// keyless public APIs. Fetched live per request; nothing seeded, nothing
// fabricated. Contract history shows agencies bought from the supplier - it
// does NOT by itself establish reliability or qualification; the pack says so.
const STOP_TOKENS = new Set(['inc','llc','ltd','corp','corporation','company','co','the','lp','llp']);
const nameTokens = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !STOP_TOKENS.has(t));
const nameMatches = (candidate, toks) => {
  const rt = new Set(nameTokens(candidate));
  return toks.length > 0 && toks.every(t => rt.has(t));
};
async function buildSupplierPack(name) {
  const fetchedAt = new Date().toISOString();
  const queryToks = nameTokens(name);
  const pack = {
    supplier: name, fetchedAt, provenance: 'fetched_live',
    awards: [], citations: [], sources: [],
    caveats: [
      'Contract history shows an agency agreed to buy from this supplier; it does not by itself establish reliability, quality, or qualification.',
      'Award amounts are obligations as recorded in USASpending at query time; always read them with their start date and description.',
      'Records are candidate name matches requiring identity confirmation, not entity resolution: distinct legal entities can share name tokens; subsidiaries, acquisitions and name variants are missed; absence of a record here is not evidence of absence.',
      'Awards stay grouped under their exact recorded legal recipient names; a name match or a reported ownership relationship does not by itself merge distinct legal entities.',
      'NASA citations are keyword search matches. Only entries whose recorded author affiliation matches the queried name count as company-associated; everything else is a search match, not the company\'s research or technical record.'
    ],
    plannedConnectors: [
      { key: 'Deep web research', state: 'not included', detail: 'Full-page research, structured extraction and change monitoring. Not included in this pack.' },
      { key: 'Business credit evidence', state: 'not included', detail: 'Credit-risk signals for the supplier. Not included in this pack.' },
      { key: 'Evidence purchasing', state: 'not included', detail: 'Per-datapoint paid access to premium evidence. Not included in this pack.' }
    ]
  };
  // USASpending: federal award history for the recipient name (contracts only).
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
      // Name-matched records only: recipient_search_text is fuzzy text search,
      // not entity resolution - unfiltered it returns wrong entities.
      pack.awards = (j.results || []).filter(a => nameMatches(a['Recipient Name'], queryToks)).map(a => ({
        awardId: a['Award ID'] || null,
        recipient: a['Recipient Name'] || null,
        startDate: a['Start Date'] || null,
        obligatedAmountUsd: (typeof a['Award Amount'] === 'number' ? a['Award Amount'] : null),
        agency: a['Awarding Agency'] || null,
        description: a['Description'] || null,
        sourceUrl: a['Award ID'] ? ('https://www.usaspending.gov/award/' + encodeURIComponent(a['Award ID'])) : null
      }));
      // Group by the exact recorded legal recipient name: distinct entities stay distinct.
      const groups = new Map();
      for (const a of pack.awards) {
        const key = a.recipient || '(recipient not recorded)';
        if (!groups.has(key)) groups.set(key, { recipient: key, awardCount: 0, totalObligatedUsd: 0, totalComplete: true, awards: [] });
        const g = groups.get(key);
        g.awardCount += 1;
        if (a.obligatedAmountUsd == null) g.totalComplete = false; else g.totalObligatedUsd += a.obligatedAmountUsd;
        g.awards.push(a);
      }
      pack.recipientGroups = [...groups.values()].sort((a, b) => b.awardCount - a.awardCount)
        .map(g => ({ recipient: g.recipient, awardCount: g.awardCount, totalObligatedUsd: g.totalComplete ? g.totalObligatedUsd : null, awards: g.awards }));
      pack.sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: pack.awards.length, mode: 'live' });
    } else {
      pack.sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
    }
  } catch (e) {
    pack.sources.push({ key: 'usaspending', name: 'USASpending award search', url: 'https://www.usaspending.gov/', fetched: 0, mode: 'error', detail: String(e.message || e) });
  }
  // NASA NTRS: technical reports citing the supplier.
  try {
    const r = await fetch('https://ntrs.nasa.gov/api/citations/search?q=' + encodeURIComponent(name) + '&size=8', { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      // Explicit association only: an author affiliation whose organization
      // name matches the query tokens. A keyword hit in title/abstract is NOT
      // the company's research record - label those as search matches.
      const seen = new Set();
      pack.citations = (j.results || []).map(c => {
        const orgs = [...new Set((c.authorAffiliations || []).map(a => a && a.meta && a.meta.organization && a.meta.organization.name).filter(Boolean))];
        const matched = orgs.filter(o => nameMatches(o, queryToks));
        return {
          title: c.title || null,
          id: c.id || null,
          sourceUrl: c.id ? ('https://ntrs.nasa.gov/citations/' + c.id) : null,
          association: matched.length
            ? { state: 'affiliation_verified', organizations: matched }
            : { state: 'search_match', organizations: orgs.slice(0, 3) }
        };
      }).filter(c => c.title && !seen.has(c.title) && seen.add(c.title));
      pack.citations.sort((a, b) => (a.association.state === b.association.state ? 0 : a.association.state === 'affiliation_verified' ? -1 : 1));
      pack.sources.push({ key: 'ntrs', name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/', fetched: pack.citations.length, mode: 'live' });
    } else {
      pack.sources.push({ key: 'ntrs', name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/', fetched: 0, mode: 'error', detail: 'HTTP ' + r.status });
    }
  } catch (e) {
    pack.sources.push({ key: 'ntrs', name: 'NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/', fetched: 0, mode: 'error', detail: String(e.message || e) });
  }
  return pack;
}

const appHandler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url, ip).catch(() => send(res, 500, { error: 'internal' }));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not_found' });
  }
};

// x402 paid-access gate: absent unless X402_ENABLED=true; fails CLOSED on any
// enable error (data routes 503, never free). See x402-gate.mjs.
const gated = await maybeWrapWithX402(appHandler);
gateStatus = gated.status;
createServer(gated.handler).listen(PORT, () => console.log(`company-evidence-index listening on :${PORT} (x402: ${gateStatus.state})`));
