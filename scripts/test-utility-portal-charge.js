/**
 * Unit tests for utility portal-pay summary helpers.
 * Run: node scripts/test-utility-portal-charge.js
 */
const assert = require('assert');
const {
  summarizeOpenUtilities,
  PAYABLE_SPLIT_STATUSES,
  releaseUtilitySplitsForFailedPayment,
  markUtilitySplitsPaidForPayment,
} = require('../src/services/utility-portal-charge.service');

assert.deepStrictEqual(
  PAYABLE_SPLIT_STATUSES.slice().sort(),
  ['disputed', 'failed', 'notified', 'pending']
);

{
  const empty = summarizeOpenUtilities([]);
  assert.strictEqual(empty.utilityDue, 0);
  assert.deepStrictEqual(empty.utilitySplits, []);
}

// Payable statuses only — draft/paid/charging must not be offered for portal pay
assert.ok(!PAYABLE_SPLIT_STATUSES.includes('draft'));
assert.ok(!PAYABLE_SPLIT_STATUSES.includes('paid'));
assert.ok(!PAYABLE_SPLIT_STATUSES.includes('charging'));
assert.ok(PAYABLE_SPLIT_STATUSES.includes('disputed'), 'disputed shares remain payable');

{
  const splits = [
    {
      split_id: 's1',
      bill_id: 'b1',
      lease_id: 'l1',
      amount: 12.345,
      split_status: 'notified',
      service_type: 'electric',
      provider_name: 'Dominion',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      due_date: '2026-08-15',
      property_name: '743 A Ave',
    },
    {
      split_id: 's2',
      bill_id: 'b2',
      lease_id: 'l1',
      amount: 7.655,
      split_status: 'failed',
      service_type: 'water',
      provider_name: 'HRSD',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      due_date: '2026-08-20',
      property_name: '743 A Ave',
    },
  ];
  const summary = summarizeOpenUtilities(splits);
  assert.strictEqual(summary.utilityDue, 20);
  assert.strictEqual(summary.utilitySplits.length, 2);
  assert.strictEqual(summary.utilitySplits[0].id, 's1');
  assert.strictEqual(summary.utilitySplits[0].serviceType, 'electric');
  assert.strictEqual(summary.utilitySplits[1].amount, 7.655);
}

(async () => {
  // Abandoned/canceled utility pays must clear payment_id (Bugbot).
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          { bill_id: 'bill-a' },
          { bill_id: 'bill-a' },
          { bill_id: 'bill-b' },
        ],
      };
    },
  };
  const billIds = await releaseUtilitySplitsForFailedPayment(db, 'pay-1');
  assert.deepStrictEqual(billIds, ['bill-a', 'bill-b']);
  assert.ok(calls[0].sql.includes('payment_id = NULL'));
  assert.ok(calls[0].sql.includes("status = 'failed'"));
  assert.ok(calls[0].sql.includes("status <> 'paid'"));
  assert.deepStrictEqual(calls[0].params, ['pay-1']);

  const paidIds = await markUtilitySplitsPaidForPayment(db, 'pay-2');
  assert.deepStrictEqual(paidIds, ['bill-a', 'bill-b']);
  assert.ok(calls[1].sql.includes("status = 'paid'"));
  assert.ok(!calls[1].sql.includes('payment_id = NULL'));

  console.log('test-utility-portal-charge OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
