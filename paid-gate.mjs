// Isolated x402 paid API namespace (/api/paid/*). Additive: enabling or
// breaking this surface never gates or breaks the free demo routes.
// TESTNET ONLY: Base Sepolia eip155:84532 via the x402.org facilitator,
// prices per the owner exchange 2026-10-25 00:38-00:40 (identify $0.001,
// report $0.01, test tokens, no real funds). Enabled with
// X402_PAID_ENABLED=true + X402_PAY_TO set; anything wrong -> /api/paid/*
// fails closed with 503, free routes unaffected.
export function paidGateStatus(env = process.env) {
  if (env.X402_PAID_ENABLED !== 'true') {
    return { state: 'disabled', detail: 'The x402 paid API (testnet) is off; the free demo routes are unaffected.' };
  }
  if (!env.X402_PAY_TO || !env.X402_PAY_TO.trim()) {
    return { state: 'closed', detail: 'X402_PAID_ENABLED is true but X402_PAY_TO is missing; /api/paid/* fails closed.' };
  }
  return { state: 'enabling', network: env.X402_NETWORK || 'eip155:84532' };
}

export async function buildPaidGate({ buildVetIdentify, buildVetReport, env = process.env } = {}) {
  const status = paidGateStatus(env);
  const closed = (req, res) => {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'paid_access_closed', detail: status.detail }));
  };
  if (status.state !== 'enabling') return closed;
  const network = env.X402_NETWORK || 'eip155:84532';
  const payTo = env.X402_PAY_TO.trim();
  // @x402/core v2 route shape: accepts = PaymentOption(s) with scheme/network/
  // payTo/price (the {price, networks} shape is the CDP SDK's, not this one's).
  const routes = {
    'GET /api/paid/vet/identify': {
      accepts: { scheme: 'exact', network, payTo, price: env.X402_PRICE_IDENTIFY || '$0.001' },
      description: 'Company identity resolution (x402 testnet paid API)', mimeType: 'application/json'
    },
    'GET /api/paid/vet/report': {
      accepts: { scheme: 'exact', network, payTo, price: env.X402_PRICE_REPORT || '$0.01' },
      description: 'Cited company-vetting evidence report (x402 testnet paid API)', mimeType: 'application/json'
    }
  };
  const { HTTPFacilitatorClient, x402ResourceServer } = await import('@x402/core/server');
  const { x402HTTPResourceServer } = await import('@x402/core/http');
  const { ExactEvmScheme } = await import('@x402/evm/exact/server');
  const { paymentMiddlewareFromHTTPServer } = await import('@x402/express');
  const { default: express } = await import('express');
  const facilitatorClient = new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL || 'https://x402.org/facilitator' });
  const resourceServer = new x402ResourceServer(facilitatorClient).register('eip155:*', new ExactEvmScheme());
  await resourceServer.initialize();
  const server = new x402HTTPResourceServer(resourceServer, routes);
  const app = express();
  app.use(paymentMiddlewareFromHTTPServer(server));
  app.use(async (req, res) => {
    const u = new URL(req.url || '/', 'http://localhost');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    try {
      if (u.pathname === '/api/paid/vet/identify') {
        const name = (u.searchParams.get('name') || '').trim().slice(0, 120);
        if (!name) return send(400, { error: 'missing_name' });
        return send(200, await buildVetIdentify(name));
      }
      if (u.pathname === '/api/paid/vet/report') {
        const name = (u.searchParams.get('name') || '').trim().slice(0, 120);
        const question = (u.searchParams.get('question') || '').trim().slice(0, 400);
        const category = (u.searchParams.get('category') || 'general').trim().slice(0, 24);
        const identityName = (u.searchParams.get('identityName') || '').trim().slice(0, 200);
        const identityKind = (u.searchParams.get('identityKind') || 'custom').trim().slice(0, 32);
        if (!name || !identityName) return send(400, { error: 'missing_name_or_identity' });
        return send(200, await buildVetReport(name, question, category, { kind: identityKind, name: identityName }));
      }
      return send(404, { error: 'not_found' });
    } catch (e) {
      return send(500, { error: 'paid_route_failed', detail: String(e && e.message || e).slice(0, 120) });
    }
  });
  return app;
}
