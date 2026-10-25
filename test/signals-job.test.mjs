// Signals job parallel executor integration test: real server process, fake
// OpenAI provider. Proves windowed concurrency with out-of-order completions
// keeps chunk order, and that a failed window (a) ledgers every paid success
// anyway, (b) checkpoints only a contiguous prefix, and (c) resumes to done.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const TOKEN = 'sig-token';
const PORT = 3983, PORT_OPENAI = 3984;
const BASE = 'http://127.0.0.1:' + PORT;

// 130 short posts -> 130 chunks -> 4 batches (40/40/40/10), one window (LANES=8).
const items = [];
for (let i = 0; i < 130; i++) items.push({ text: 'Post ' + i + ' says the product works well for team ' + (i % 7) + '.', link: 'https://x.com/t/' + i, date: '2026-10-2' + (i % 9) });
const seedStore = () => ({
  runs: [], items: {}, analysis: {}, questions: {}, signalJobs: {},
  openaiSpend: { confirmedUsd: 0, runs: [] },
  packs: { TEST: { company: 'Test Co', ticker: 'TEST', terms: ['test'], collectedAt: '2026-10-25T00:00:00Z', itemCount: 130, estUsd: 0, sources: [], items } },
  signals: {},
});

let failBatch1 = false; // when true, the batch at chunk offset 40 gets repeated 500s
const provider = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const j = JSON.parse(body);
    const first = /ITEMS:\n(\d+)\. /.exec(j.messages[0].content);
    const batchOff = (first ? +first[1] : 1) - 1;
    if (failBatch1 && batchOff === 40) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fake provider 500 for offset 40' } }));
      return;
    }
    const n = Math.min(40, 130 - batchOff);
    const signals = [];
    for (let k = 0; k < n; k++) signals.push({ n: batchOff + k + 1, sentiment: 'positive', aspects: ['quality'], claim: 'works for team ' + ((batchOff + k) % 7) });
    // Out-of-order completions: later batches answer first.
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ signals }) } }], usage: { prompt_tokens: 500, completion_tokens: 50 } }));
    }, Math.max(1, 60 - batchOff));
  });
});

let child, dir;
const storePath = () => join(dir, 'run-store.json');
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(b) }).then(r => r.json());
const waitJob = async (want) => {
  for (let i = 0; i < 900; i++) {
    let store;
    try { store = JSON.parse(readFileSync(storePath(), 'utf8')); } catch { store = null; }
    const j = store && (store.signalJobs || {}).TEST;
    if (j && j.status === want) return { store, job: j };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('job never reached ' + want);
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cei-sigjob-'));
  writeFileSync(storePath(), JSON.stringify(seedStore()));
  await new Promise(r => provider.listen(PORT_OPENAI, '127.0.0.1', r));
  child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATA_DIR: dir, PACK_ADMIN_TOKEN: TOKEN, OPENAI_API_KEY: 'sk-sig-fake', CEI_OPENAI_BASE: 'http://127.0.0.1:' + PORT_OPENAI },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not boot');
});
after(() => { child && child.kill(); provider.close(); dir && rmSync(dir, { recursive: true, force: true }); });

test('parallel window: failed lane ledgers paid successes, checkpoints a clean prefix, resumes to done', async () => {
  failBatch1 = true;
  const r1 = await post('/api/analysis/signals/run', { ticker: 'TEST', force: true });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const { store, job } = await waitJob('failed');
  assert.ok(job.error.includes('openai_http_500'), 'error carries status: ' + job.error);
  assert.ok(job.error.includes('fake provider 500'), 'error carries provider body: ' + job.error);
  // Paid usage exact: offsets 0, 80, 120 succeeded (3 paid calls) despite the failed window.
  assert.equal(store.openaiSpend.runs.length, 3, 'ledgered paid successes: ' + JSON.stringify(store.openaiSpend.runs));
  assert.equal(store.openaiSpend.confirmedUsd, +(3 * (500 * 0.10 / 1e6 + 50 * 0.50 / 1e6)).toFixed(6));
  // Checkpoint is the contiguous prefix: only offset 0's 40 readings.
  assert.equal(job.done, 40);
  assert.equal((job.partialSignals || []).length, 40);
  assert.ok(!store.signals || !store.signals.TEST, 'no rollup on failed job');

  // Resume with a healthy provider: same input hash, re-runs offsets 40/80/120.
  failBatch1 = false;
  const r2 = await post('/api/analysis/signals/run', { ticker: 'TEST', force: true });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const { store: s2, job: j2 } = await waitJob('done');
  assert.equal(j2.done, 130);
  assert.ok(s2.signals.TEST, 'rollup exists');
  assert.equal(s2.signals.TEST.coverage.attempted, 130);
  assert.equal(s2.signals.TEST.coverage.successful, 130);
  assert.equal(s2.signals.TEST.coverage.missing, 0);
  // Out-of-order completions still reconcile to one reading per post, in order.
  const perPost = s2.signals.TEST.perPost;
  assert.equal(perPost.length, 130);
  assert.equal(perPost[5].c, 'works for team 5');
  assert.equal(perPost[85].c, 'works for team ' + (85 % 7));
  // Money ledger counts every paid call across both runs (3 + 3).
  assert.equal(s2.openaiSpend.runs.length, 6);
});
