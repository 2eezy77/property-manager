#!/usr/bin/env node
/**
 * Site-visit owner payroll method availability + Stripe Connect error wrapping.
 * Wrong method gates block ACH/Cash App payroll or offer impossible options.
 * Run: npm run test:site-visits-payout-methods
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://unit:unit@127.0.0.1:5432/unit_test_unused';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const {
  buildAvailableOwnerPayMethods,
  wrapStripePayrollError,
  parseYearMonth,
  STRIPE_OWNER_PAY_METHODS,
  PAYMENT_METHODS,
} = require('../src/services/site-visits-payout.service');

assert.ok(STRIPE_OWNER_PAY_METHODS.has('ach'));
assert.ok(STRIPE_OWNER_PAY_METHODS.has('cash_app'));
assert.ok(PAYMENT_METHODS.has('ach'));

// Method matrix — Cash App is the fast associate rail; ACH only when Cash App is unavailable (#58).
assert.deepStrictEqual(
  buildAvailableOwnerPayMethods({
    connectPayoutReady: true,
    cashAppPayAvailable: true,
    propertyBankLinked: true,
  }),
  ['cash_app'],
  'Cash App available → ACH is hidden even if property bank is linked'
);
assert.deepStrictEqual(
  buildAvailableOwnerPayMethods({
    connectPayoutReady: true,
    cashAppPayAvailable: true,
    propertyBankLinked: false,
  }),
  ['cash_app']
);
assert.deepStrictEqual(
  buildAvailableOwnerPayMethods({
    connectPayoutReady: true,
    cashAppPayAvailable: false,
    propertyBankLinked: true,
  }),
  ['ach'],
  'ACH is the fallback when Cash App Pay is unavailable'
);
assert.deepStrictEqual(
  buildAvailableOwnerPayMethods({
    connectPayoutReady: false,
    cashAppPayAvailable: true,
    propertyBankLinked: true,
  }),
  [],
  'Connect not ready → no owner pay methods'
);
assert.deepStrictEqual(
  buildAvailableOwnerPayMethods({
    connectPayoutReady: true,
    cashAppPayAvailable: false,
    propertyBankLinked: false,
  }),
  []
);

// Year/month validation
{
  const ok = parseYearMonth('2026', '8');
  assert.strictEqual(ok.year, 2026);
  assert.strictEqual(ok.month, 8);
}
{
  let threw = null;
  try {
    parseYearMonth('2026', '13');
  } catch (err) {
    threw = err;
  }
  assert.ok(threw);
  assert.strictEqual(threw.statusCode, 400);
}
{
  let threw = null;
  try {
    parseYearMonth(null, null);
  } catch (err) {
    threw = err;
  }
  assert.ok(threw);
  assert.strictEqual(threw.statusCode, 400);
}

// Stripe Connect error sanitization / owner-facing messages
{
  const wrapped = wrapStripePayrollError(
    new Error('You must be signed up for Connect to create accounts')
  );
  assert.strictEqual(wrapped.statusCode, 503);
  assert.strictEqual(wrapped.code, 'CONNECT_NOT_ENABLED');
  assert.match(wrapped.message, /Connect → Get started/i);
}
{
  const wrapped = wrapStripePayrollError(
    new Error('insufficient_capabilities_for_transfer on destination')
  );
  assert.strictEqual(wrapped.statusCode, 503);
  assert.strictEqual(wrapped.code, 'CONNECT_ONBOARDING_REQUIRED');
  assert.match(wrapped.message, /Connect onboarding/i);
}
{
  const original = new Error('card_declined');
  const wrapped = wrapStripePayrollError(original);
  assert.strictEqual(wrapped, original, 'unrelated Stripe errors pass through');
}

console.log('test-site-visits-payout-methods: OK');
