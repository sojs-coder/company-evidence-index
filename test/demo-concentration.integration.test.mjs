// Integration: company gate (403 for unbacked names, fail-closed without
// admin token env) and X-posts coverage wiring from the real pack store.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3997, BASE = 'http://127.0.0.1:' + PORT;
let dir, child;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cei-demo-itest-'));
  // Mini pack mirroring the real shape: src distinguishes fresh Apify X from
  // the Signalor archive; platform + per-item dates drive the derived wording.
  writeFileSync(join(dir, 'run-store.json'), JSON.stringify({ runs: [], items: {}, analysis: {}, signals: {}, appleReport: { at: '2026-10-25T12:00:00Z', report: { marker: 'stored-run', findings: [] } }, packs: {
    AAPL: { company: 'APPLE INC', ticker: 'AAPL', terms: [], collectedAt: '2026-10-25T08:17:59Z', itemCount: 3, estUsd: 0,
      sources: [{ source: 'signalor-historical-export', at: '2026-10-25T08:13:37Z', collected: 2, added: 2 }, { source: 'apify-x', at: '2026-10-25T08:17:59Z', collected: 1, added: 1 }],
      items: [
        { src: 'signalor-historical-export', platform: 'reddit', date: '2026-10-19 10:00:00', link: 'https://reddit.com/r/apple/1', text: 'reddit post' },
        { src: 'signalor-historical-export', platform: 'youtube', date: '2026-10-20 09:42:59', link: 'https://youtube.com/watch?v=1', text: 'yt post' },
        { src: 'apify-x', link: 'https://x.com/a/1', date: 'Sun Oct 25 08:13:20 +0000 2026', text: 'x post' }
      ] }
  } }));
  child = spawn(process.execPath, ['server.mjs'], { cwd: join(import.meta.dirname, '..'), env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATA_DIR: dir, PACK_ADMIN_TOKEN: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not start');
});
after(() => { child && child.kill(); dir && rmSync(dir, { recursive: true, force: true }); });

test('unbacked company is 403 on identify and report (no token configured = fail closed)', async () => {
  const r1 = await fetch(BASE + '/api/vet/identify?name=Honeybee%20Robotics');
  assert.equal(r1.status, 403);
  assert.equal((await r1.json()).error, 'company_not_in_demo_set');
  const r2 = await fetch(BASE + '/api/vet/report?name=Caterpillar&identityName=CATERPILLAR%20INC');
  assert.equal(r2.status, 403);
});

test('coverage wires X public posts from the real pack; employee posts stay a gap', async () => {
  const r = await fetch(BASE + '/api/companies/apple/coverage');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.xPostsLive, true);
  const x = j.sources.find(s => s.name === 'X public posts');
  assert.equal(x.state, 'checked');
  assert.equal(x.live, true);
  // Derived, not hardcoded: counts/dates come from the seeded pack above.
  assert.match(x.detail, /1 X posts collected 2026-10-25 \(fresh Apify X collection\)/);
  assert.match(x.detail, /catalog holds 3 public posts/);
  assert.match(x.detail, /Signalor mention archive through 2026-10-20 spans reddit 1, youtube 1/);
  const emp = j.sources.find(s => s.name === 'Employee posts');
  assert.equal(emp.state, 'gap', 'employee attribution stays unverified');
  const other = j.sources.find(s => s.name === 'SEC EDGAR filings');
  assert.equal(other.state, 'checked', 'seed entries otherwise untouched');
});

test('report gates identityName, not just name: allowlisted name + arbitrary identity is 403', async () => {
  // Every live/paid lookup in buildVetReport keys off identity.name; gating only
  // the name param left a full bypass (review blocker 1).
  const qs = 'name=Apple&question=q&category=general&identityKind=custom&identityName=CATERPILLAR%20INC';
  const r = await fetch(BASE + '/api/vet/report?' + qs);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'company_not_in_demo_set');
});

test('public refresh=1 is refused (no anonymous paid re-runs); cached replay stays public', async () => {
  const qs = 'name=Apple&question=q&category=general&identityKind=custom&identityName=Apple&refresh=1';
  const r = await fetch(BASE + '/api/vet/report?' + qs);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'refresh_requires_admin');
});

test('covered-company identify is free and local; report misses are admin-only; cached replay stays public', async () => {
  // The primary public flow (Find the company) must work with zero paid
  // calls: covered companies resolve from the bundled SEC seed.
  const idR = await fetch(BASE + '/api/vet/identify?name=Apple');
  assert.equal(idR.status, 200);
  const idJ = await idR.json();
  assert.equal(idJ.identities[0].ticker, 'AAPL');
  assert.equal(idJ.sources[0].mode, 'local');
  assert.equal(idJ.sources[0].creditsCounted, 0);
  const repR = await fetch(BASE + '/api/vet/report?name=Apple&question=q&category=general&identityKind=custom&identityName=Apple');
  assert.equal(repR.status, 403);
  assert.equal((await repR.json()).error, 'fresh_requires_admin');
  // Admin token path stays open (spawned env has PACK_ADMIN_TOKEN empty =
  // fail-closed, so a token call also 403s here - the gate semantics are
  // covered by the refresh test above and the allowlist tests).
});

test('apple report serves the stored run cache-first (no fresh collect on load)', async () => {
  const r = await fetch(BASE + '/api/companies/apple/report');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.cached, true);
  assert.equal(j.marker, 'stored-run');
  assert.equal(j.generatedAt, '2026-10-25T12:00:00Z');
});
