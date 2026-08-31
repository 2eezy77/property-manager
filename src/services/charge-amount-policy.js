/**
 * Pure installment amount gates for tenant rent/deposit charges.
 * Shared by prepareTenantCharge so unit tests can lock min/max/partial rules
 * without Stripe or DB.
 */

'use strict';

const { roundMoney, parseMoney } = require('./security-deposit-partial.service');
const { MIN_RENT_INSTALLMENT } = require('./rent-partial.service');

const MIN_DEPOSIT_INSTALLMENT = 1;

function codedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Resolve how much of an open security deposit to charge.
 * @returns {{ requested: number, remaining: number, isPartial: boolean }}
 */
function resolveDepositChargeAmount({
  amount,
  remaining,
  minInstallment = MIN_DEPOSIT_INSTALLMENT,
} = {}) {
  const remainingRounded = roundMoney(remaining);
  const requestedRaw = amount == null || amount === '' ? remainingRounded : parseMoney(amount);
  if (!Number.isFinite(requestedRaw)) {
    throw codedError('Enter a valid deposit amount.', 'INVALID_DEPOSIT_AMOUNT');
  }
  const requested = roundMoney(requestedRaw);
  if (requested < minInstallment) {
    throw codedError(
      `Minimum deposit payment is $${Number(minInstallment).toFixed(2)}.`,
      'INVALID_DEPOSIT_AMOUNT'
    );
  }
  if (requested > remainingRounded + 0.001) {
    throw codedError(
      `Deposit payment cannot exceed the $${remainingRounded.toFixed(2)} still owed.`,
      'INVALID_DEPOSIT_AMOUNT'
    );
  }
  return {
    requested,
    remaining: remainingRounded,
    isPartial: requested < remainingRounded - 0.001,
  };
}

/**
 * Resolve how much of rent remaining + late fees to charge.
 * @returns {{ requested: number, totalRemaining: number, isPartial: boolean }}
 */
function resolveRentChargeAmount({
  amount,
  totalRemaining,
  minInstallment = MIN_RENT_INSTALLMENT,
} = {}) {
  // Match prepareTenantCharge: treat dust balances as nothing due before rounding.
  if (!(Number(totalRemaining) > 0.009)) {
    throw codedError('Nothing is due for this period.', 'NOTHING_DUE');
  }
  const total = roundMoney(totalRemaining);
  const requestedRaw = amount == null || amount === '' ? total : parseMoney(amount);
  if (!Number.isFinite(requestedRaw)) {
    throw codedError('Enter a valid payment amount.', 'INVALID_PAYMENT_AMOUNT');
  }
  const requested = roundMoney(requestedRaw);
  if (requested < minInstallment) {
    throw codedError(
      `Minimum payment is $${Number(minInstallment).toFixed(2)}.`,
      'INVALID_PAYMENT_AMOUNT'
    );
  }
  if (requested > total + 0.001) {
    throw codedError(
      `Payment cannot exceed the $${total.toFixed(2)} still owed.`,
      'INVALID_PAYMENT_AMOUNT'
    );
  }
  return {
    requested,
    totalRemaining: total,
    isPartial: requested < total - 0.001,
  };
}

module.exports = {
  MIN_DEPOSIT_INSTALLMENT,
  MIN_RENT_INSTALLMENT,
  resolveDepositChargeAmount,
  resolveRentChargeAmount,
};
