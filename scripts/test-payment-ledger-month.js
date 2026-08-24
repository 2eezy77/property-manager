#!/usr/bin/env node
/**
 * Payment ledger month keys + former-tenant archive edges.
 * Complements test-superseded-failed-payments.js (method supersession).
 * Run: node scripts/test-payment-ledger-month.js
 */
'use strict';

const assert = require('assert');
const {
  billingMonthKey,
  isFailedSupersededBySuccess,
  notArchivedFormerTenantWhere,
  ledgerPaymentWhere,
} = require('../src/utils/payment-ledger');

assert.strictEqual(
  billingMonthKey({ period_start: '2026-08-15T12:00:00.000Z' }),
  '2026-08'
);
assert.strictEqual(
  billingMonthKey({ due_date: '2026-07-01T00:00:00.000Z' }),
  '2026-07'
);
assert.strictEqual(
  billingMonthKey({
    period_start: null,
    due_date: null,
    paid_at: '2026-06-20T18:00:00.000Z',
  }),
  '2026-06'
);
assert.strictEqual(billingMonthKey({}), null);
assert.strictEqual(billingMonthKey({ period_start: 'not-a-date' }), null);

const lease = 'lease-1';
const failed = {
  id: 'f1',
  lease_id: lease,
  payment_type: 'rent',
  status: 'failed',
  period_start: '2026-06-01T00:00:00.000Z',
  metadata: { source: 'cash_app_import' },
};
const archivedSuccess = {
  id: 's-arch',
  lease_id: lease,
  payment_type: 'rent',
  status: 'succeeded',
  period_start: '2026-06-01T00:00:00.000Z',
  metadata: { archived_former_tenant: true },
};
const archivedSuccessStr = {
  ...archivedSuccess,
  id: 's-arch-str',
  metadata: { archived_former_tenant: 'true' },
};
const liveSuccess = {
  id: 's-live',
  lease_id: lease,
  payment_type: 'rent',
  status: 'succeeded',
  period_start: '2026-06-01T00:00:00.000Z',
  metadata: { source: 'stripe_card' },
};

assert.strictEqual(
  isFailedSupersededBySuccess(failed, [failed, archivedSuccess]),
  false,
  'archived former-tenant success must not hide live failed rows'
);
assert.strictEqual(
  isFailedSupersededBySuccess(failed, [failed, archivedSuccessStr]),
  false,
  'archived_former_tenant string true likewise does not supersede'
);
assert.strictEqual(
  isFailedSupersededBySuccess(failed, [failed, archivedSuccess, liveSuccess]),
  true,
  'live success still supersedes after ignoring archive rows'
);

const archiveSql = notArchivedFormerTenantWhere('p');
assert.ok(archiveSql.includes("archived_former_tenant"), 'archive filter present');
assert.ok(archiveSql.includes("<> 'true'"), 'archive excludes true');

const ledgerSql = ledgerPaymentWhere('pay');
assert.ok(ledgerSql.includes('archived_former_tenant'), 'ledger hides archived former tenants');
assert.ok(ledgerSql.includes("metadata->>'test'"), 'ledger hides smoke-test rows');
assert.ok(ledgerSql.includes('pay.lease_id'), 'alias is applied');

console.log('test-payment-ledger-month: ok');
