#!/usr/bin/env node
/**
 * Calendar month bounds used by monthly utility drafts / UC10 combine.
 * Pure house-cover helper (monthly-billing re-exports the same function).
 * Run: node scripts/test-calendar-month-bounds.js
 */
'use strict';

const assert = require('assert');
const { monthBounds } = require('../src/use-cases/utilities/house-cover');
const { calendarMonthBounds, minDate, maxDate } = require('../src/use-cases/utilities/monthly-billing');

assert.deepStrictEqual(
  monthBounds('2026-08'),
  { start: '2026-08-01', end: '2026-08-31' },
  'August has 31 days'
);
assert.deepStrictEqual(
  monthBounds('2026-02'),
  { start: '2026-02-01', end: '2026-02-28' },
  'non-leap February'
);
assert.deepStrictEqual(
  monthBounds('2024-02'),
  { start: '2024-02-01', end: '2024-02-29' },
  'leap February'
);
assert.deepStrictEqual(
  monthBounds('2026-04'),
  { start: '2026-04-01', end: '2026-04-30' },
  'April has 30 days'
);
assert.strictEqual(monthBounds(''), null, 'empty ym is null');
assert.strictEqual(monthBounds('2026'), null, 'year-only is null');
assert.strictEqual(monthBounds('2026-00'), null, 'month 0 is null');
assert.strictEqual(monthBounds(null), null, 'null ym is null');

assert.deepStrictEqual(
  calendarMonthBounds('2026-07'),
  monthBounds('2026-07'),
  'monthly-billing calendarMonthBounds matches house-cover monthBounds'
);

assert.strictEqual(minDate('2026-06-06', '2026-07-09'), '2026-06-06');
assert.strictEqual(maxDate('2026-06-06', '2026-07-09'), '2026-07-09');
assert.strictEqual(minDate('2026-07-09', '2026-07-09'), '2026-07-09');

console.log('All calendar-month-bounds checks passed.');
