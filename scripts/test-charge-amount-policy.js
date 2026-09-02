#!/usr/bin/env node
/**
 * Rent/deposit installment amount gates (empty → remaining; min/over/invalid).
 * Run: node scripts/test-charge-amount-policy.js
 */
'use strict';

const assert = require('assert');
const {
  resolveInstallmentAmount,
  resolveRentInstallmentAmount,
  resolveDepositInstallmentAmount,
} = require('../src/services/charge-amount-policy');
const { MIN_RENT_INSTALLMENT } = require('../src/services/rent-partial.service');

// Mirrors src/services/rent-charge.service.js (avoid loading Stripe/DB for this unit test).
const MIN_DEPOSIT_INSTALLMENT = 1;

function throwsCode(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || null;
  }
}

assert.strictEqual(MIN_RENT_INSTALLMENT, 1);
assert.strictEqual(MIN_DEPOSIT_INSTALLMENT, 1);

// Omit / empty amount pays remaining
assert.strictEqual(resolveRentInstallmentAmount(null, 450, MIN_RENT_INSTALLMENT), 450);
assert.strictEqual(resolveRentInstallmentAmount(undefined, 450, MIN_RENT_INSTALLMENT), 450);
assert.strictEqual(resolveRentInstallmentAmount('', 450, MIN_RENT_INSTALLMENT), 450);
assert.strictEqual(resolveDepositInstallmentAmount(null, 1200, MIN_DEPOSIT_INSTALLMENT), 1200);

// Partial installment
assert.strictEqual(resolveRentInstallmentAmount(200, 450, MIN_RENT_INSTALLMENT), 200);
assert.strictEqual(resolveRentInstallmentAmount('199.995', 450, MIN_RENT_INSTALLMENT), 200);
assert.strictEqual(resolveDepositInstallmentAmount(400, 1200, MIN_DEPOSIT_INSTALLMENT), 400);

// Invalid / non-finite
assert.strictEqual(
  throwsCode(() => resolveRentInstallmentAmount('nope', 450, MIN_RENT_INSTALLMENT)),
  'INVALID_PAYMENT_AMOUNT'
);
assert.strictEqual(
  throwsCode(() => resolveDepositInstallmentAmount('abc', 1200, MIN_DEPOSIT_INSTALLMENT)),
  'INVALID_DEPOSIT_AMOUNT'
);

// Below minimum
assert.strictEqual(
  throwsCode(() => resolveRentInstallmentAmount(0.5, 450, MIN_RENT_INSTALLMENT)),
  'INVALID_PAYMENT_AMOUNT'
);
assert.strictEqual(
  throwsCode(() => resolveDepositInstallmentAmount(0, 1200, MIN_DEPOSIT_INSTALLMENT)),
  'INVALID_DEPOSIT_AMOUNT'
);

// Over remaining
assert.strictEqual(
  throwsCode(() => resolveRentInstallmentAmount(451, 450, MIN_RENT_INSTALLMENT)),
  'INVALID_PAYMENT_AMOUNT'
);
assert.strictEqual(
  throwsCode(() => resolveDepositInstallmentAmount(1200.02, 1200, MIN_DEPOSIT_INSTALLMENT)),
  'INVALID_DEPOSIT_AMOUNT'
);

// Exact remaining is allowed (within 0.001 float slack)
assert.strictEqual(resolveRentInstallmentAmount(450, 450, MIN_RENT_INSTALLMENT), 450);
assert.strictEqual(resolveRentInstallmentAmount(450.0005, 450, MIN_RENT_INSTALLMENT), 450);

// Generic helper custom messages
try {
  resolveInstallmentAmount({
    amount: 0.25,
    remaining: 10,
    minAmount: 1,
    invalidCode: 'CUSTOM',
    minMessage: 'Need at least a dollar.',
  });
  assert.fail('expected throw');
} catch (err) {
  assert.strictEqual(err.code, 'CUSTOM');
  assert.match(err.message, /Need at least a dollar/);
}

console.log('ok: charge-amount-policy');
