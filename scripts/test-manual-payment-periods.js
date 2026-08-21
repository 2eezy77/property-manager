#!/usr/bin/env node
/**
 * Unit checks for manual/offline payment calendar period helpers.
 * Run with TZ=UTC for deterministic ISO date slices:
 *   TZ=UTC node scripts/test-manual-payment-periods.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://coverage:coverage@127.0.0.1:5432/coverage';

const assert = require('assert');
const {
  monthBounds,
  periodForMonth,
  MANUAL_METHODS,
} = require('../src/services/manual-payment.service');

assert.ok(MANUAL_METHODS.has('cash_app'));
assert.ok(MANUAL_METHODS.has('check'));
assert.ok(!MANUAL_METHODS.has('ach'), 'ACH is portal-only, not a manual method');

{
  const aug = periodForMonth(2026, 7); // August
  assert.strictEqual(aug.start, '2026-08-01');
  assert.strictEqual(aug.end, '2026-08-31');
}

{
  const feb = periodForMonth(2024, 1); // leap year February
  assert.strictEqual(feb.start, '2024-02-01');
  assert.strictEqual(feb.end, '2024-02-29');
}

{
  const febNonLeap = periodForMonth(2025, 1);
  assert.strictEqual(febNonLeap.end, '2025-02-28');
}

{
  const bounds = monthBounds(new Date(Date.UTC(2026, 5, 15, 18, 0, 0))); // mid-June
  assert.strictEqual(bounds.start, '2026-06-01');
  assert.strictEqual(bounds.end, '2026-06-30');
}

console.log('test-manual-payment-periods: ok');
