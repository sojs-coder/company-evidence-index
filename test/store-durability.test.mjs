// Store durability guards (live incident 2026-10-25: a boot loaded an empty
// store over a possibly-intact volume; overlapping writers can diverge).
// Contracts under test:
//  1. Two processes booting over the SAME DATA_DIR: the wx lock makes exactly
//     one writable; the other boots READ-ONLY and every mutating route 503s
//     BEFORE any mutation or paid call. The winner's data survives intact.
//  2. A corrupt store file boots READ-ONLY, is preserved aside (never
//     overwritten), and mutating routes return 503 store_read_only - never
//     ok:true over divergent memory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'dur-token';
async function boot(port, dir) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATA_DIR: dir, PACK_ADMIN_TOKEN: TOKEN, OPENAI_API_KEY: '', CRS_SANDBOX_USERNAME: '', CRS_SANDBOX_PASSWORD: '', STORE_LOCK_RETRY_MS: '500' },
    stdio: 'ignore',
  });
  // Any HTTP status means the server is listening: a read-only + empty
  // replica intentionally reports health 503 (it must not receive traffic).
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); if (r.status) return child; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not start on ' + port);
}
const post = (port, path, body) => fetch('http://127.0.0.1:' + port + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(body || {}) });

let dirA, dirB, a, b, c;
before(async () => {
  dirA = mkdtempSync(join(tmpdir(), 'cei-dur-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'cei-dur-b-'));
  writeFileSync(join(dirB, 'run-store.json'), '{"packs": tru'); // corrupt JSON
  a = await boot(3991, dirA);
  b = await boot(3992, dirA); // SAME DATA_DIR as a: must lose the lock
  c = await boot(3993, dirB); // corrupt store: must boot read-only
});
after(() => { for (const k of [a, b, c]) k && k.kill(); dirA && rmSync(dirA, { recursive: true, force: true }); dirB && rmSync(dirB, { recursive: true, force: true }); });

test('second process over the same store boots READ-ONLY and cannot mutate', async () => {
  const r = await post(3992, '/api/packs/ingest', { ticker: 'TEST', name: 'T', items: [{ text: 'x', link: 'https://x.com/1' }] });
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.error, 'store_read_only');
});

test('lock holder mutates and persists; loser never overwrote the file', async () => {
  const r = await post(3991, '/api/packs/ingest', { ticker: 'TEST', name: 'T', items: [{ text: 'winner data', link: 'https://x.com/1' }] });
  assert.equal(r.status, 200);
  const onDisk = JSON.parse(readFileSync(join(dirA, 'run-store.json'), 'utf8'));
  assert.equal(onDisk.packs.TEST.items[0].text, 'winner data');
  const r2 = await post(3992, '/api/packs/ingest', { ticker: 'TEST', name: 'T', items: [{ text: 'loser data', link: 'https://x.com/2' }] });
  assert.equal(r2.status, 503);
  const onDisk2 = JSON.parse(readFileSync(join(dirA, 'run-store.json'), 'utf8'));
  assert.equal(onDisk2.packs.TEST.items.length, 1, 'loser never overwrote');
});

test('corrupt store boots READ-ONLY, preserves the file aside, never reports false success', async () => {
  assert.ok(readdirSync(dirB).some(f => f.startsWith('run-store.json.corrupt-')), 'corrupt file preserved aside');
  assert.ok(!existsSync(join(dirB, 'run-store.json')), 'corrupt original moved aside, not overwritten by an empty store');
  const r = await post(3993, '/api/packs/ingest', { ticker: 'TEST', name: 'T', items: [{ text: 'x', link: 'https://x.com/1' }] });
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.error, 'store_read_only');
  assert.equal(j.ok, undefined, 'no false success field');
});

// v4 deploy-handoff contracts (reviewer 2026-10-25):
//  4. SIGTERM/SIGINT releases the OWNED lock; the read-only handoff replica
//     retries acquisition on a bounded interval, and on ACQUIRE it RELOADS
//     the disk winner's truth before becoming writable.
//  5. Health exposes store mode/counts and goes non-200 while a replica is
//     read-only AND empty, so no traffic routes to an empty handoff store.
//  6. A failed persist (conflict) 503s, then memory is RELOADED from the
//     disk winner's truth before further public reads - never divergent
//     memory served as if current.

