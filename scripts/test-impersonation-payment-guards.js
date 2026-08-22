#!/usr/bin/env node
/**
 * Unit checks for manager "view as tenant" payment guards.
 * Run: node scripts/test-impersonation-payment-guards.js
 */
'use strict';

const assert = require('assert');
const {
  isManagerImpersonation,
  blockManagerPaymentAccess,
  redactPaymentHistoryRow,
} = require('../src/middleware/impersonation');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(isManagerImpersonation({ user: { impersonatorRole: 'property_manager' } }) === true,
  'property_manager impersonator is flagged');
check(isManagerImpersonation({ user: { impersonatorRole: 'owner' } }) === false,
  'owner impersonator is not blocked as manager');
check(isManagerImpersonation({ user: { role: 'property_manager' } }) === false,
  'live manager session without impersonatorRole is not preview');
check(isManagerImpersonation({}) === false, 'missing user is not preview');

{
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const blocked = blockManagerPaymentAccess(
    { user: { impersonatorRole: 'property_manager' } },
    res,
  );
  check(blocked === true, 'manager preview blocks payment access');
  check(res.statusCode === 403, 'manager preview returns 403');
  check(res.body?.error === 'MANAGER_PREVIEW_NO_PAYMENTS', 'manager preview uses stable error code');
}

{
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const blocked = blockManagerPaymentAccess(
    { user: { impersonatorRole: 'owner' } },
    res,
  );
  check(blocked === false, 'owner preview is not blocked by manager guard');
  check(res.statusCode === null && res.body === null, 'owner preview does not write a response');
}

{
  const redacted = redactPaymentHistoryRow({
    id: 'pay_1',
    amount: 450,
    institution_name: 'Navy Federal',
    account_mask: '1234',
    payment_method: 'ach',
  });
  check(redacted.institution_name === undefined, 'redact strips institution_name');
  check(redacted.account_mask === undefined, 'redact strips account_mask');
  check(redacted.amount === 450 && redacted.id === 'pay_1', 'redact keeps non-bank fields');
  check(redacted.payment_method === 'ach', 'redact keeps existing payment_method');
}

{
  const redacted = redactPaymentHistoryRow({
    id: 'pay_2',
    amount: 100,
    institution_name: 'Chase',
    account_mask: '9999',
  });
  check(redacted.payment_method === 'ach', 'redact defaults missing payment_method to ach');
  check(!('institution_name' in redacted) && !('account_mask' in redacted),
    'redact removes bank fields from history row');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll impersonation payment guard checks passed.');
