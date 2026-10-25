import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedDemoCompany } from '../vet-allowlist.mjs';

test('the five evidence-backed companies are allowed, case/spacing tolerant', () => {
  for (const [input, key] of [['Apple Inc', 'AAPL'], ['apple', 'AAPL'], ['MICROSOFT CORP', 'MSFT'], ['Amazon.com Inc', 'AMZN'], ['Alphabet', 'GOOGL'], ['google', 'GOOGL'], ['NVIDIA Corporation', 'NVDA']]) {
    assert.equal(allowedDemoCompany(input), key, input);
  }
});
test('arbitrary companies are rejected', () => {
  for (const input of ['Honeybee Robotics', 'Caterpillar', 'Tesla', '', 'applesauce inc']) {
    assert.equal(allowedDemoCompany(input), null, input || '(empty)');
  }
});
