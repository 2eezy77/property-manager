#!/usr/bin/env node
/**
 * Monthly rent invoice period bounds (local calendar month → ISO date strings).
 * Run with TZ=UTC for determinism: npm run test:rent-billing-month-bounds
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@localhost:5432/db';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_coverage';
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
}

const assert = require('assert');
const {
  currentMonthStart,
  currentMonthEnd,
} = require('../src/services/rent-billing.service');

assert.strictEqual(
  currentMonthStart(new Date(Date.UTC(2026, 7, 15, 12, 0, 0))),
  '2026-08-01'
);
assert.strictEqual(
  currentMonthEnd(new Date(Date.UTC(2026, 7, 15, 12, 0, 0))),
  '2026-08-31'
);
assert.strictEqual(
  currentMonthStart(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))),
  '2026-01-01'
);
assert.strictEqual(
  currentMonthEnd(new Date(Date.UTC(2026, 0, 31, 23, 0, 0))),
  '2026-01-31'
);
assert.strictEqual(
  currentMonthEnd(new Date(Date.UTC(2024, 1, 10, 12, 0, 0))),
  '2024-02-29',
  'leap year February'
);
assert.strictEqual(
  currentMonthEnd(new Date(Date.UTC(2025, 1, 10, 12, 0, 0))),
  '2025-02-28',
  'non-leap February'
);
assert.strictEqual(
  currentMonthEnd(new Date(Date.UTC(2026, 3, 5, 8, 0, 0))),
  '2026-04-30',
  '30-day month'
);

console.log('OK rent-billing currentMonthStart/End');
