#!/usr/bin/env node
/**
 * Regression: rent settlement portions + late-fee auto-clear gates +
 * charge breakdown preferring metadata.rent_amount (no double-count).
 * Pure helpers — no DB/Stripe.
 *
 * Run: npm run test:rent-settlement-policy
 */
'use strict';

const assert = require('assert');
const {
  isPartialInstallment,
  rentSettlementPortions,
  shouldAutoClearLateFeesOnFullPay,
  effectiveRentPaidAmount,
  computeRentChargeBreakdown,
} = require('../src/utils/rent-settlement-policy');

assert.strictEqual(isPartialInstallment({ partial_installment: true }), true);
assert.strictEqual(isPartialInstallment({ partial_installment: 'true' }), true);
assert.strictEqual(isPartialInstallment({ partial_installment: false }), false);
assert.strictEqual(isPartialInstallment({}), false);

// Missing rent_amount → full payment is rent; missing late fee → 0
{
  const p = rentSettlementPortions({}, 1050);
  assert.strictEqual(p.rentPortion, 1050);
  assert.strictEqual(p.lateFeePortion, 0);
  assert.strictEqual(p.isInstallment, false);
}

// Explicit split: $900 rent + $150 late fee on a $1050 charge
{
  const p = rentSettlementPortions(
    { rent_amount: '900.00', late_fee_amount: '150.00' },
    1050
  );
  assert.strictEqual(p.rentPortion, 900);
  assert.strictEqual(p.lateFeePortion, 150);
}

// Installment string flag
{
  const p = rentSettlementPortions(
    { partial_installment: 'true', rent_amount: '400', late_fee_amount: '0' },
    400
  );
  assert.strictEqual(p.isInstallment, true);
  assert.strictEqual(p.rentPortion, 400);
}

// Legacy full-pay: wipe open late fees when no fee split / partial flags
assert.strictEqual(
  shouldAutoClearLateFeesOnFullPay({
    isInstallment: false,
    lateFeePortion: 0,
    rentPortion: 900,
    meta: {},
    openLateFeeTotal: 150,
  }),
  true
);

// Do NOT wipe when metadata allocated late fees (applyLateFeeCredits path)
assert.strictEqual(
  shouldAutoClearLateFeesOnFullPay({
    isInstallment: false,
    lateFeePortion: 150,
    rentPortion: 900,
    meta: { late_fee_amount: '150.00' },
    openLateFeeTotal: 150,
  }),
  false
);

// Do NOT wipe installments / partial_rent / known remaining-before
assert.strictEqual(
  shouldAutoClearLateFeesOnFullPay({
    isInstallment: true,
    lateFeePortion: 0,
    rentPortion: 400,
    meta: { partial_installment: true },
    openLateFeeTotal: 150,
  }),
  false
);
assert.strictEqual(
  shouldAutoClearLateFeesOnFullPay({
    isInstallment: false,
    lateFeePortion: 0,
    rentPortion: 400,
    meta: { partial_rent: true },
    openLateFeeTotal: 150,
  }),
  false
);
assert.strictEqual(
  shouldAutoClearLateFeesOnFullPay({
    isInstallment: false,
    lateFeePortion: 0,
    rentPortion: 900,
    meta: { total_remaining_before: '1050.00' },
    openLateFeeTotal: 150,
  }),
  false
);
assert.strictEqual(
  shouldAutoClearLateFeesOnFullPay({
    isInstallment: false,
    lateFeePortion: 0,
    rentPortion: 900,
    meta: {},
    openLateFeeTotal: 0,
  }),
  false
);

// Prefer rent_amount so $150 late fee on same PI is not counted as rent paid
assert.strictEqual(effectiveRentPaidAmount(1050, '900.00'), 900);
assert.strictEqual(effectiveRentPaidAmount(1050, null), 1050);
assert.strictEqual(effectiveRentPaidAmount(1050, ''), 1050);
assert.strictEqual(effectiveRentPaidAmount('400.50', '400.50'), 400.5);

// Charge breakdown: one $1050 succeeded charge with rent_amount=900 → $0 rent left + fees
{
  const paid = effectiveRentPaidAmount(1050, '900.00');
  const b = computeRentChargeBreakdown({
    monthlyRent: 900,
    paidThisMonth: paid,
    lateFeeAmount: 0,
  });
  assert.strictEqual(b.paidThisMonth, 900);
  assert.strictEqual(b.rentAmount, 0);
  assert.strictEqual(b.totalAmount, 0);
}

// Without rent_amount preference, $1050 would over-credit rent and hide remaining...
// (regression: late-fee dollars must not reduce rent remaining twice)
{
  const overcount = effectiveRentPaidAmount(1050, null);
  const b = computeRentChargeBreakdown({
    monthlyRent: 900,
    paidThisMonth: overcount,
    lateFeeAmount: 150,
  });
  assert.strictEqual(b.rentAmount, 0);
  assert.strictEqual(b.lateFeeAmount, 150);
  assert.strictEqual(b.totalAmount, 150);
}

{
  const b = computeRentChargeBreakdown({
    monthlyRent: 900,
    paidThisMonth: 400,
    lateFeeAmount: 50,
  });
  assert.strictEqual(b.rentAmount, 500);
  assert.strictEqual(b.totalAmount, 550);
}

console.log('test-rent-settlement-policy: OK');
