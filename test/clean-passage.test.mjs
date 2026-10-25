import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPassage } from '../vet-report.mjs';

const CATERPILLAR = '[Caterpillar Inc. awarded nearly $1.3 billion defense contract for construction equipment] The Defense Logistic Agency has awarded Caterpillar a $1.28 billion contract to supply construction equipment, the Department of Defense announced on Thursday. The department received three bids for the economic-price-adjusted, indefinite-delivery requirement contract, which will last for five years with no option periods. NORTH KOREA UNSUCCESSFULLY LAUNCHES SUSPECTED ICBM';

test('cuts unrelated ALL-CAPS teaser headline at article boundary, keeps verbatim prefix', () => {
  const out = cleanPassage(CATERPILLAR);
  assert.ok(out.endsWith('no option periods.'));
  assert.ok(!out.includes('NORTH KOREA'));
  assert.ok(CATERPILLAR.startsWith(out));
});
test('clean mixed-case passage passes through untouched', () => {
  const p = 'A normal passage. With two sentences about NASA and the DoD.';
  assert.equal(cleanPassage(p), p);
});
test('fully contaminated passage is dropped, not rewritten', () => {
  assert.equal(cleanPassage('NORTH KOREA LAUNCHES ICBM NOW TODAY'), '');
});
test('mid-sentence acronyms do not trigger a cut', () => {
  const p = 'The NASA award went to JPL in Pasadena. Officials confirmed the work.';
  assert.equal(cleanPassage(p), p);
});
