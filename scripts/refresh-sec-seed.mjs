// Regenerates data/public-companies-seed.json from the SEC public-listing
// registry (company_tickers_exchange.json: name, ticker, exchange incl.
// NYSE/Nasdaq, CIK). Run manually or on a schedule, commit the result.
// Requires a project-identifying User-Agent per SEC fair-access policy.
const r = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', {
  headers: { 'user-agent': 'company-evidence-index/1.0 (student hackathon research project)', accept: 'application/json' }
});
if (!r.ok) { console.error('SEC fetch failed: HTTP ' + r.status); process.exit(1); }
const j = await r.json();
const ix = Object.fromEntries(j.fields.map((f, i) => [f, i]));
const rows = j.data.map(d => ({ name: d[ix.name], ticker: d[ix.ticker], exchange: d[ix.exchange], cik: d[ix.cik] }));
const out = { snapshot: new Date().toISOString().slice(0, 10), source: 'https://www.sec.gov/files/company_tickers_exchange.json', count: rows.length, companies: rows };
const { writeFile } = await import('node:fs/promises');
await writeFile(new URL('../data/public-companies-seed.json', import.meta.url), JSON.stringify(out));
console.log('seed written:', rows.length, 'companies,', rows.filter(x => x.exchange === 'NYSE').length, 'NYSE');
