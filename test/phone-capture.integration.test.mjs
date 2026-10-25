// Server-level integration test for POST /api/packs/phone-capture. Guards the
// TDZ regression (helper was declared below its first use -> every request
// 500d) and the fail-closed admin gate. No hardware, no secrets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT_C = 3995, PORT_D = 3996;
const BASE_C = 'http://127.0.0.1:' + PORT_C, BASE_D = 'http://127.0.0.1:' + PORT_D;
const children = [], dirs = [];
after(() => { for (const c of children) c.kill(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function boot(port, env) {
  const dir = mkdtempSync(join(tmpdir(), 'cei-pc-itest-'));
  writeFileSync(join(dir, 'run-store.json'), JSON.stringify({ runs: [], items: {}, packs: {}, analysis: {}, signals: {} }));
  dirs.push(dir);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATA_DIR: dir, ...env },
    stdio: 'ignore',
  });
  children.push(child);
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not start on ' + base);
}

test('phone-capture: 403 without token (not 500), 503 when gate off', async () => {
  await boot(PORT_C, { PACK_ADMIN_TOKEN: 'itest-token' });
  const noTok = await fetch(BASE_C + '/api/packs/phone-capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ticker":"TEST"}' });
  assert.equal(noTok.status, 403, 'unauthenticated request must be 403, never 500');
  const badTok = await fetch(BASE_C + '/api/packs/phone-capture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'wrong' }, body: '{"ticker":"TEST"}' });
  assert.equal(badTok.status, 403);
  const off = await fetch(BASE_C + '/api/packs/phone-capture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'itest-token' }, body: '{"ticker":"TEST"}' });
  assert.equal(off.status, 503);
  const j = await off.json();
  assert.equal(j.error, 'phone_capture_off');
});

test('phone-capture: fails closed when PACK_ADMIN_TOKEN unset', async () => {
  await boot(PORT_D, { PACK_ADMIN_TOKEN: '' });
  const r = await fetch(BASE_D + '/api/packs/phone-capture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'anything' }, body: '{"ticker":"TEST"}' });
  assert.equal(r.status, 403);
});
