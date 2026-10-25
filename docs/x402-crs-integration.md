# x402 + CRS + brokered secrets integration

Status as of 2026-10-24. All three integrations are wired but OFF by default; each reports an honest state in `GET /api/health`.

## x402 paid access (Coinbase CDP)

- Code: `x402-gate.mjs` wraps the whole app handler via the official SDK (`createX402Server` from `@coinbase/cdp-sdk/x402`, `paymentMiddlewareFromHTTPServer` from `@x402/express`), per the official seller quickstart (docs.cdp.coinbase.com/x402/quickstart-for-sellers, read 2026-10-24).
- `X402_ENABLED` unset/not `true` = demo mode: all endpoints free. This is the shipped state.
- `X402_ENABLED=true` requires `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `X402_PAY_TO`. Prices from `X402_PRICE` (default `$0.01`), network from `X402_NETWORK` (default Base Sepolia `eip155:84532` testnet), `X402_ENVIRONMENT` default `development` (testnets/test funds).
- FAIL CLOSED: if anything is wrong (missing env, SDK init/facilitator error), every `/api/*` route except `/api/health` returns 503 `payment_gate_unavailable` with no data. Paid data never leaks because the payment layer broke.
- Gated routes: report, analysis, export, memo, collect (per-endpoint price). Static site and health stay free.
- User decisions still needed before real activation: per-endpoint price, receiving wallet (none was invented), CDP facilitator account, mainnet go-ahead.

## CRS SBSS credit layer

- Code: `crs-sbss.mjs`, a client for the CRS sandbox spec (sbss-sandbox.crscreditapi.com/openapi.yaml, read 2026-10-24): `POST /sbss`, Bearer auth, `SbssRequest` validation (product category enum, 1-2 principals, exactly one of experian/equifax, ssn-or-birthdate).
- Route: `POST /api/credit/sbss`. Without `CRS_API_KEY` it returns an honest `not_configured` state and never makes a network call. `CRS_API_BASE` overrides the base URL; default is the sandbox.
- Fit gap (deliberate): SBSS scores small-business credit decisions from principal consumer files. It is not a credit layer for a large-cap public company like Apple, and it is not wired into the Apple report. It exists for private-company / counterparty targets with a defined permitted business purpose. Account creation and CRS-side risk-model provisioning are user decisions; no account was created from code. Tests use the spec's synthetic example payloads only - never real PII.

## Brokered secrets (runtime config)

- Code: `runtime-config.mjs`. Fetches an identity-scoped snapshot (`RUNTIME_CONFIG_URL`) with `X-API-Key` (`RUNTIME_CONFIG_TOKEN`) at runtime; extract-only: it pulls one dotted path (default `data.secrets.<KEY>`) and discards the rest of the envelope without logging, caching, or returning it.
- Every failure is LOCAL ONLY (no upstream POST/report of any kind: an auth-failure report would quarantine the shared key for all consumers).
- Used by the Apify collector as a second token source after `APIFY_API_TOKEN`.

## Apify collector

- Source key `apify` in the collector list. Token from `APIFY_API_TOKEN`, else the brokered runtime config. Runs stay off unless `APIFY_ENABLED=true`; actor set comes from `APIFY_ACTORS` (comma-separated actor IDs - no actor is hardcoded, since specific actors are proposed, not selected/verified).
- Before any paid actor run it does the documented free validity check `GET /v2/users/me`; a 401 is a local `invalid_token` state, never reported upstream.
- Costs are bounded by the approved infrastructure budget; no unlimited runs.

## Tests

`npm test` runs `node --test` over `test/`: CRS spec validation + no-key-no-network + sandbox URL/auth/parse + error surface; x402 disabled pass-through + fail-closed on missing env / init failure across every data path + health/static spared; a real-SDK integration test (installed packages, live HTTP server) proving no data without payment; runtime-config extract-only and no-leak guarantees.
