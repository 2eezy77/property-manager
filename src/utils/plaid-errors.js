/** Safe Plaid / Stripe error text for API responses (no tokens). */
function partnerErrorMessage(err, fallback) {
  const plaid = err.response?.data;
  if (typeof plaid?.error_message === 'string' && plaid.error_message) {
    return plaid.error_message;
  }
  if (typeof plaid?.display_message === 'string' && plaid.display_message) {
    return plaid.display_message;
  }
  if (err.type?.startsWith?.('Stripe') && typeof err.message === 'string') {
    return err.message;
  }
  if (typeof err.message === 'string' && err.message && !err.message.includes('access_token')) {
    return err.message;
  }
  return fallback;
}

module.exports = { partnerErrorMessage };
