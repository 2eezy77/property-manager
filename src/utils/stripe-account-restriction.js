/**
 * Detect Stripe Connect / platform account restriction errors.
 * Used when card/Cash App intent create fails because charges are disabled
 * or a capability is not active — map to a clearer client message.
 */
function isStripeAccountRestrictionError(err) {
  return /charges_enabled|charges enabled|account.*restricted|capabilit/i.test(
    `${err?.code || ''} ${err?.message || ''} ${err?.raw?.message || ''}`
  );
}

module.exports = { isStripeAccountRestrictionError };
