#!/usr/bin/env node
/**
 * Owner / manager money tiles must agree for a partial flexible-pay tenant.
 *
 * Snapshot (do not invent other figures):
 *   Osanin $1,200, Lily $900, Isaiah $900 whole; Buckley $450 of $900.
 *   Collected $3,450 · expected $3,900 · remaining $450 · 3 paid + 1 partial.
 *
 * Run: TZ=America/New_York node scripts/test-rent-collection-stats.js
 */

'use strict';

const assert = require('assert');
const { classifyRow, rentBalances } = require('../src/services/rent-status.service');
const {
  summarizeRentCollection,
  paidCountSublabel,
} = require('../src/services/rent-status.service');
const {
  calendarMonthKey,
  formatPeriodMonth,
  groupPaymentsByMonth,
  monthGroupSummary,
} = require('../src/utils/payment-month');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const augustRows = [
  { name: 'Osanin', monthly_rent: 1200, paid_amount_this_month: 1200, late_fee_amount: 50, grace_period_days: 5 },
  { name: 'Lily', monthly_rent: 900, paid_amount_this_month: 900, late_fee_amount: 50, grace_period_days: 5 },
  { name: 'Isaiah', monthly_rent: 900, paid_amount_this_month: 900, late_fee_amount: 50, grace_period_days: 5 },
  {
    name: 'Buckley Stone',
    monthly_rent: 900,
    paid_amount_this_month: 450,
    pending_amount_this_month: 0,
    late_fee_amount: 0,
    grace_period_days: 31,
  },
];

const stone = augustRows[3];
const stoneBal = rentBalances(stone);
check(stoneBal.remaining === 450, `Stone remaining is $450, got ${stoneBal.remaining}`);
check(stoneBal.fullyPaid === false, 'Stone is not fully paid');
check(stoneBal.hasPartial === true, 'Stone is partial');

const stoneRow = classifyRow(stone, 'August 2026');
check(stoneRow.status === 'partial', `Stone status is partial, got ${stoneRow.status}`);
check(stoneRow.status !== 'up_to_date', 'flexible partial must not classify as up_to_date');
check(stoneRow.shouldEmail === false, 'flexible partial must not trigger late email');
check(/flexible pay/.test(stoneRow.detail), `Stone detail mentions flexible pay: ${stoneRow.detail}`);

const stats = summarizeRentCollection(augustRows);
check(stats.this_month === 3450, `collected this month $3450, got ${stats.this_month}`);
check(stats.outstanding === 450, `outstanding includes remaining $450, got ${stats.outstanding}`);
check(stats.paid_count === 3, `paid_count is fully-paid tenants only (3), got ${stats.paid_count}`);
check(stats.partial_count === 1, `partial_count is 1, got ${stats.partial_count}`);
check(stats.tenant_count === 4, `tenant_count is 4, got ${stats.tenant_count}`);
check(
  paidCountSublabel(stats) === '3/4 paid · 1 partial',
  `owner sublabel is "3/4 paid · 1 partial", got "${paidCountSublabel(stats)}"`
);

const allPaid = summarizeRentCollection(augustRows.map((r) => ({
  ...r,
  paid_amount_this_month: r.monthly_rent,
})));
check(allPaid.outstanding === 0, 'fully paid roster has $0 outstanding');
check(allPaid.paid_count === 4, 'fully paid roster paid_count is 4');
check(allPaid.partial_count === 0, 'fully paid roster has no partials');
check(paidCountSublabel(allPaid) === '4/4 paid', `all-paid label is "4/4 paid", got "${paidCountSublabel(allPaid)}"`);

check(calendarMonthKey('2026-08-01T00:00:00.000Z') === '2026-08',
  `Aug 1 UTC midnight is calendar August, got ${calendarMonthKey('2026-08-01T00:00:00.000Z')}`);
check(calendarMonthKey('2026-08-01') === '2026-08',
  `date-only Aug 1 is calendar August, got ${calendarMonthKey('2026-08-01')}`);
