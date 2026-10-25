import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneCaptureStatus, captureScreens, extractPosts, McpHttpClient, openAiVisionExtractor } from '../phone-capture.mjs';

// NOTE: these tests exercise the contract with in-memory stand-ins for the
// gateway. Nothing here is collected data and nothing is ever ingested.
const ON = { PHONEUSE_ENABLED: 'true', PHONEUSE_MCP_URL: 'https://gw.example/mcp', PHONEUSE_API_KEY: 'pu_x', PHONEUSE_TRACE_CONSENT: 'true' };

test('off by default and fails closed with zero network calls', async () => {
  let called = false;
  const client = { callTool: async () => { called = true; } };
  assert.equal(phoneCaptureStatus({}).state, 'disabled');
  assert.equal(phoneCaptureStatus({ PHONEUSE_ENABLED: 'true' }).state, 'not_configured');
  assert.equal(phoneCaptureStatus({ ...ON, PHONEUSE_TRACE_CONSENT: '' }).state, 'consent_required');
  assert.equal(phoneCaptureStatus({ ...ON, PHONEUSE_MCP_URL: 'http://gw.example/mcp' }).state, 'not_configured');
  assert.equal(phoneCaptureStatus({ ...ON, PHONEUSE_MCP_URL: 'http://127.0.0.1:8787/mcp' }).enabled, true);
  const r = await captureScreens({ env: {}, client });
  assert.equal(r.ok, false); assert.equal(called, false);
});

test('no online rig -> no frames', async () => {
  const client = { callTool: async (n) => ({ isError: false, content: [{ type: 'text', text: JSON.stringify([{ id: 'rig_1', online: false }]) }] }) };
  const r = await captureScreens({ env: ON, client });
  assert.equal(r.error, 'no_rig_online'); assert.deepEqual(r.frames, []);
});

test('capture flow only scrolls and screenshots; never types/taps/asks', async () => {
  const calls = [];
  const img = Buffer.from('frame-bytes').toString('base64');
  const client = { callTool: async (n, a) => { calls.push(n); return n === 'rigs_list' ? { content: [{ type: 'text', text: JSON.stringify([{ id: 'rig_1', online: true, available: true }]) }] } : (n === 'phone_screenshot' || n === 'phone_scroll') ? { content: [{ type: 'image', data: img, mimeType: 'image/jpeg' }] } : { content: [{ type: 'text', text: 'ok' }] }; } };
  const r = await captureScreens({ env: ON, client, maxScrolls: 2 });
  assert.equal(r.ok, true); assert.equal(r.frames.length, 3);
  assert.equal(r.frames[0].sha256.length, 64);
  for (const n of calls) assert.ok(['rigs_list', 'phone_connect', 'phone_screenshot', 'phone_scroll', 'phone_task_done'].includes(n), n);
});

test('extraction requires a real extractor; items carry screenshot provenance', async () => {
  assert.equal((await extractPosts([{}], null)).error, 'extractor_required');
  const frame = { rigId: 'rig_1', capturedAt: 't', sha256: 'abc', mimeType: 'image/jpeg', data: '' };
  const r = await extractPosts([frame], async () => [{ text: 'read from screen', platform: 'x' }, { text: '  ' }]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].src, 'phone_capture');
  assert.equal(r.items[0].provenance.frameSha256, 'abc');
  const empty = await extractPosts([frame], async () => []);
  assert.equal(empty.items.length, 0);
});

test('MCP client parses SSE and JSON, maps auth failure, keeps session id', async () => {
  const mk = (status, body, ct, sid) => async () => ({ status, ok: status < 400, text: async () => body, headers: { get: h => ({ 'content-type': ct, 'mcp-session-id': sid })[h.toLowerCase()] } });
  const c = new McpHttpClient({ url: 'https://gw/mcp', apiKey: 'k', fetchImpl: mk(200, 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hi"}]}}\n\n', 'text/event-stream', 'S1') });
  const r = await c.callTool('rigs_list');
  assert.equal(r.content[0].text, 'hi'); assert.equal(c.sessionId, 'S1');
  const bad = new McpHttpClient({ url: 'https://gw/mcp', apiKey: 'k', fetchImpl: mk(401, '', 'text/plain') });
  await assert.rejects(() => bad.callTool('x'), /gateway_auth_failed/);
});

test('vision extractor sends image, returns posts, errors without key', async () => {
  let body;
  const ex = openAiVisionExtractor({ getKey: async () => 'k', fetchImpl: async (u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"posts":[{"text":"a"}]}' } }] }) }; } });
  const out = await ex({ mimeType: 'image/jpeg', data: 'AAAA' });
  assert.equal(out[0].text, 'a'); assert.ok(body.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
  await assert.rejects(() => openAiVisionExtractor({ getKey: async () => '' })({}), /no_key/);
});

test('retention writes a private file named by hash; items are marked unverified', async () => {
  const { mkdtemp, readdir, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(tmpdir() + '/pc-');
  const img = Buffer.from('x').toString('base64');
  const client = { callTool: async (n) => n === 'rigs_list' ? { content: [{ type: 'text', text: JSON.stringify([{ id: 'r', online: true, available: true }]) }] } : n === 'phone_screenshot' ? { content: [{ type: 'image', data: img }] } : { content: [{ type: 'text', text: 'ok' }] } };
  const r = await captureScreens({ env: { ...ON, PHONEUSE_RETAIN_DIR: dir }, client, maxScrolls: 0 });
  const files = await readdir(dir);
  assert.deepEqual(files, [r.frames[0].sha256 + '.jpg']);
  assert.equal((await stat(dir + '/' + files[0])).mode & 0o077, 0);
  const e = await extractPosts(r.frames, async () => [{ text: 't' }]);
  assert.equal(e.items[0].verified, false);
  assert.equal(e.items[0].provenance.retainedAs, files[0]);
});

test('scroll returning no image still captures via explicit screenshots', async () => {
  // Contract regression test: phone_scroll yields no image content; frames
  // must come from explicit phone_screenshot calls after each scroll.
  const img = { type: 'image', data: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' };
  const calls = [];
  const client = { callTool: async (name) => {
    calls.push(name);
    if (name === 'rigs_list') return { isError: false, content: [{ type: 'text', text: JSON.stringify([{ id: 'rig_1', online: true }]) }] };
    if (name === 'phone_scroll') return { isError: false, content: [{ type: 'text', text: 'scrolled' }] }; // NO image
    if (name === 'phone_screenshot') return { isError: false, content: [img] };
    return { isError: false, content: [] };
  } };
  const r = await captureScreens({ env: ON, client, maxScrolls: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.frames.length, 3); // first + one per scroll
  const shots = calls.filter(c => c === 'phone_screenshot').length;
  assert.equal(shots, 3);
});
