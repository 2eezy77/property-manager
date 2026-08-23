/**
 * Client estimate matching server 2.9% + $0.30
 * (`src/services/payment-processing-fee.service.js`).
 * Server is source of truth at create-intent / charge time.
 */

const RATE = 0.029;
const FIXED_CENTS = 30;

/**
 * @param {number|string|null|undefined} baseAmount dollars (rent/deposit/utility/identity base)
 * @returns {{ baseAmount: number, processingFee: number, totalAmount: number }}
 */
export function estimateCardCashAppTotal(baseAmount) {
  const baseCents = Math.round(Number(baseAmount) * 100);
  if (!Number.isFinite(baseCents) || baseCents < 0) {
    return { baseAmount: 0, processingFee: 0, totalAmount: 0 };
  }
  const feeCents = Math.round(baseCents * RATE) + FIXED_CENTS;
  return {
    baseAmount: baseCents / 100,
    processingFee: feeCents / 100,
    totalAmount: (baseCents + feeCents) / 100,
  };
}

export { RATE, FIXED_CENTS };
