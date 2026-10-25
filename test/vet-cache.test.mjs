import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vetReportKey, findVetReportByKey, getVetReport, putVetReport } from '../vet-cache.mjs';

const PARAMS = { name: 'Caterpillar ', question: 'Federal  contracts?', category: 'supplier', identityKind: 'public_company', identityName: 'CATERPILLAR INC' };

test('key is stable and case/whitespace-insensitive', () => {
  const a = vetReportKey(PARAMS);
  const b = vetReportKey({ ...PARAMS, name: 'caterpillar', question: 'federal contracts?' });
  assert.equal(a, b);
  assert.notEqual(a, vetReportKey({ ...PARAMS, question: 'different question' }));
});

test('put/get round-trips and replay needs no rebuild', () => {
  const store = {};
  const id = putVetReport(store, vetReportKey(PARAMS), { answer: { quotedEvidence: [] }, marker: 'v1' });
  assert.ok(id);
  assert.equal(getVetReport(store, id).report.marker, 'v1');
  assert.equal(findVetReportByKey(store, vetReportKey(PARAMS)).id, id);
});

test('refresh overwrites in place; cap keeps newest 25', () => {
  const store = {};
  const k = vetReportKey(PARAMS);
  putVetReport(store, k, { marker: 'old' });
  putVetReport(store, k, { marker: 'new' });
  assert.equal(getVetReport(store, k).report.marker, 'new');
  for (let i = 0; i < 40; i++) putVetReport(store, 'k' + i, { marker: i });
  assert.ok(Object.keys(store.vetReports).length <= 25);
  assert.ok(getVetReport(store, 'k39'), 'newest kept');
});
