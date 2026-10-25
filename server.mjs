// Company Evidence Index - demo backend (Cal Hacks 13.0)
// One process: serves the static frontend and the JSON API under /api/*.
// Zero dependencies (Node >=20). Seeded demo data only - no live source
// fetching, no LLM, no OTP provider: those are unapproved open dependencies
// (docs/auth-backend-spec.md §9). Admin mutations return an honest
// not-provisioned state instead of a fake gate. Public GETs only.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';

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

async function handleApi(req, res, url, ip) {
  if (!allowed(ip)) return send(res, 429, { error: 'rate_limited', detail: 'Per-IP request budget exhausted; retry shortly.' });
  const p = url.pathname;
  if (p === '/api/health') return send(res, 200, { status: 'ok', service: 'company-evidence-index', seeded: true });

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
  const collectMatch = p.match(/^\/api\/companies\/apple\/collect\/([a-z]+)$/);
  if (collectMatch && ALLOWED[collectMatch[1]]) return send(res, 200, await collect(collectMatch[1]));
  if (p === '/api/companies/apple/report') return send(res, 200, await runReport());
  if (p === '/api/companies/apple/analysis') {
    const report = await runReport();
    return send(res, 200, { ...report, analysis: matchClaims(report), validation: validateClaims(report), history: store.runs, historyNote: 'Runs persist to disk within this deployment; a redeploy resets the store. No external database.' });
  }
  const traceMatch = p.match(/^\/api\/companies\/apple\/collect\/([a-z]+)\/trace$/);
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
  { key: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', label: 'The Verge RSS' },
  { key: 'mastodon', name: 'Mastodon #apple', url: 'https://mastodon.social/api/v1/timelines/tag/apple?limit=40', label: 'Mastodon public tag timeline API' },
  { key: 'lemmy', name: 'Lemmy', url: 'https://lemmy.world/api/v3/search?q=apple&type_=Posts&limit=50&sort=New', label: 'Lemmy public search API' }
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
const items = xml => [...xml.matchAll(/<item[ >][\s\S]*?<\/item>/g)].map(m => m[0]);
const decodeEntities = t => t.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&nbsp;/g, ' ');
const field = (item, name) => { const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim() : ''; };
const linkOf = it => { const m = it.match(/<link[^>]*href="([^"]+)"/) || it.match(/<link[^>]*>([^<]+)</); return m ? m[1].trim() : ''; };
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
  if (kind === 'xbrl') {
    const j = JSON.parse(raw);
    const usd = ((j.units && j.units.USD) || []).filter(u => u.fp === 'FY');
    const seen = new Set();
    return usd.slice().reverse().filter(u => { const k = String(u.val); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5).map(u => ({ title: `FY${String(u.end || '').slice(0, 4)} revenue $${(u.val / 1e9).toFixed(1)}B`, date: u.end, link: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K' }));
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
async function collect(kind) {
  const hit = collectCache.get(kind);
  if (hit && Date.now() - hit.at < 600_000) return { ...hit.data, cached: true };
  const meta = SOURCES.find(s => s.key === kind);
  const fetchedAt = new Date().toISOString();
  try {
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
    const { body: raw, trace } = await cappedFetch(resolveUrl(kind, meta.url));
    const data = { mode: 'live', source: meta.label, name: meta.name, fetchedAt, runId: fetchedAt, items: parse(kind, raw), trace };
    collectCache.set(kind, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { mode: 'unavailable', source: meta.label, name: meta.name, fetchedAt, detail: String(e.message || e), items: [] };
  }
}
// Persistence: JSON store on the deployment's local disk. Survives process
// restarts inside this deployment; a redeploy or container replacement resets
// it. No external database is provisioned.
const STORE_PATH = join(ROOT, 'data', 'run-store.json');
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
function isRelevant(key, text) { return (FEED_FILTERED.has(key) || QUERY_MATCHED.has(key)) ? APPLE_RE.test(text) : true; }
const QUERY_MATCHED = new Set(['hackernews', 'hncomments', 'news', 'mastodon', 'lemmy']);
function relevanceNote(key, it) {
  const text = itemTitle(it) + ' ' + (it.outlet || '') + ' ' + (it.context || '');
  if (QUERY_MATCHED.has(key)) {
    if (it.matched) return `matched passage: "...${it.matched}..."`;
    const m = (it.context || text).match(/.{0,60}(apple|iphone|ipad|ios|macbook|airpods|vision pro|apple tv|apple watch|app store|tim cook|aapl|imac|siri).{0,80}/i);
    return m ? `matched passage: "...${m[0].trim()}..."` : 'returned by source query/tag "Apple"; term not in collected excerpt';
  }
  if (FEED_FILTERED.has(key)) { const m = text.match(APPLE_RE); return m ? `keyword: ${m[0]}` : 'no Apple keyword in title'; }
  return 'Apple-specific endpoint';
}
// Claim checks (extractive, no LLM): concrete company claims drawn from the
// run itself, each with its supporting passages, citations and dates.
// Syndication heuristic: near-identical wording across outlets is marked an
// echo of the same origin; distinct wording is marked separate coverage.
const jac = (a, b) => { const A = new Set(tokens(a)), B = new Set(tokens(b)); const inter = [...A].filter(w => B.has(w)).length; return inter / Math.max(1, A.size + B.size - inter); };
function validateClaims(report) {
  const pressKeys = ['news', 'verge', 'ninetofive', 'macrumors', 'hackernews'];
  const pressItems = [];
  for (const s of report.sources) if (pressKeys.includes(s.key)) for (const it of (s.relevantItems || s.allItems || [])) pressItems.push({ ...it, source: s.name, key: s.key });
  const newsroom = report.sources.find(s => s.key === 'newsroom');
  const nrItems = newsroom ? (newsroom.relevantItems || newsroom.allItems || []) : [];
  // Figure checks: filed XBRL facts -> look for the same figure in press titles.
  const xbrl = report.sources.find(s => s.key === 'xbrl');
  const figureChecks = ((xbrl && xbrl.allItems) || []).slice(-6).reverse().map(f => {
    const m = (f.title || '').match(/\$([\d.]+)B/);
    const fig = m ? m[1] : null;
    const figRe = fig ? new RegExp('\\b' + fig.replace(/\./g, '\\.') + '(?!\\d)') : null;
    const withHit = figRe ? pressItems.map(it => { const hay = (it.title || '') + ' ' + (it.context || ''); const hm = hay.match(figRe); return hm ? { ...it, excerpt: hay.slice(Math.max(0, hm.index - 60), hm.index + hm[0].length + 80).trim() } : null; }).filter(Boolean) : [];
    return { claim: `${f.title} (filed to the SEC, XBRL)`, basis: 'SEC XBRL company facts', figure: fig,
      status: withHit.length ? 'cited-in-press' : 'no-press-citation-in-run',
      passages: withHit.slice(0, 5).map(it => ({ title: it.title, link: it.link || '', date: (it.date || '').slice(0, 10), source: it.source, excerpt: it.excerpt })) };
  });
  // Headline checks: company statements -> coverage with echo/separate wording.
  const headlineChecks = nrItems.slice(0, 6).map(h => {
    const ht = new Set(tokens(h.title || ''));
    const GEN = new Set(['store','available','launch','launches','unveils','announces','worldwide','today','apple','reportedly','update','updates','week','price','prices']);const cov = pressItems.filter(it => { const st = new Set(tokens((it.title || '') + ' ' + (it.context || ''))); const shared = [...ht].filter(w => st.has(w) && w.length > 3 && !GEN.has(w)); return shared.length >= 2 && shared.some(w => w.length >= 5 || /\d/.test(w)); });
    const seen = new Set();
    const passages = cov.map(it => ({ ...it, echo: jac(it.title, h.title) > 0.55 })).filter(it => { const k = it.title; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    const separate = passages.filter(p => !p.echo);
    return { claim: h.title, basis: 'Apple Newsroom (company statement)', date: (h.date || '').slice(0, 10), link: h.link || '',
      outlets: [...new Set(passages.map(p => p.source))],
      status: !passages.length ? 'no-outside-coverage-in-run' : (separate.length ? 'separate-wording-coverage' : 'echoed-only'),
      passages: passages.map(p => ({ title: p.title, link: p.link || '', date: (p.date || '').slice(0, 10), source: p.source, excerpt: (p.context || '').slice(0, 180), wording: p.echo ? 'echo' : 'separate' })) };
  });
  return { figureChecks, headlineChecks, method: 'Extractive matching over titles and feed summaries collected in this run: identical figures (word-boundary matched), and shared distinctive terms for coverage. Full article bodies are not fetched. "Echo" = near-identical wording (same origin likely); "separate" = distinct wording only, not independent verification. "Not found in collected items" means exactly that - it is not evidence that coverage or a citation does not exist.' };
}
async function runReport() {
  const runAt = new Date().toISOString();
  const settled = await Promise.allSettled(SOURCES.map(s => collect(s.key)));
  const sources = settled.map((r, i) => {
    const d = r.status === 'fulfilled' ? r.value : { mode: 'unavailable', source: SOURCES[i].label, name: SOURCES[i].name, fetchedAt: runAt, detail: String(r.reason), items: [] };
    for (const it of d.items) it.relevance = relevanceNote(SOURCES[i].key, it);
    const relevant = d.items.filter(it => isRelevant(SOURCES[i].key, itemTitle(it) + ' ' + (it.outlet || '') + ' ' + (it.context || '') + ' ' + (it.matched || '')));
    return { key: SOURCES[i].key, name: d.name, source: d.source, mode: d.mode, fetchedAt: d.fetchedAt, cached: !!d.cached, itemCount: d.items.length, relevantCount: relevant.length, items: d.items.slice(0, 3), allItems: d.items, relevantItems: relevant, detail: d.detail };
  });
  const report = {
    company: 'Apple Inc. (AAPL)', generatedAt: runAt,
    liveCount: sources.filter(s => s.mode === 'live').length, downCount: sources.filter(s => s.mode !== 'live').length,
    relevantTotal: sources.reduce((n, s) => n + (s.relevantCount || 0), 0),
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
  report.persistence = { runs: store.runs.length, uniqueItems: Object.keys(store.items).length, newThisRun: newItems, seenBeforeThisRun: seenBefore, storage: 'on-disk JSON within this deployment', resetsOn: 'redeploy or container replacement' };
  return report;
}

createServer(async (req, res) => {
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
}).listen(PORT, () => console.log(`company-evidence-index listening on :${PORT}`));
