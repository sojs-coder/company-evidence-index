# Company Evidence Index — Auth + Backend Spec

Cal Hacks 13.0 · October 24, 2026 · Spec v2 · Companion to company-evidence-index-prd.pdf

Status: specification only. Nothing built or provisioned; every cost named here is proposed and unapproved. Grounded in the PRD (R1–R8, S1–S4) and the merged frontend mock.

## 1. Approval boundary

Approved so far: static mock hosting only — 3 days, 5 vCPU and 5 GB RAM, no dollar cap. Not approved: running this API server, a paid Railway volume for SQLite, or any LLM provider key and budget. Each needs its own go-ahead before build.

## 2. Auth — decided

**Public read, admin-gated write** — owner's call, October 24, 2026. Per-investor accounts are out for the demo. This settles the audience split; it does not settle any auth provider.

- Every GET route (overview, ledger, claim detail, coverage, sentiment, changes) is unauthenticated. The demo link just opens.
- The only gated actions are the mutations: refresh and per-source ingest. First click asks for a 6-digit one-time code. Delivery needs an SMS or email provider — proposed and unapproved (see §9). If none is approved, the fallback is a broker-held unlock secret entered directly.
- A correct code issues a short-lived HttpOnly, Secure, SameSite=Strict session cookie; mutations also require a CSRF token. The browser never holds a persistent secret.
- Codes are single-use, expire in 10 minutes, and allow 5 attempts per 10 minutes per IP with backoff to limit guessing attempts.

## 3. Secrets: broker, always

Owner's standing rule applies: broker. Always. The server resolves the secret that signs one-time codes and session cookies, plus any provider keys, at runtime through a small `resolve(name)` broker interface. No secret in environment variables, in the repo, or returned to the frontend.

What backs that interface for this fresh app is an open dependency. Signalor's broker is Signalor infrastructure and stays out of scope unless the owner says otherwise; a minimal new broker behind the same interface is the default assumption.

## 4. Abuse controls, proportional

- Public GETs: per-IP token-bucket rate limits, bounded page sizes, capped search length, enumerated filters only.
- Mutations: admin session plus CSRF token, and single-flight refresh per company — a second refresh while one runs gets a 409 with the running job.
- Idempotency: a refresh whose fetched content hashes match the last snapshot writes no new snapshot, so retries and double-clicks never duplicate history.
- SSRF: fetchers hit a hardcoded host allowlist (sec.gov, news.google.com, apple.com). No URL found inside ingested content is ever fetched. Size, timeout, and content-type caps on every response.
- Untrusted text: all source content is data, never instructions. Parameterized SQL, rendered as text only, LLM extraction output schema-validated, and every citation must resolve to a fetched source item.

## 5. Data model

- **companies** — the target (Apple for the demo).
- **sources** — the fixed, named source set with status and last_checked_at. Drives the coverage panel (R6).
- **source_items** — every fetched document with two kept-separate clocks: published_at stated by the source, fetched_at from us. Carries kind, topic, stance, reach as classification (R7).
- **claim_versions / evidence_versions** — append-only, each version content-hashed. Attribution discipline (R2): an employee's statement is logged as that person's claim, never auto-promoted to the company's.
- **snapshots** — a manifest hash over the record versions included. A snapshot is immutable and exactly reproducible; the refresh diff is the set difference between two manifests (R4, R5). Snapshots never mutate; a refresh adds versions and a new manifest. History is never rewritten.
- **financial_facts** — structured only: metric, value, unit, currency, period, form, filing accession number, XBRL concept, filed date, source URL.
- **sentiment_aggregates** — only rows backed by a named extract: extract id, window, record count, platforms, method.

## 6. What "verified financial" means

Ingestion from EDGAR does not make a number verified (R3). A financial fact earns the verified_financial class only by deterministic means:

- Parsed from EDGAR structured data (XBRL company facts or filing R files), not from LLM reading of prose.
- Unit, currency, and period consistency checks pass, and accounting cross-checks (such as assets = liabilities + equity) hold within tolerance.
- Full provenance: accession number, XBRL concept, filed date, and URL.

LLM output can summarize a filing but can never create a verified_financial row. A number that fails validation stays out of the verified class and is labeled as what it is.

## 7. Sentiment stays honest

- The sentiment endpoint serves aggregates only from a named Signalor extract, with sample size, date range, platforms, and method beside every number (S1–S3).
- Until a read route exists (still open in the PRD), the endpoint returns an explicit not-connected or stale state and the panel says so (S4).
- No fabricated fallback and no copied historical dashboard numbers in the backend. The figures in the current frontend mock are mock-only and labeled illustrative.

## 8. API surface

| Route | Purpose | Auth |
| --- | --- | --- |
| GET /api/companies/:id/overview | Metrics row, latest snapshot, banner diff count | Public |
| GET /api/companies/:id/claims | Ledger list with search and status filter | Public |
| GET /api/claims/:id | Evidence for, evidence against and limits, citation | Public |
| GET /api/companies/:id/coverage | Sources checked, per-source status, named gaps | Public |
| GET /api/companies/:id/sentiment | Extract-backed aggregates with provenance, or an honest state | Public |
| GET /api/companies/:id/changes | Snapshot history for "What changed" | Public |
| POST /api/companies/:id/refresh | Fetch, diff, snapshot. Single-flight and idempotent | Admin |
| POST /api/admin/ingest/:source | Re-run one source. Demo control | Admin |

## 9. Open dependencies

- Broker backing for this app — minimal new broker assumed; owner's call if it should differ.
- OTP delivery provider (SMS or email) — proposed, unapproved, feasibility unverified. The one-time-code gate is conditional on it; the broker-held unlock secret is the fallback.
- LLM extraction key and budget — a spend question at build time, not covered by the hosting approval.
- Railway volume for SQLite — paid add-on, unapproved.
- Signalor read route — open in the PRD; the panel degrades honestly until it exists.
- The PRD's pre-existing-data planning assumption stands as an assumption, unchanged.

## 10. Shape

One Railway service, one process: a small TypeScript server (Bun + Hono) that serves the existing static frontend and the JSON API under /api/*, with SQLite on a mounted volume as the persistent store (R4). No separate worker services, no Kafka/Redis — ingestion runs as in-process per-source fetcher jobs (EDGAR API, Google News RSS, apple.com newsroom, seeded posts, Signalor extract), with LLM claim extraction. Refresh = fetch, diff, snapshot. Daily cadence post-demo via cron, subject to source access and cost (R8). The Caddyfile is replaced by the server's static file serving, or kept with a proxy pass; a one-line decision at implementation.
