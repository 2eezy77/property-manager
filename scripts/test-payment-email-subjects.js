#!/usr/bin/env node
/**
 * Payment notification subject lines + tenant display name.
 * Complements template body coverage (open #88) with service-level subjects.
 *
 * Run: npm run test:payment-email-subjects
 */
'use strict';

const assert = require('assert');
const {
  tenantDisplayName,
  paymentReceivedSubjects,
  paymentFailedSubjects,
  rentDueSubject,
  rentOverdueSubject,
  lateFeeSubjects,
} = require('../src/services/payment-email-subjects');

assert.strictEqual(tenantDisplayName({ tenant_first: 'Stone', tenant_last: 'Buckley' }), 'Stone Buckley');
assert.strictEqual(tenantDisplayName({ tenant_first: 'Lily', tenant_last: '' }), 'Lily');
assert.strictEqual(tenantDisplayName({}), 'Tenant');
assert.strictEqual(tenantDisplayName(null), 'Tenant');

{
  const rent = paymentReceivedSubjects({ amount: 900, paymentType: 'rent', tenant: 'Isaiah' });
  assert.strictEqual(rent.tenantSubject, 'Rent payment confirmed - $900.00');
  assert.strictEqual(rent.staffSubject, 'Isaiah - rent payment received ($900.00)');
}

{
  const util = paymentReceivedSubjects({ amount: 42.5, paymentType: 'utility', tenant: 'Lily' });
  assert.strictEqual(util.tenantSubject, 'Utility payment confirmed - $42.50');
  assert.strictEqual(util.staffSubject, 'Lily - utility payment received ($42.50)');
}

{
  const rent = paymentFailedSubjects({ amount: 900, paymentType: 'rent', tenant: 'Ada' });
  assert.strictEqual(rent.tenantSubject, 'Rent payment failed - $900.00');
  assert.strictEqual(rent.staffSubject, 'Payment failed - Ada ($900.00)');
}

{
  const util = paymentFailedSubjects({ amount: 55, paymentType: 'utility', tenant: 'Isaiah' });
  assert.strictEqual(util.tenantSubject, 'Utility payment failed - $55.00');
  assert.strictEqual(util.staffSubject, 'Payment failed - Isaiah ($55.00)');
}

{
  const due = rentDueSubject({ amount: 900, dueDate: '2026-09-01' });
  assert.strictEqual(due.dueStr, 'September 1, 2026');
  assert.strictEqual(due.subject, 'Rent due September 1, 2026 - $900.00');
}

{
  const missing = rentDueSubject({ amount: 900, dueDate: null });
  assert.strictEqual(missing.dueStr, 'this month');
  assert.ok(missing.subject.includes('this month'));
}

{
  const overdue = rentOverdueSubject({ amount: 900, gracePeriodDays: 5 });
  assert.strictEqual(
    overdue.subject,
    'Overdue rent - $900.00 (late fees after 5-day grace)'
  );
}

{
  // Flexible rent (Stone): 31-day grace must appear in the overdue subject.
  const stone = rentOverdueSubject({ amount: 450, gracePeriodDays: 31 });
  assert.strictEqual(
    stone.subject,
    'Overdue rent - $450.00 (late fees after 31-day grace)'
  );
}

{
  const late = lateFeeSubjects({ amount: 150, tenant: 'Isaiah' });
  assert.strictEqual(late.tenantSubject, 'Late fee applied - $150.00');
  assert.strictEqual(late.staffSubject, 'Late fee applied - Isaiah ($150.00)');
}

console.log('All payment-email-subjects checks passed.');
