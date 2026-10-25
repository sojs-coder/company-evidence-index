# Phone capture connector (off by default)

`phone-capture.mjs` reads public posts from a real phone through a Phone Use gateway (remote MCP, interface by Ryan Ni, https://github.com/ryunzz/phoneuse_agent). This is an original adapter written against that public interface; no code was copied. The upstream repo has no license file, so reuse of its code needs Ryan's permission.

Status: code-tested against in-memory stand-ins only. Not hardware-tested. No gateway, key, or rig is connected, so nothing has been captured and zero items are ingested.

Gates (all required, otherwise zero network calls): PHONEUSE_ENABLED=true, PHONEUSE_MCP_URL (https unless localhost), PHONEUSE_API_KEY, PHONEUSE_TRACE_CONSENT=true (the gateway records screens and actions as training traces).
Needs an online rig from rigs_list. Only scrolls and screenshots; never types, taps, or uses ask_user/phone_do (phone_do needs an external VLM the upstream repo does not include).
Items exist only when a vision extractor reads text from a real screenshot; each carries rig id, capture time and frame SHA-256 as provenance. Screenshots are not stored.
Upstream limits: stylus path dry-run only, Mirroring is operator-mediated, no typing.
