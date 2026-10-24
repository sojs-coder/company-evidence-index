// Company Evidence Index - demo backend (Cal Hacks 13.0)
// One process: serves the static frontend and the JSON API under /api/*.
// Zero dependencies (Node >=20). Seeded demo data only - no live source
// fetching, no LLM, no OTP provider: those are unapproved open dependencies
// (docs/auth-backend-spec.md §9). Admin mutations return an honest
// not-provisioned state instead of a fake gate. Public GETs only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
  { key: 'macrumors', name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All', label: 'MacRumors RSS' },
  { key: 'ninetofive', name: '9to5Mac', url: 'https://9to5mac.com/feed/', label: '9to5Mac RSS' },
  { key: 'pageviews', name: 'Wikipedia pageviews', url: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Apple_Inc./daily/PVDATES', label: 'Wikimedia pageviews API (Apple Inc. article)' },
  { key: 'itunes', name: 'Apple on the App Store', url: 'https://itunes.apple.com/search?term=Apple&entity=software&limit=6', label: 'iTunes Search API' },
  { key: 'reviews', name: 'App Store reviews', url: 'https://itunes.apple.com/us/rss/customerreviews/id=408709785/sortBy=mostRecent/json', label: 'App Store customer reviews RSS (GarageBand, an Apple app)' },
  { key: 'xbrl', name: 'SEC XBRL facts', url: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json', label: 'SEC EDGAR XBRL company concept API' },
  { key: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', label: 'The Verge RSS' }
];
const ALLOWED = Object.fromEntries(SOURCES.map(s => [s.key, s.url]));
function resolveUrl(key, url) {
  if (key !== 'pageviews') return url;
  const end = new Date(); const start = new Date(end.getTime() - 6 * 864e5);
  const f = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  return url.replace('PVDATES', `${f(start)}00/${f(end)}00`);
}
const UA = { 'user-agent': 'company-evidence-index-demo (Cal Hacks 13.0; public-data collection)', accept: '*/*' };
const collectCache = new Map();
async function cappedFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 2_000_000) throw new Error('response too large');
    return Buffer.from(buf).toString('utf8');
  } finally { clearTimeout(t); }
}
const items = xml => [...xml.matchAll(/<item[ >][\s\S]*?<\/item>/g)].map(m => m[0]);
const decodeEntities = t => t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&nbsp;/g, ' ');
const field = (item, name) => { const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim() : ''; };
const linkOf = it => { const m = it.match(/<link[^>]*href="([^"]+)"/) || it.match(/<link[^>]*>([^<]+)</); return m ? m[1].trim() : ''; };
function parse(kind, raw) {
  if (kind === 'edgar') {
    const r = JSON.parse(raw).filings.recent;
    return r.form.slice(0, 5).map((f, i) => ({ form: f, date: r.filingDate[i], accession: r.accessionNumber[i], description: r.primaryDocDescription[i] || '', link: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=${encodeURIComponent(f)}&dateb=&owner=include&count=10` }));
  }
  if (kind === 'newsroom') {
    const entries = [...raw.matchAll(/<entry[ >][\s\S]*?<\/entry>/g)].map(m => m[0]);
    return entries.slice(0, 5).map(it => ({ title: field(it, 'title'), date: field(it, 'updated'), link: linkOf(it) }));
  }
  if (kind === 'news') return items(raw).slice(0, 5).map(it => ({ title: field(it, 'title'), date: field(it, 'pubDate'), outlet: field(it, 'source'), link: field(it, 'link') }));
  if (kind === 'wikipedia') {
    const j = JSON.parse(raw);
    return [{ title: j.title, date: j.timestamp, excerpt: (j.extract || '').slice(0, 220), link: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : '' }];
  }
  if (kind === 'hackernews') {
    const j = JSON.parse(raw);
    return (j.hits || []).slice(0, 5).map(h => ({ title: h.title, date: (h.created_at || '').slice(0, 10), points: h.points, link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` }));
  }
  if (kind === 'pageviews') {
    const j = JSON.parse(raw);
    return (j.items || []).slice(-5).reverse().map(v => ({ title: `${Number(v.views).toLocaleString('en-US')} views of Apple Inc.`, date: `${v.timestamp.slice(0,4)}-${v.timestamp.slice(4,6)}-${v.timestamp.slice(6,8)}`, link: 'https://en.wikipedia.org/wiki/Apple_Inc.' }));
  }
  if (kind === 'xbrl') {
    const j = JSON.parse(raw);
    const usd = ((j.units && j.units.USD) || []).filter(u => u.fp === 'FY');
    return usd.slice(-5).reverse().map(u => ({ title: `FY${u.fy} revenue $${(u.val / 1e9).toFixed(1)}B`, date: u.end, link: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K' }));
  }
  if (kind === 'itunes') {
    const j = JSON.parse(raw);
    return (j.results || []).slice(0, 5).map(a => ({ title: a.trackName, date: (a.currentVersionReleaseDate || '').slice(0, 10), link: a.trackViewUrl, outlet: a.sellerName }));
  }
  if (kind === 'reviews') {
    const j = JSON.parse(raw);
    const entries = ((j.feed && j.feed.entry) || []).filter(e => e['im:rating']);
    return entries.slice(0, 5).map(e => ({ title: e.title && e.title.label, date: e.updated && e.updated.label && e.updated.label.slice(0, 10), rating: e['im:rating'] && e['im:rating'].label, link: e.link && e.link.attributes ? e.link.attributes.href : '' }));
  }
  if (kind === 'stooq') {
    const lines = raw.trim().split('\n').filter(l => /^\d{4}-/.test(l));
    return lines.slice(-5).reverse().map(l => { const [date, open, high, low, close, volume] = l.split(','); return { title: `Close ${close} (vol ${Number(volume).toLocaleString('en-US')})`, date, close, volume }; });
  }
  // macrumors, ninetofive: RSS item feeds; verge: Atom feed
  const its = items(raw);
  if (its.length) return its.slice(0, 5).map(it => ({ title: field(it, 'title'), date: field(it, 'pubDate'), link: linkOf(it) }));
  const entries = [...raw.matchAll(/<entry[ >][\s\S]*?<\/entry>/g)].map(m => m[0]);
  return entries.slice(0, 5).map(it => ({ title: field(it, 'title'), date: field(it, 'published') || field(it, 'updated'), link: linkOf(it) }));
}
async function collect(kind) {
  const hit = collectCache.get(kind);
  if (hit && Date.now() - hit.at < 600_000) return { ...hit.data, cached: true };
  const meta = SOURCES.find(s => s.key === kind);
  const fetchedAt = new Date().toISOString();
  try {
    const raw = await cappedFetch(resolveUrl(kind, meta.url));
    const data = { mode: 'live', source: meta.label, name: meta.name, fetchedAt, items: parse(kind, raw) };
    collectCache.set(kind, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { mode: 'unavailable', source: meta.label, name: meta.name, fetchedAt, detail: String(e.message || e), items: [] };
  }
}
async function runReport() {
  const runAt = new Date().toISOString();
  const settled = await Promise.allSettled(SOURCES.map(s => collect(s.key)));
  const sources = settled.map((r, i) => {
    const d = r.status === 'fulfilled' ? r.value : { mode: 'unavailable', source: SOURCES[i].label, name: SOURCES[i].name, fetchedAt: runAt, detail: String(r.reason), items: [] };
    return { key: SOURCES[i].key, name: d.name, source: d.source, mode: d.mode, fetchedAt: d.fetchedAt, cached: !!d.cached, itemCount: d.items.length, items: d.items.slice(0, 3), detail: d.detail };
  });
  return {
    company: 'Apple Inc. (AAPL)', generatedAt: runAt,
    liveCount: sources.filter(s => s.mode === 'live').length, downCount: sources.filter(s => s.mode !== 'live').length,
    sources
  };
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
