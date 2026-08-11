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
  notArchivedFormerTenantWhere,
  billingMonthKey,
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
assert.ok(sql.includes("archived_former_tenant"), 'ledger SQL excludes archived former-tenant rows');
assert.ok(notSupersededFailedWhere('p').includes('EXISTS'), 'supersede clause uses EXISTS');
assert.ok(
  notArchivedFormerTenantWhere('pay').includes("pay.metadata->>'archived_former_tenant'"),
  'archived former-tenant filter is alias-aware'
);

assert.strictEqual(
  billingMonthKey({ period_start: '2026-08-15T12:00:00.000Z' }),
  '2026-08'
);
assert.strictEqual(
  billingMonthKey({ due_date: '2026-07-04T00:00:00.000Z' }),
  '2026-07',
  'falls back to due_date when period_start missing'
);
assert.strictEqual(billingMonthKey({}), null);

// Archived former-tenant successes must not hide live failed attempts
const archivedSuccess = {
  id: 'arch-s',
  lease_id: lease,
  payment_type: 'rent',
  status: 'succeeded',
  period_start: '2026-08-01T00:00:00.000Z',
  metadata: { archived_former_tenant: true },
};
assert.strictEqual(
  isFailedSupersededBySuccess(failedCashApp, [failedCashApp, archivedSuccess]),
  false,
  'archived former-tenant success does not supersede a live failed row'
);

const archivedSuccessStr = {
  ...archivedSuccess,
  id: 'arch-s2',
  metadata: { archived_former_tenant: 'true' },
};
assert.strictEqual(
  isFailedSupersededBySuccess(failedCashApp, [failedCashApp, archivedSuccessStr]),
  false,
  'archived_former_tenant string "true" also ignored for supersede'
);

console.log('test-superseded-failed-payments: ok');
