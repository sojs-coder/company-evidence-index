# Company Evidence Index

A persistent, cited record of what a company claims and what the evidence supports, built for investor due diligence.

Built at Cal Hacks 13.0.

## What it does

- **Claim ledger** - every claim carries its source, date, claim text, evidence for, evidence against, and a status: supported, contradicted, or unresolved. Every entry cites its source.
- **Attribution discipline** - articles and posts stay attributed opinions unless independently supported. An employee's statement is logged as that person's claim, not automatically the company's.
- **Separate evidence classes** - verified financials (filings, official disclosures) never blend with estimates or social signals. Missing financial data renders as unknown, never inferred from social posts.
- **Persistent snapshots** - the index is keyed by company and survives between runs, with a visible refresh diff showing what changed since the last snapshot.
- **Coverage panel** - sources checked, unresolved claims, and explicit gaps. Missing evidence is shown as missing, never as proof of anything.
- **Sentiment layer** - sampled public sentiment about the target, shown with sample size, date range, platforms, and method.

## Demo target

Apple. Verified financials are complete and free through SEC EDGAR (10-K, 10-Q, 8-K, proxy); official claims are harvested from apple.com newsroom and keynote statements; press coverage via Google News exercises the classification step.

## Data sources

- SEC EDGAR - verified financials
- Google News - press coverage
- apple.com newsroom and keynote statements - company claims
- Seeded public posts
- Signalor mention data - sentiment layer (read-only)

## Non-goals

- No claim of whole-internet coverage. Every screen names what was checked and what was not.
- No personal social-media risk scoring of individuals. The subject is a company and its claims, not judgments about people's posts.
- No investment recommendation. The tool cites evidence and shows uncertainty; a reviewer decides.
