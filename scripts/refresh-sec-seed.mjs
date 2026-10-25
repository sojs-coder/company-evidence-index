// Regenerates data/public-companies-seed.json: the S&P 500 universe.
// Constituent list: Wikipedia "List of S&P 500 companies" constituents table
// (ticker/name/exchange/CIK, kept current by editors on index changes).
// Canonical company names/exchanges: SEC public-listing registry
// (company_tickers_exchange.json), joined by CIK from the previously
// committed SEC snapshot. SEC throttles datacenter IPs, so a live SEC fetch
// is NOT required; the join reuses the committed registry snapshot.
// Requires a project-identifying User-Agent per fair-access policies.
import { readFile, writeFile } from 'node:fs/promises';
const UA = 'company-evidence-index/1.0 (student hackathon research project)';
const SEED = new URL('../data/public-companies-seed.json', import.meta.url);

const r = await fetch('https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=wikitext&format=json&formatversion=2', { headers: { 'user-agent': UA } });
if (!r.ok) { console.error('Wikipedia fetch failed: HTTP ' + r.status); process.exit(1); }
const wt = (await r.json()).parse.wikitext;
let tbl = wt.slice(wt.indexOf('id="constituents"'));
tbl = tbl.slice(0, tbl.indexOf('|}'));
const old = JSON.parse(await readFile(SEED, 'utf8'));
const byCik = new Map(old.companies.map(c => [c.cik, c]));
const EXCH = { NyseSymbol: 'NYSE', NasdaqSymbol: 'Nasdaq', CboeSymbol: 'Cboe' };
const out = [];
for (const row of tbl.split('|-').slice(1)) {
  const m = row.match(/\{\{(NyseSymbol|NasdaqSymbol|CboeSymbol)\|([^}]+)\}\}/);
  const n = row.match(/\|\|\s*(?:\{\{[^}]+\}\}\s*\n\|\|)?\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  const c = row.match(/\b(\d{10})\b/);
  if (!(m && n && c)) continue;
  const cik = parseInt(c[1], 10);
  const sec = byCik.get(cik);
  out.push({ name: sec ? sec.name : (n[2] || n[1]).trim(), ticker: m[2].trim(), exchange: EXCH[m[1]], cik });
}
const today = new Date().toISOString().slice(0, 10);
const doc = { snapshot: today,
  source: `S&P 500 constituents, Wikipedia 'List of S&P 500 companies' constituents table (https://en.wikipedia.org/wiki/List_of_S%26P_500_companies, fetched ${today}), company names/exchanges from SEC public-listing registry snapshot ${old.snapshot}`,
  count: out.length, companies: out };
await writeFile(SEED, JSON.stringify(doc));
console.log('seed written:', out.length, 'S&P 500 constituents');
