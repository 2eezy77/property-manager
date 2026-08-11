/**
 * Unit tests for utility portal-pay summary helpers.
 * Run: node scripts/test-utility-portal-charge.js
 */
const assert = require('assert');
const {
  summarizeOpenUtilities,
  PAYABLE_SPLIT_STATUSES,
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

console.log('test-utility-portal-charge OK');
