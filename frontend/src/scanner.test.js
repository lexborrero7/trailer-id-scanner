import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrailerId, mergeScans } from './scanner.js';

test('cleanTrailerId normalizes operator input', () => {
  assert.equal(cleanTrailerId(' lr 76-64 '), 'LR76-64');
});

test('mergeScans adds unique IDs and improves duplicate confidence', () => {
  const existing = [{ id: '1', trailer_id: 'LR7664', confidence: 0.4 }];
  const result = mergeScans(existing, [
    { trailer_id: 'lr7664', confidence: 0.9 },
    { trailer_id: 'AB1234', confidence: 0.8 },
  ], 'Camera', '2026-10-05T12:00:00Z');
  assert.equal(result.added, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.records.find((item) => item.trailer_id === 'LR7664').confidence, 0.9);
});
