// Generic runtime-config snapshot client (broker protocol seam).
// Fetches an identity-scoped secret snapshot at startup over HTTPS with an
// X-API-Key header. Protocol facts verified by the Signalor owner
// (2026-10-24): HTTPS plaintext JSON after SERVER-SIDE decrypt (no client
// decrypt); the Apify key lives at data.secrets.APIFY_API_TOKEN.
//
// HARD RULES (owner requirements):
// - The envelope also carries serviceCredential/trustedCredentials that this
//   service must NOT observe, log, cache, or return. Extraction is
//   EXTRACT-ONLY: parse, pull the single requested path, discard the rest
//   immediately. No function here returns the parsed snapshot.
// - NEVER POST anything on secret-fetch or secret-use failure: an upstream
//   auth-failure report would quarantine the shared prod key for ALL
//   consumers. Fail LOCALLY only (honest error state, no telemetry POST,
//   no retry storm).
// - The token and any payload bytes are never embedded in status/error
//   strings. With env unset: not_configured, zero network calls.

const DEFAULT_PATH_PREFIX = 'data.secrets';

export function runtimeConfigStatus(env = process.env) {
  const configured = Boolean(env.RUNTIME_CONFIG_URL && env.RUNTIME_CONFIG_TOKEN);
  return {
    configured,
    state: configured ? 'configured' : 'not_configured',
    detail: configured
      ? 'Runtime configuration connected.'
      : 'Runtime configuration not connected.'
  };
}

// Dotted-path lookup. Internal helper; the object it walks is discarded by
// the caller immediately after.
function resolvePath(root, keyPath) {
  let node = root;
  for (const seg of keyPath.split('.')) {
    if (!node || typeof node !== 'object' || !(seg in node)) return { ok: false, error: 'not_found' };
    node = node[seg];
  }
  if (typeof node !== 'string' || !node.trim()) return { ok: false, error: 'not_found' };
  return { ok: true, value: node };
}

// Fetch the snapshot and extract ONE secret. Returns only { ok, value? } or
// { ok:false, error }. The full payload is parsed inside this function's
// scope and never returned, logged, or cached.
export async function extractBrokeredSecret(keyName, { env = process.env, fetchImpl = fetch, timeoutMs = 5000, maxBytes = 65536, keyPath } = {}) {
  if (!env.RUNTIME_CONFIG_URL || !env.RUNTIME_CONFIG_TOKEN) {
    return { ok: false, error: 'not_configured' };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(env.RUNTIME_CONFIG_URL, {
      method: 'GET',
      headers: { 'x-api-key': env.RUNTIME_CONFIG_TOKEN, 'accept': 'application/json' },
      signal: ac.signal
    });
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network_error' }; // LOCAL failure only - never POST this anywhere
  }
  clearTimeout(t);
  if (!res.ok) return { ok: false, error: 'http_error', httpStatus: res.status }; // LOCAL failure only
  let text;
  try { text = await res.text(); } catch { return { ok: false, error: 'read_error' }; }
  if (text.length > maxBytes) return { ok: false, error: 'oversize_snapshot' };
  // Extract-only scope: the parsed envelope never leaves this block.
  try {
    const snapshot = JSON.parse(text);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ok: false, error: 'non_object_snapshot' };
    const path = keyPath || env.RUNTIME_CONFIG_KEY_PATH || `${DEFAULT_PATH_PREFIX}.${keyName}`;
    return resolvePath(snapshot, path); // only the single string value escapes
  } catch {
    return { ok: false, error: 'non_json_snapshot' };
  }
}
