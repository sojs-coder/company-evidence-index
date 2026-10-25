// Regression (live defect 2026-10-25, AAPL scout): a post whose text contains
// a lone surrogate made the answer call's JSON.stringify emit invalid JSON and
// the provider returned 400 invalid_json. The answer path must strip lone
// surrogates/control chars from picked post text before every provider call,
// and the stored cite text must be the stripped text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const TOKEN = 'surr-token';
const PORT = 3983, PORT_OPENAI = 3984;
const BASE = 'http://127.0.0.1:' + PORT;
const DIRTY = 'SurrCo zqx marine anchors hold well in cold water.\uD800';
const CLEAN = 'SurrCo zqx marine anchors hold well in cold water.';

const seedStore = () => ({
  runs: [], items: {}, analysis: {}, questions: {}, signalJobs: {},
  openaiSpend: { confirmedUsd: 0, runs: [] },
  packs: { SURR: { company: 'Surr Co', ticker: 'SURR', terms: ['surr'], collectedAt: '2026-10-25T00:00:00Z', itemCount: 1, estUsd: 0, sources: [], items: [
    { text: DIRTY, link: 'https://x.com/s/1', date: '2026-10-20' },
  ] } },
  signals: {},
});

let lastAnswerPrompt = '';
const hasLone = s => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
let dir, child, openai;
before(async () => {
  openai = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      let prompt = '';
      try { prompt = JSON.parse(b).messages[0].content; } catch {}
      if (/You verify whether cited public posts support findings/.test(prompt)) {
        const pairs = [];
        for (const m of prompt.matchAll(/\[F(\d+)-P(\d+)\]/g)) pairs.push({ f: +m[1], p: +m[2], supported: true });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pairs }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
        return;
      }
      lastAnswerPrompt = prompt;
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bottomLine: 'ok', findings: [{ text: 'Anchors hold in cold water.', stance: 'supports', posts: [1] }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => openai.listen(PORT_OPENAI, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'cei-surr-'));
  writeFileSync(join(dir, 'run-store.json'), JSON.stringify(seedStore()));
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATA_DIR: dir, PACK_ADMIN_TOKEN: TOKEN, OPENAI_API_KEY: 'sk-surr-fake', CEI_OPENAI_BASE: 'http://127.0.0.1:' + PORT_OPENAI },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not start');
});
after(() => { child && child.kill(); openai && openai.close(); dir && rmSync(dir, { recursive: true, force: true }); });

test('lone surrogates in post text are stripped before provider calls and from stored cites', async () => {
  const r = await fetch(BASE + '/api/analysis/answer/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify({ ticker: 'SURR', role: 'customer', q: 'How do zqx marine anchors hold in cold water?' }) });
  assert.equal(r.status, 200);
  assert.equal(hasLone(lastAnswerPrompt), false, 'answer prompt carries no lone surrogates');
  const g = await fetch(BASE + '/api/packs/SURR/answer?role=customer&q=' + encodeURIComponent('How do zqx marine anchors hold in cold water?'));
  assert.equal(g.status, 200);
  const rec = await g.json();
  assert.equal(rec.findings[0].cite[0].text, CLEAN);
});
