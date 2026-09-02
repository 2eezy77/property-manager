/**
 * Shared installment amount gates for rent and security-deposit charges.
 * Empty/omitted amount → pay remaining; reject invalid, below-min, and over-remaining.
 */

const { roundMoney, parseMoney } = require('./security-deposit-partial.service');

/**
 * @param {object} opts
 * @param {unknown} opts.amount - requested dollars (null/'' = full remaining)
 * @param {number} opts.remaining - dollars still owed
 * @param {number} opts.minAmount - minimum installment
 * @param {string} opts.invalidCode - err.code for invalid / min / over
 * @param {string} [opts.invalidMessage]
 * @param {string} [opts.minMessage]
 * @param {string} [opts.overMessage]
 * @returns {number} rounded requested dollars
 */
function resolveInstallmentAmount({
  amount,
  remaining,
  minAmount,
  invalidCode,
  invalidMessage = 'Enter a valid payment amount.',
  minMessage,
  overMessage,
}) {
  const remainingRounded = roundMoney(remaining);
  const requestedRaw = amount == null || amount === ''
    ? remainingRounded
    : parseMoney(amount);

  if (!Number.isFinite(requestedRaw)) {
    const err = new Error(invalidMessage);
    err.code = invalidCode;
    throw err;
  }

  const requested = roundMoney(requestedRaw);

  if (requested < minAmount) {
    const err = new Error(
      minMessage || `Minimum payment is $${Number(minAmount).toFixed(2)}.`
    );
    err.code = invalidCode;
    throw err;
  }

  if (requested > remainingRounded + 0.001) {
    const err = new Error(
      overMessage
        || `Payment cannot exceed the $${remainingRounded.toFixed(2)} still owed.`
    );
    err.code = invalidCode;
    throw err;
  }

  return requested;
}

function resolveRentInstallmentAmount(amount, remainingDue, minAmount) {
  return resolveInstallmentAmount({
    amount,
    remaining: remainingDue,
    minAmount,
    invalidCode: 'INVALID_PAYMENT_AMOUNT',
    invalidMessage: 'Enter a valid payment amount.',
    minMessage: `Minimum payment is $${Number(minAmount).toFixed(2)}.`,
    overMessage: `Payment cannot exceed the $${roundMoney(remainingDue).toFixed(2)} still owed.`,
  });
}

function resolveDepositInstallmentAmount(amount, remainingDue, minAmount) {
  return resolveInstallmentAmount({
    amount,
    remaining: remainingDue,
    minAmount,
    invalidCode: 'INVALID_DEPOSIT_AMOUNT',
    invalidMessage: 'Enter a valid deposit amount.',
    minMessage: `Minimum deposit payment is $${Number(minAmount).toFixed(2)}.`,
    overMessage: `Deposit payment cannot exceed the $${roundMoney(remainingDue).toFixed(2)} still owed.`,
  });
}

module.exports = {
  resolveInstallmentAmount,
  resolveRentInstallmentAmount,
  resolveDepositInstallmentAmount,
};
