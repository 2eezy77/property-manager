/**
 * Tenant-paid processing fee for Card / Cash App Pay.
 * ACH and Autopay have no convenience fee.
 *
 * Stripe-style pass-through: 2.9% + $0.30 added on top of the base amount
 * so processor costs come from the tenant, not the property.
 */

const RATE = 0.029;
const FIXED_CENTS = 30;

/**
 * @param {number} baseCents — rent/deposit cents (ledger amount)
 * @returns {{
 *   baseCents: number,
 *   feeCents: number,
 *   totalCents: number,
 *   baseAmount: number,
 *   processingFee: number,
 *   totalAmount: number,
 *   rate: number,
 *   fixedCents: number,
 * }}
 */
function computeCardCashAppFee(baseCents) {
  const base = Math.round(Number(baseCents));
  if (!Number.isFinite(base) || base < 0) {
    throw new Error('INVALID_BASE_CENTS');
  }
  const feeCents = Math.round(base * RATE) + FIXED_CENTS;
  const totalCents = base + feeCents;
  return {
    baseCents: base,
    feeCents,
    totalCents,
    baseAmount: base / 100,
    processingFee: feeCents / 100,
    totalAmount: totalCents / 100,
    rate: RATE,
    fixedCents: FIXED_CENTS,
  };
}

function feeSchedulePublic() {
  return {
    cardCashApp: {
      rate: RATE,
      fixedCents: FIXED_CENTS,
      label: '2.9% + $0.30',
      appliesTo: ['card', 'cash_app'],
    },
    ach: {
      rate: 0,
      fixedCents: 0,
      label: 'No processing fee',
      appliesTo: ['ach'],
    },
  };
}

/** Metadata fields to merge onto payment / PaymentIntent */
function feeMetadata(fee) {
  return {
    processing_fee: fee.processingFee.toFixed(2),
    processing_fee_cents: String(fee.feeCents),
    base_amount: fee.baseAmount.toFixed(2),
    charged_total: fee.totalAmount.toFixed(2),
    processing_fee_formula: '2.9%+$0.30',
  };
}

module.exports = {
  RATE,
  FIXED_CENTS,
  computeCardCashAppFee,
  feeSchedulePublic,
  feeMetadata,
};
