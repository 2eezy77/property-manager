/**
 * Pure rent settlement policy — portion allocation + late-fee clear gates.
 * Keep testable without DB/Stripe (used by settleRentPaymentSuccess).
 */

'use strict';

const { parseMoney, roundMoney } = require('../services/security-deposit-partial.service');

function isPartialInstallment(meta = {}) {
  return meta.partial_installment === true || meta.partial_installment === 'true';
}

/**
 * Resolve rent vs late-fee portions from payment metadata.
 * Missing rent_amount → treat full payment amount as rent.
 * Missing late_fee_amount → 0.
 */
function rentSettlementPortions(meta = {}, amount) {
  const rentPortion = Number.isFinite(parseMoney(meta.rent_amount))
    ? roundMoney(parseMoney(meta.rent_amount))
    : roundMoney(amount);
  const lateFeePortion = Number.isFinite(parseMoney(meta.late_fee_amount))
    ? roundMoney(parseMoney(meta.late_fee_amount))
    : 0;
  return {
    rentPortion,
    lateFeePortion,
    isInstallment: isPartialInstallment(meta),
  };
}

/**
 * Legacy full-pay path may wipe open late fees only when:
 * - not an installment
 * - metadata has no late-fee split (portion === 0)
 * - rent portion > 0 and not flagged partial_rent
 * - total_remaining_before is absent (not a known partial payoff)
 * - there are open late fees
 */
function shouldAutoClearLateFeesOnFullPay({
  isInstallment,
  lateFeePortion,
  rentPortion,
  meta = {},
  openLateFeeTotal = 0,
}) {
  if (isInstallment) return false;
  if (!(lateFeePortion === 0 && rentPortion > 0 && !meta.partial_rent)) return false;
  if (meta.total_remaining_before != null) return false;
  return parseFloat(openLateFeeTotal) > 0;
}

/**
 * Prefer metadata.rent_amount so late-fee dollars on the same succeeded charge
 * are not double-counted toward monthly rent remaining (computeChargeBreakdown).
 */
function effectiveRentPaidAmount(amount, rentAmountMeta) {
  const fromMeta = parseMoney(rentAmountMeta);
  if (Number.isFinite(fromMeta)) return roundMoney(fromMeta);
  return roundMoney(amount);
}

function computeRentChargeBreakdown({
  monthlyRent,
  paidThisMonth,
  lateFeeAmount = 0,
}) {
  const rent = roundMoney(monthlyRent);
  const paid = roundMoney(paidThisMonth);
  const fees = roundMoney(lateFeeAmount);
  const rentRemaining = Math.max(0, roundMoney(rent - paid));
  return {
    rentAmount: rentRemaining,
    lateFeeAmount: fees,
    totalAmount: roundMoney(rentRemaining + fees),
    monthlyRent: rent,
    paidThisMonth: paid,
  };
}

module.exports = {
  isPartialInstallment,
  rentSettlementPortions,
  shouldAutoClearLateFeesOnFullPay,
  effectiveRentPaidAmount,
  computeRentChargeBreakdown,
};
