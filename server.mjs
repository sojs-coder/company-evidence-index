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

  if (p === `/api/companies/${COMPANY}/refresh` || p.startsWith('/api/admin/ingest/')) {
    return send(res, 503, { error: 'admin_gate_not_provisioned', detail: 'Mutations are gated behind a one-time-code admin session (spec §2). No OTP provider or broker is provisioned for this demo, so this route is intentionally unavailable - no fake gate.' });
  }
  return send(res, 404, { error: 'not_found', detail: `${p} is not part of the demo API surface (spec §8).` });
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
