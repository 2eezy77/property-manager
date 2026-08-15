#!/usr/bin/env node
/**
 * Regression: Gmail calendar-default imports merge into open provider bills
 * (and UC10 keeper selection prefers real cycles / Current Charges).
 * Pure helpers only — no DB.
 *
 * Run: npm run test:utility-gmail-merge
 */
const assert = require('assert');
const {
  amountsNearlyEqual,
  pickMatchingOpenProviderBill,
  resolveMergedBillingPeriods,
  isCalendarMonthPeriod,
} = require('../src/use-cases/utilities/period-utils');
const {
  pickMergeAmount,
  sortKeeperFirst,
} = require('../src/use-cases/utilities/uc10-combine-monthly');

const hrsd = {
  id: 'hrsd',
  property_id: 'p1',
  service_type: 'water',
  period_start: '2026-06-06',
  period_end: '2026-07-09',
  total_amount: 165.74,
  tenant_charge_amount: 165.74,
  amount_source: null,
  created_at: '2026-08-05T16:00:00Z',
};
const augPhantom = {
  id: 'aug',
  property_id: 'p1',
  service_type: 'water',
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  total_amount: 165.74,
  tenant_charge_amount: 165.74,
  created_at: '2026-08-05T16:10:00Z',
};

assert.strictEqual(amountsNearlyEqual(165.74, 165.75), true);
assert.strictEqual(amountsNearlyEqual(165.74, 165.77), false);

const matched = pickMatchingOpenProviderBill([augPhantom, hrsd], 165.74);
assert.strictEqual(matched?.id, 'hrsd');
assert.strictEqual(pickMatchingOpenProviderBill([augPhantom], 165.74), null);

const preserved = resolveMergedBillingPeriods({
  existing: hrsd,
  parsed: {
    period_parsed: false,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
  },
  bounds: { start: '2026-08-01', end: '2026-08-31' },
});
assert.deepStrictEqual(preserved, {
  periodStart: '2026-06-06',
  periodEnd: '2026-07-09',
});

const unioned = resolveMergedBillingPeriods({
  existing: hrsd,
  parsed: {
    period_parsed: true,
    period_start: '2026-06-01',
    period_end: '2026-07-15',
  },
  bounds: { start: '2026-07-01', end: '2026-07-31' },
});
assert.deepStrictEqual(unioned, {
  periodStart: '2026-06-01',
  periodEnd: '2026-07-15',
});

const calendarMerge = resolveMergedBillingPeriods({
  existing: {
    period_start: '2026-07-01',
    period_end: '2026-07-31',
  },
  parsed: {
    period_parsed: false,
    period_start: '2026-07-01',
    period_end: '2026-07-31',
  },
  bounds: { start: '2026-07-01', end: '2026-07-31' },
});
assert.deepStrictEqual(calendarMerge, {
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
});

assert.strictEqual(isCalendarMonthPeriod('2026-07-01', '2026-07-31'), true);

const mergeAmt = pickMergeAmount([
  {
    service_type: 'electric',
    amount_source: 'amount_due_fallback',
    tenant_charge_amount: 744.21,
    total_amount: 744.21,
  },
  {
    service_type: 'electric',
    amount_source: 'current_charges',
    tenant_charge_amount: 184.64,
    total_amount: 184.64,
  },
]);
assert.strictEqual(mergeAmt, 184.64);

const keepers = sortKeeperFirst([
  {
    id: 'cal',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    amount_source: 'current_charges',
    total_amount: 200,
    created_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'dom',
    period_start: '2026-06-17',
    period_end: '2026-07-16',
    amount_source: 'amount_due_fallback',
    total_amount: 180,
    created_at: '2026-07-16T00:00:00Z',
  },
]);
assert.strictEqual(keepers[0].id, 'dom');

console.log('test-utility-gmail-merge: OK');