test('SIGTERM releases the lock; read-only replica takes over with disk truth', async (t) => {
  const dirC = mkdtempSync(join(tmpdir(), 'cei-dur-c-'));
  let p1 = await boot(3994, dirC);
  const p2 = await boot(3995, dirC); // SAME DATA_DIR: boots read-only (foreign lock)
  t.after(() => { p1 && p1.kill(); p2.kill(); rmSync(dirC, { recursive: true, force: true }); });
  const w = await post(3994, '/api/packs/ingest', { ticker: 'TEST', name: 'T', items: [{ text: 'winner data', link: 'https://x.com/1' }] });
  assert.equal(w.status, 200);
  const h2 = await fetch('http://127.0.0.1:3995/api/health');
  assert.equal(h2.status, 503, 'read-only + empty replica reports non-200 health');
  const hj = await h2.json();
  assert.equal(hj.store.mode, 'read-only');
  assert.equal(hj.store.reason, 'foreign-lock');
  assert.equal(hj.store.packs, 0);
  p1.kill('SIGTERM'); p1 = null;
  // Takeover within seconds (500ms retry in tests) PROVES the SIGTERM
  // release: without it the lock would be fresh-foreign until the 90s
  // staleness window expired.
  let mode = null, packs = 0;
  for (let i = 0; i < 60; i++) {
    const h = await fetch('http://127.0.0.1:3995/api/health');
    if (h.ok) { const j = await h.json(); mode = j.store.mode; packs = j.store.packs; if (mode === 'writable') break; }
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(mode, 'writable', 'replica acquired the lock after the SIGTERM release');
  assert.equal(packs, 1, 'reloaded the disk winner truth (1 pack) BEFORE becoming writable');
  const w2 = await post(3995, '/api/packs/ingest', { ticker: 'TEST', name: 'T', items: [{ text: 'second data', link: 'https://x.com/2' }] });
  assert.equal(w2.status, 200, 'takeover replica can persist');
  const onDisk = JSON.parse(readFileSync(join(dirC, 'run-store.json'), 'utf8'));
  assert.equal(onDisk.packs.TEST.items.length, 2, 'inherited winner item + new item both persisted');
});

test('failed persist (conflict) 503s, then serves the reloaded disk winner truth', async (t) => {
  const dirD = mkdtempSync(join(tmpdir(), 'cei-dur-d-'));
  const p3 = await boot(3996, dirD);
  t.after(() => { p3.kill(); rmSync(dirD, { recursive: true, force: true }); });
  const w = await post(3996, '/api/packs/ingest', { ticker: 'MEM', name: 'M', items: [{ text: 'memory data', link: 'https://x.com/1' }] });
  assert.equal(w.status, 200);
  await new Promise(r => setTimeout(r, 60)); // distinct mtime
  // An out-of-band winner rewrites the disk store (mtime changes).
  writeFileSync(join(dirD, 'run-store.json'), JSON.stringify({ runs: [], items: {}, packs: { DISK: { company: 'D', ticker: 'DISK', terms: [], collectedAt: '2026-10-25T00:00:00Z', itemCount: 1, estUsd: 0, sources: [], items: [{ text: 'disk winner', link: 'https://x.com/9' }] } } }));
  const r = await post(3996, '/api/packs/ingest', { ticker: 'MEM', name: 'M', items: [{ text: 'late data', link: 'https://x.com/2' }] });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'store_not_persisted');
  const packs = await (await fetch('http://127.0.0.1:3996/api/packs')).json();
  assert.deepEqual(packs.packs.map(p => p.ticker), ['DISK'], 'public reads serve reloaded disk truth, not divergent memory');
  const h = await fetch('http://127.0.0.1:3996/api/health');
  assert.equal(h.status, 200, 'read-only WITH data still serves reads');
  const hj = await h.json();
  assert.equal(hj.store.mode, 'read-only');
  assert.equal(hj.store.reason, 'conflict');
  assert.equal(hj.store.divergent, false);
  assert.equal(hj.store.packs, 1);
});
