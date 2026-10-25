// x402 paid-access gate - official Coinbase/CDP SDK, testnet-first.
// Grounded in the official seller quickstart (read 2026-10-24):
//   https://docs.cdp.coinbase.com/x402/quickstart-for-sellers
// SDK: @coinbase/cdp-sdk (createX402Server) + @x402/express
// (paymentMiddlewareFromHTTPServer). Base Sepolia eip155:84532 in
// development; mainnet only after the user's price/wallet/facilitator
// decisions.
//
// SECURITY MODEL (owner correction 2026-10-24 20:47):
// - X402_ENABLED !== 'true'  -> gate absent, endpoints serve free (demo mode).
// - X402_ENABLED === 'true' and ANYTHING is wrong (missing env, SDK not
//   installed, facilitator init error) -> FAIL CLOSED: every data route
//   answers 503 with no data. Paid data must never leak because the
//   payment layer broke. Only /api/health and the static site stay up so
//   the state stays inspectable.

const DATA_PATH = /^\/api\/(?!health$)/; // every API route except /api/health carries data

// Facilitator selection (2026-10-25, verified against current CDP/x402 docs):
// - 'x402.org' (default): https://x402.org/facilitator, Base Sepolia TESTNET,
//   no CDP API keys and no auth. Only X402_PAY_TO is required.
// - 'cdp': CDP facilitator (api.cdp.coinbase.com), production-grade, requires
//   CDP_API_KEY_ID/SECRET. Mainnet only after owner-settled review.
export function x402Facilitator(env = process.env) {
  const f = (env.X402_FACILITATOR || 'x402.org').trim().toLowerCase();
  return f === 'cdp' ? 'cdp' : 'x402.org';
}

export function x402Status(env = process.env) {
  if (env.X402_ENABLED !== 'true') {
    return { state: 'disabled', detail: 'Paid access is off; endpoints are free.' };
  }
  const facilitator = x402Facilitator(env);
  const required = ['X402_PAY_TO', ...(facilitator === 'cdp' ? ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET'] : [])];
  const missing = required.filter(k => !env[k] || !env[k].trim());
  if (missing.length) {
    return { state: 'closed', detail: 'Paid access is enabled but its configuration is incomplete (missing: ' + missing.join(', ') + '); data routes fail closed (503) with no data.' };
  }
  return { state: 'enabling', facilitator, detail: 'Paid access activates at startup.' };
}

function closedHandler(handler) {
  return (req, res) => {
    const p = new URL(req.url || '/', 'http://localhost').pathname;
    if (DATA_PATH.test(p)) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'payment_gate_unavailable', detail: 'x402 paid access is enabled but the payment layer failed to initialize. Data routes are closed rather than served free.' }));
      return;
    }
    return handler(req, res); // /api/health + static stay up
  };
}

// Wrap an existing (req, res) handler with the x402 payment middleware when
// enabled. Returns { handler, status }. handler is always safe to pass to
// http.createServer.
export async function maybeWrapWithX402(handler, env = process.env) {
  const status = x402Status(env);
  if (status.state === 'disabled') return { handler, status };
  if (status.state === 'closed') return { handler: closedHandler(handler), status };
  try {
    const { paymentMiddlewareFromHTTPServer } = await import('@x402/express');
    const { default: express } = await import('express');
    const network = env.X402_NETWORK || 'eip155:84532'; // Base Sepolia testnet default
    const price = env.X402_PRICE || '$0.01';
    // Scope direction 2026-10-24 23:06: all research access is accountless and
    // paid via x402 - the vet routes ARE the research product. The Apple demo
    // routes stay listed as the worked example. Prices/network/wallet are
    // owner-settled before X402_ENABLED ever flips on: enabling gates the
    // public demo UI's own API calls too, so activation needs the payment
    // client flow first.
    const routes = {
      'GET /api/vet/report': { price: env.X402_PRICE_REPORT || price, networks: [network], description: 'Cited company-vetting evidence report (accountless x402 access)' },
      'GET /api/vet/identify': { price: env.X402_PRICE_IDENTIFY || '$0.001', networks: [network], description: 'Company identity resolution for vetting (accountless x402 access)' }
    };
    for (const r of ['GET /api/companies/apple/report', 'GET /api/companies/apple/analysis', 'GET /api/companies/apple/export', 'GET /api/companies/apple/memo', 'POST /api/companies/apple/collect/{key}', 'GET /api/companies/apple/collect/{key}']) {
      routes[r] = { price, networks: [network], description: 'Company Evidence Index diligence API (per-endpoint paid access)' };
    }
    const facilitator = x402Facilitator(env);
    let server;
    if (facilitator === 'cdp') {
      const { createX402Server } = await import('@coinbase/cdp-sdk/x402');
      server = await createX402Server({
        environment: env.X402_ENVIRONMENT || 'development', // development = testnets/test funds per the official guide
        payToConfig: { type: 'address', evm: env.X402_PAY_TO },
        routes
      });
    } else {
      // x402.org testnet facilitator: no API keys. HTTPFacilitatorClient +
      // x402ResourceServer + x402HTTPResourceServer per @x402/core server docs.
      const { HTTPFacilitatorClient, x402ResourceServer, x402HTTPResourceServer } = await import('@x402/core/server');
      const facilitatorClient = new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL || 'https://x402.org/facilitator' });
      const resourceServer = new x402ResourceServer(facilitatorClient);
      server = new x402HTTPResourceServer(resourceServer, routes);
    }
    const app = express();
    app.use(paymentMiddlewareFromHTTPServer(server));
    app.use((req, res) => handler(req, res));
    return {
      handler: app,
      status: { state: 'enabled', network, price, facilitator, detail: facilitator === 'cdp' ? 'x402 gate active via official CDP SDK. Static site and unlisted routes remain free.' : 'x402 gate active via x402.org testnet facilitator (no real funds). Static site and unlisted routes remain free.' }
    };
  } catch (e) {
    return {
      handler: closedHandler(handler),
      status: { state: 'closed', detail: `x402 enable failed (${String(e && e.message || e)}). Failing CLOSED: data routes return 503.` }
    };
  }
}
