import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsBrand } from '../src/lib/audit-report.js';

test('brand detection respects word boundaries, punctuation and non-English names', () => {
  assert.equal(mentionsBrand('A small space', 'Ace'), false);
  assert.equal(mentionsBrand('Our Place reviews', 'Our Place'), true);
  assert.equal(mentionsBrand('B&O headphones', 'B&O'), true);
  assert.equal(mentionsBrand('Compare 小米 phones', '小米'), true);
});
