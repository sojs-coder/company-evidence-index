// Production demo is concentrated on the five companies with collected
// evidence packs (real Signalor/Apify data): Apple, Microsoft, Amazon,
// Alphabet, NVIDIA. Arbitrary companies cannot launch paid vet flows on the
// public route; the admin token bypasses for coordinated runs. The seeded
// illustrative Apple example (report.html) is a separate route, unaffected.
const ALLOWED = [
  { key: 'AAPL', names: ['apple', 'apple inc', 'apple inc.', 'aapl'] },
  { key: 'MSFT', names: ['microsoft', 'microsoft corp', 'microsoft corporation', 'msft'] },
  { key: 'AMZN', names: ['amazon', 'amazon.com', 'amazon com inc', 'amazon.com inc', 'amzn'] },
  { key: 'GOOGL', names: ['alphabet', 'alphabet inc', 'alphabet inc.', 'googl', 'goog', 'google'] },
  { key: 'NVDA', names: ['nvidia', 'nvidia corp', 'nvidia corporation', 'nvda'] },
];
export function allowedDemoCompany(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return null;
  for (const c of ALLOWED) if (c.names.some(a => n === a || n.startsWith(a + ' ') || n.startsWith(a + ','))) return c.key;
  return null;
}
export const DEMO_COMPANIES = ALLOWED.map(c => c.key);
