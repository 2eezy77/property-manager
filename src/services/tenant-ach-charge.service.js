/**
 * Decide how tenant ACH reaches Stripe.
 * Saved us_bank_account PaymentMethods are charged directly; Plaid Auth numbers
 * are only fetched when no Stripe PM is on file. Plaid Signal is optional.
 */

function resolveAchChargeSource(account = {}) {
  const customerId = account.stripe_customer_id || null;
  const paymentMethodId = account.stripe_bank_account_id || null;
  const hasPlaid = Boolean(
    account.plaid_access_token_encrypted && account.plaid_account_id
  );

  return {
    customerId,
    paymentMethodId,
    needsPlaidNumbers: !paymentMethodId,
    canRunSignal: hasPlaid,
  };
}

module.exports = {
  resolveAchChargeSource,
};
