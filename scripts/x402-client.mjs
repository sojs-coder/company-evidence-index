// Minimal x402 TESTNET paid-API client for the /api/paid/* namespace.
// Pays with the vaulted testnet wallet (Base Sepolia, test USDC - no real
// funds). Usage:
//   X402_TESTNET_PRIVATE_KEY=0x... node scripts/x402-client.mjs identify "Caterpillar"
//   X402_TESTNET_PRIVATE_KEY=0x... node scripts/x402-client.mjs report "Caterpillar" "What has the DoD awarded it?" "CATERPILLAR INC" usaspending_recipient
// The key is read from the environment only; never logged.
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { toClientEvmSigner, ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.X402_PAID_BASE || 'https://company-evidence-index-production.up.railway.app';
const NETWORK = process.env.X402_NETWORK || 'eip155:84532';

async function paidFetch(http, url) {
  // Round 1: expect 402 + payment requirements.
  const r1 = await fetch(url);
  if (r1.status !== 402) {
    const t = await r1.text();
    return { status: r1.status, body: t.slice(0, 400), paid: false };
  }
  const paymentRequired = http.getPaymentRequiredResponse((n) => r1.headers.get(n), await r1.clone().json().catch(() => undefined));
  // Round 2: create + attach the payment payload.
  const payload = await http.createPaymentPayload(paymentRequired);
  const headers = http.encodePaymentSignatureHeader(payload);
  const r2 = await fetch(url, { headers });
  const settle = http.getPaymentSettleResponse((n) => r2.headers.get(n));
  const body = await r2.text();
  return { status: r2.status, paid: r2.ok, settlement: settle || null, body: body.slice(0, 600) };
}

async function main() {
  const pk = (process.env.X402_TESTNET_PRIVATE_KEY || '').trim();
  if (!pk) { console.error('X402_TESTNET_PRIVATE_KEY is required (testnet wallet, never logged).'); process.exit(2); }
  const account = privateKeyToAccount(pk);
  const client = new x402Client();
  client.register(NETWORK, new ExactEvmScheme(toClientEvmSigner(account)));
  const http = new x402HTTPClient(client);
  const [cmd, name, question, identityName, identityKind] = process.argv.slice(2);
  let url;
  if (cmd === 'identify') url = `${BASE}/api/paid/vet/identify?name=${encodeURIComponent(name || '')}`;
  else if (cmd === 'report') url = `${BASE}/api/paid/vet/report?name=${encodeURIComponent(name || '')}&question=${encodeURIComponent(question || '')}&identityName=${encodeURIComponent(identityName || '')}&identityKind=${encodeURIComponent(identityKind || 'custom')}`;
  else { console.error('usage: identify <name> | report <name> <question> <identityName> [identityKind]'); process.exit(2); }
  const out = await paidFetch(http, url);
  console.log(JSON.stringify(out, null, 2));
  if (!out.paid) process.exit(1);
}
main().catch(e => { console.error('client failed:', e && e.message || e); process.exit(1); });
