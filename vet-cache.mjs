// Completed vet reports: content-keyed cache + persistence, so reopening or
// re-asking an identical question replays the stored report instead of
// re-billing the source APIs. Cached entries are clearly marked; ?refresh=1
// runs fresh. Capped so the store stays small.
import { createHash } from 'node:crypto';

const MAX_CACHED = 25;

// Bump when the report shape or the model/mode that produced it changes, so
// stale-shape cache entries never replay as if they were fresh.
const REPORT_SCHEMA_VERSION = 'vet-report:v1:answers-fast';

export function vetReportKey({ name, question, category, identityKind, identityName }) {
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha1').update([REPORT_SCHEMA_VERSION, norm(name), norm(question), norm(category), norm(identityKind), norm(identityName)].join('|')).digest('hex').slice(0, 16);
}

export function findVetReportByKey(store, key) {
  const all = (store && store.vetReports) || {};
  return all[key] || null;
}

export function getVetReport(store, id) {
  return findVetReportByKey(store, id);
}

export function putVetReport(store, key, report) {
  store.vetReports = store.vetReports || {};
  store.vetReports[key] = { id: key, at: new Date().toISOString(), report };
  const ids = Object.keys(store.vetReports);
  if (ids.length > MAX_CACHED) {
    const sorted = ids.sort((a, b) => String(store.vetReports[a].at).localeCompare(String(store.vetReports[b].at)));
    for (const oldId of sorted.slice(0, ids.length - MAX_CACHED)) delete store.vetReports[oldId];
  }
  return key;
}
