#!/usr/bin/env node
/**
 * Unit checks for rent/deposit installment amount gates.
 * Run: npm run test:charge-amount-policy
 */
'use strict';

const assert = require('assert');
const {
  MIN_DEPOSIT_INSTALLMENT,
  MIN_RENT_INSTALLMENT,
  resolveDepositChargeAmount,
  resolveRentChargeAmount,
} = require('../src/services/charge-amount-policy');

function expectCode(fn, code) {
  try {
    fn();
    assert.fail(`expected ${code}`);
  } catch (err) {
    assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  }
}

assert.ok(MIN_DEPOSIT_INSTALLMENT >= 1);
assert.ok(MIN_RENT_INSTALLMENT >= 1);

{
  const full = resolveDepositChargeAmount({ remaining: 1200 });
  assert.strictEqual(full.requested, 1200);
  assert.strictEqual(full.remaining, 1200);
  assert.strictEqual(full.isPartial, false);
}

{
  const part = resolveDepositChargeAmount({ amount: 400, remaining: 1200 });
  assert.strictEqual(part.requested, 400);
  assert.strictEqual(part.isPartial, true);
}

{
  const fromString = resolveDepositChargeAmount({ amount: '250.50', remaining: 800 });
  assert.strictEqual(fromString.requested, 250.5);
  assert.strictEqual(fromString.isPartial, true);
}

expectCode(
  () => resolveDepositChargeAmount({ amount: 'nope', remaining: 100 }),
  'INVALID_DEPOSIT_AMOUNT'
);
expectCode(
  () => resolveDepositChargeAmount({ amount: 0.5, remaining: 100 }),
  'INVALID_DEPOSIT_AMOUNT'
);
expectCode(
  () => resolveDepositChargeAmount({ amount: 101, remaining: 100 }),
  'INVALID_DEPOSIT_AMOUNT'
);

{
  const full = resolveRentChargeAmount({ totalRemaining: 900 });
  assert.strictEqual(full.requested, 900);
  assert.strictEqual(full.isPartial, false);
}

{
  const part = resolveRentChargeAmount({ amount: 450, totalRemaining: 900 });
  assert.strictEqual(part.requested, 450);
  assert.strictEqual(part.isPartial, true);
}

expectCode(
  () => resolveRentChargeAmount({ totalRemaining: 0 }),
  'NOTHING_DUE'
);
expectCode(
  () => resolveRentChargeAmount({ amount: '', totalRemaining: 0.005 }),
  'NOTHING_DUE'
);
expectCode(
  () => resolveRentChargeAmount({ amount: 'abc', totalRemaining: 100 }),
  'INVALID_PAYMENT_AMOUNT'
);
expectCode(
  () => resolveRentChargeAmount({ amount: 0.25, totalRemaining: 100 }),
  'INVALID_PAYMENT_AMOUNT'
);
expectCode(
  () => resolveRentChargeAmount({ amount: 100.02, totalRemaining: 100 }),
  'INVALID_PAYMENT_AMOUNT'
);

// Empty string amount means pay remaining (same as omitting amount).
{
  const empty = resolveRentChargeAmount({ amount: '', totalRemaining: 75.25 });
  assert.strictEqual(empty.requested, 75.25);
  assert.strictEqual(empty.isPartial, false);
}

console.log('All charge-amount-policy checks passed.');
