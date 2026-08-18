const DTM_USE_CASE_URL = 'https://dashboard.plaid.com/link/data-transparency-v5';

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

/**
 * Link-token create failures. DTM v5 returns INVALID_LINK_CUSTOMIZATION when
 * the Dashboard customization has no published use case — replace that with
 * an actionable Dashboard URL instead of Plaid's raw sentence.
 */
function linkTokenCreateErrorMessage(err, fallback) {
  const code = err.response?.data?.error_code;
  if (code === 'INVALID_LINK_CUSTOMIZATION') {
    return `Plaid Link needs a Data Transparency use case in the Dashboard (${DTM_USE_CASE_URL}) before bank linking will work.`;
  }
  return partnerErrorMessage(err, fallback);
}

module.exports = { partnerErrorMessage, linkTokenCreateErrorMessage, DTM_USE_CASE_URL };
