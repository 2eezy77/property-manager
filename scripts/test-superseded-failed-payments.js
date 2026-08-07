#!/usr/bin/env node
/**
 * Failed payment rows must disappear once any succeeded payment exists for the
 * same lease + payment_type + billing month — ACH, card, Cash App, or offline.
 */
const assert = require('assert');
const {
  isFailedSupersededBySuccess,
  ledgerPaymentWhere,
  notSupersededFailedWhere,
} = require('../src/utils/payment-ledger');

const lease = 'lease-1';

const failedCashApp = {
  id: 'f1',
  lease_id: lease,
  payment_type: 'rent',
  status: 'failed',
  period_start: '2026-08-01T00:00:00.000Z',
  created_at: '2026-08-01T08:00:00.000Z',
  metadata: { source: 'cash_app_import' },
};

const failedLaterReimport = {
  id: 'f2',
  lease_id: lease,
  payment_type: 'rent',
  status: 'failed',
  period_start: '2026-08-01T00:00:00.000Z',
  created_at: '2026-08-07T02:35:00.000Z',
  metadata: { source: 'cash_app_import' },
};

const successCard = {
  id: 's1',
  lease_id: lease,
  payment_type: 'rent',
  status: 'succeeded',
  period_start: '2026-08-01T00:00:00.000Z',
  paid_at: '2026-08-03T01:45:00.000Z',
  metadata: { source: 'stripe_card' },
};

const successAchOtherMonth = {
  id: 's2',
  lease_id: lease,
  payment_type: 'rent',
  status: 'succeeded',
  period_start: '2026-07-01T00:00:00.000Z',
  paid_at: '2026-07-05T00:00:00.000Z',
  metadata: { source: 'stripe_ach' },
};

const successDeposit = {
  id: 's3',
  lease_id: lease,
  payment_type: 'security_deposit',
  status: 'succeeded',
  period_start: '2026-08-01T00:00:00.000Z',
  paid_at: '2026-08-02T00:00:00.000Z',
};

assert.strictEqual(
  isFailedSupersededBySuccess(failedCashApp, [failedCashApp]),
  false,
  'failed alone is not superseded'
);

assert.strictEqual(
  isFailedSupersededBySuccess(failedCashApp, [failedCashApp, successCard]),
  true,
  'failed Cash App import disappears after card success (any method)'
);

assert.strictEqual(
  isFailedSupersededBySuccess(failedLaterReimport, [failedCashApp, successCard, failedLaterReimport]),
  true,
  'failed re-import after a success still disappears for that month'
);

assert.strictEqual(
  isFailedSupersededBySuccess(failedCashApp, [failedCashApp, successAchOtherMonth]),
  false,
  'success in another month does not hide this month failed'
);

assert.strictEqual(
  isFailedSupersededBySuccess(failedCashApp, [failedCashApp, successDeposit]),
  false,
  'deposit success does not hide rent failed'
);

const sql = ledgerPaymentWhere('p');
assert.ok(sql.includes("status = 'failed'"), 'ledger SQL mentions failed');
assert.ok(sql.includes('succeeded'), 'ledger SQL checks for succeeded');
assert.ok(notSupersededFailedWhere('p').includes('EXISTS'), 'supersede clause uses EXISTS');

console.log('test-superseded-failed-payments: ok');
