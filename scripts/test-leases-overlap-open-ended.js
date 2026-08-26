#!/usr/bin/env node
/**
 * Open-ended leases must count toward house-cover active-tenant math.
 * Run: npm run test:leases-overlap-open-ended
 */
'use strict';

const assert = require('assert');
const {
  leasesOverlapMonth,
  countActiveLeasesForMonth,
} = require('../src/use-cases/utilities/house-cover');

assert.strictEqual(
  leasesOverlapMonth({ start_date: '2025-10-01', end_date: null }, '2026-07'),
  true,
  'null end_date overlaps any month after start'
);
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2025-10-01', end_date: undefined }, '2026-12'),
  true,
  'undefined end_date treated as open-ended'
);
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2025-10-01', end_date: '' }, '2026-01'),
  true,
  'empty end_date treated as open-ended'
);
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2026-08-01', end_date: null }, '2026-07'),
  false,
  'open-ended lease that starts after month does not overlap'
);
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2026-07-31', end_date: null }, '2026-07'),
  true,
  'open-ended lease starting on last day of month overlaps'
);

const mixed = [
  { id: 'open', start_date: '2025-01-01', end_date: null },
  { id: 'finite', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'ended', start_date: '2024-01-01', end_date: '2025-12-31' },
  { id: 'future', start_date: '2026-09-01', end_date: null },
];
assert.strictEqual(
  countActiveLeasesForMonth(mixed, '2026-07'),
  2,
  'open-ended + finite active; ended and future excluded'
);

console.log('OK leasesOverlapMonth open-ended end_date');