check(calendarMonthKey(new Date('2026-08-01T00:00:00.000Z')) === '2026-08',
  'Date object at UTC midnight Aug 1 is calendar August');
check(calendarMonthKey('2026-08-15T00:00:00.000Z') === '2026-08',
  'mid-month utility period stays August');
check(formatPeriodMonth('2026-08-01T00:00:00.000Z') === 'Aug 2026',
  `Period cell for Aug 1 UTC is Aug 2026, got ${formatPeriodMonth('2026-08-01T00:00:00.000Z')}`);
check(formatPeriodMonth('2026-08-01') === 'Aug 2026',
  'date-only Aug 1 Period cell is Aug 2026');

const augustHistory = [
  { period_start: '2026-08-01T00:00:00.000Z', amount: 1200, status: 'succeeded', payment_type: 'rent' },
  { period_start: '2026-08-01T00:00:00.000Z', amount: 900, status: 'succeeded', payment_type: 'rent' },
  { period_start: '2026-08-01T00:00:00.000Z', amount: 900, status: 'succeeded', payment_type: 'rent' },
  { period_start: '2026-08-01T00:00:00.000Z', amount: 450, status: 'succeeded', payment_type: 'rent' },
  { period_start: '2026-08-15T00:00:00.000Z', amount: 161.28, status: 'succeeded', payment_type: 'utility' },
  { period_start: '2026-08-20T00:00:00.000Z', amount: 68.41, status: 'succeeded', payment_type: 'utility' },
];
const groups = groupPaymentsByMonth(augustHistory);
const aug = groups.find((g) => g.key === '2026-08');
const july = groups.find((g) => g.key === '2026-07');
check(!!aug, 'August group exists');
check(!july, 'Aug 1 rent must not fall into a July group');
check(aug && aug.count === 6, `August group has 6 payments, got ${aug && aug.count}`);
check(aug && Math.abs(aug.collected - 3679.69) < 0.001, `August collected $3679.69, got ${aug && aug.collected}`);
check(aug && aug.rentCollected === 3450, `August rent $3450, got ${aug && aug.rentCollected}`);
check(aug && Math.abs(aug.utilityCollected - 229.69) < 0.001,
  `August utilities $229.69, got ${aug && aug.utilityCollected}`);

const mixedLabel = monthGroupSummary(aug || { count: 0, collected: 0, rentCount: 0, utilityCount: 0 });
check(/rent/i.test(mixedLabel) && /utilit/i.test(mixedLabel),
  `mixed month label names rent and utilities: ${mixedLabel}`);

const utilOnly = groupPaymentsByMonth(augustHistory.filter((p) => p.payment_type === 'utility'))[0];
const utilLabel = monthGroupSummary(utilOnly);
check(/utilit/i.test(utilLabel), `utilities-only month says utilities, got: ${utilLabel}`);
check(!/rent/i.test(utilLabel) || /0/.test(utilLabel),
  'utilities-only month does not imply rent posted');

const { spawnSync } = require('child_process');
const esm = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { calendarMonthKey, formatPeriodMonth, groupPaymentsByMonth } from './client/src/utils/payment-month-groups.js';
  if (calendarMonthKey('2026-08-01T00:00:00.000Z') !== '2026-08') process.exit(2);
  if (formatPeriodMonth('2026-08-01T00:00:00.000Z') !== 'Aug 2026') process.exit(3);
  const g = groupPaymentsByMonth([
    { period_start: '2026-08-01T00:00:00.000Z', amount: 3450, status: 'succeeded', payment_type: 'rent' },
    { period_start: '2026-08-15T00:00:00.000Z', amount: 229.69, status: 'succeeded', payment_type: 'utility' },
  ]);
  if (!g.find((x) => x.key === '2026-08') || g.find((x) => x.key === '2026-07')) process.exit(4);
`], { cwd: require('path').join(__dirname, '..') });
check(esm.status === 0, 'client ESM month helpers match calendar August');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll rent-collection stats checks passed.');
