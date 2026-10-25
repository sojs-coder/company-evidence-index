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

export function x402Status(env = process.env) {
  if (env.X402_ENABLED !== 'true') {
    return { state: 'disabled', detail: 'Paid access is off; endpoints are free.' };
  }
  const missing = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'X402_PAY_TO'].filter(k => !env[k] || !env[k].trim());
  if (missing.length) {
    return { state: 'closed', detail: 'Paid access is enabled but its configuration is incomplete; data routes fail closed (503) with no data.' };
  }
  return { state: 'enabling', detail: 'Paid access activates at startup.' };
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
    const { createX402Server } = await import('@coinbase/cdp-sdk/x402');
    const { paymentMiddlewareFromHTTPServer } = await import('@x402/express');
    const { default: express } = await import('express');
    const network = env.X402_NETWORK || 'eip155:84532'; // Base Sepolia testnet default
    const price = env.X402_PRICE || '$0.01';
    const routes = {};
    for (const r of ['GET /api/companies/apple/report', 'GET /api/companies/apple/analysis', 'GET /api/companies/apple/export', 'GET /api/companies/apple/memo', 'POST /api/companies/apple/collect/{key}', 'GET /api/companies/apple/collect/{key}']) {
      routes[r] = { price, networks: [network], description: 'Company Evidence Index diligence API (per-endpoint paid access)' };
    }
    const server = await createX402Server({
      environment: env.X402_ENVIRONMENT || 'development', // development = testnets/test funds per the official guide
      payToConfig: { type: 'address', evm: env.X402_PAY_TO },
      routes
    });
    const app = express();
    app.use(paymentMiddlewareFromHTTPServer(server));
    app.use((req, res) => handler(req, res));
    return {
      handler: app,
      status: { state: 'enabled', network, price, environment: env.X402_ENVIRONMENT || 'development', detail: 'x402 gate active via official CDP SDK. Static site and unlisted routes remain free.' }
    };
  } catch (e) {
    return {
      handler: closedHandler(handler),
      status: { state: 'closed', detail: `x402 enable failed (${String(e && e.message || e)}). Failing CLOSED: data routes return 503.` }
    };
  }
}
