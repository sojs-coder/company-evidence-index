import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../navigation.js', import.meta.url), 'utf8');
const pages = [
  ['index.html', '/', 'Vet'],
  ['companies.html', '/companies.html', 'Apple demo'],
  ['collection.html', '/collection.html', 'Collection'],
  ['packs.html', '/packs.html', 'Mentions'],
  ['results.html', '/results.html', 'Results'],
  ['report.html', '/report.html', 'Apple example'],
  ['supplier.html', '/supplier.html', 'Supplier example']
];

// Exercise the browser script without adding a DOM dependency to this static app.
function render(pathname, storage = new Map(), blockedStorage = false, dataset = {}) {
  const handlers = [];
  const attributes = {};
  const button = {
    setAttribute: (key, value) => { attributes[key] = value; },
    addEventListener: (event, fn) => { if (event === 'click') handlers.push(fn); }
  };
  const header = {
    innerHTML: '',
    querySelector: selector => selector === '.theme-toggle' ? button : { scrollIntoView() {} }
  };
  const meta = {};
  const document = {
    documentElement: { dataset: { ...dataset } },
    querySelector: selector => selector === '.topbar' ? header : meta
  };
  runInNewContext(source, {
    document,
    location: { pathname },
    localStorage: {
      getItem(key) {
        if (blockedStorage) throw new Error('Storage blocked');
        return storage.get(key);
      },
      setItem(key, value) {
        if (blockedStorage) throw new Error('Storage blocked');
        storage.set(key, value);
      }
    }
  });
  return { html: header.innerHTML, document, meta, attributes, handlers };
}

for (const [file, path, label] of pages) {
  test(`${file} uses the shared shell with the same links and correct active page`, async () => {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /<header class="topbar"><\/header>\s*<script src="\/navigation\.js\?v=1"><\/script>/);
    assert.equal((html.match(/src="\/role\.js/g) || []).length, 1);
    assert.doesNotMatch(html, /class="main-nav"/, 'Do not reintroduce a page-specific menu');
    const rendered = render(path).html;
    const links = [...rendered.matchAll(/<a class="nav-link[^"]*" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    assert.deepEqual(links.map(m => [m[1], m[2]]), pages.map(p => [p[1], p[2]]));
    assert.equal((rendered.match(/aria-current="page"/g) || []).length, 1);
    assert.ok(rendered.includes(`class="nav-link active" href="${path}" aria-current="page">${label}</a>`));
    assert.match(rendered, />Public sources<\/span>/);
  });
}

test('/index.html is an alias for the Vet tab; queries do not affect pathname matching', () => {
  assert.equal(render('/index.html').html, render('/').html);
});

test('theme toggles once and persists across every page', () => {
  const storage = new Map();
  for (const [, path] of pages) {
    const first = render(path, storage);
    assert.equal(first.handlers.length, 1);
    assert.equal(first.document.documentElement.dataset.theme, 'light');
    first.handlers[0]();
    assert.equal(first.document.documentElement.dataset.theme, 'dark');
    assert.equal(first.attributes['aria-pressed'], 'true');
    assert.equal(first.meta.content, '#02205e');
    assert.equal(storage.get('cei-theme'), 'dark');
    const next = render(path, storage);
    assert.equal(next.document.documentElement.dataset.theme, 'dark');
    next.handlers[0]();
    assert.equal(next.document.documentElement.dataset.theme, 'light');
    assert.equal(next.attributes['aria-pressed'], 'false');
    assert.equal(next.meta.content, '#f5f4f4');
  }
});

test('navigation and theme work when browser storage is unavailable', () => {
  const page = render('/companies.html', new Map(), true);
  assert.match(page.html, /aria-current="page">Apple demo/);
  page.handlers[0]();
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
});

test('page theme defaults and browser colors respect an explicit saved preference', () => {
  const dataset = { defaultTheme: 'dark', darkColor: '#181714', lightColor: '#f1ede4' };
  const page = render('/packs.html', new Map(), false, dataset);
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.meta.content, '#181714');
  page.handlers[0]();
  assert.equal(page.meta.content, '#f1ede4');
  const saved = render('/packs.html', new Map([['cei-theme', 'light']]), false, dataset);
  assert.equal(saved.document.documentElement.dataset.theme, 'light');
  const blocked = render('/packs.html', new Map(), true, dataset);
  assert.equal(blocked.document.documentElement.dataset.theme, 'dark');
});

test('page scripts cannot register a second theme handler', async () => {
  for (const file of ['vet.js', 'app.js', 'collection.js', 'packs.js', 'results.js', 'report.js', 'supplier.js']) {
    const script = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(script, /theme-toggle|cei-theme/, file);
  }
});

test('page-specific counts remain in the content, outside the shared header', async () => {
  for (const [file, id] of [['collection.html', 'collect-count'], ['packs.html', 'packs-count']]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<main[^>]*>[\\s\\S]*id="${id}"`));
  }
});
