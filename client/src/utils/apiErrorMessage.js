/**
 * Normalize Axios / fetch errors into user-facing copy.
 */

/** Fallback copy when API returns a code without a message. */
export const PAYMENT_ERROR_MESSAGES = {
  ACH_RISK_BLOCKED:
    'This bank account cannot be debited right now due to elevated return risk. Try another account or pay with Cash App.',
  INSUFFICIENT_BALANCE:
    'Your account does not have enough available balance for this payment.',
  ACCOUNT_NEEDS_RELINK:
    'Your bank connection expired. Reconnect your account on the Payments page before paying.',
  ACCOUNT_NOT_VERIFIED:
    'Your bank account is still being verified. Try again once verification completes.',
  PROPERTY_BANK_NEEDS_RELINK:
    'Property bank connection expired. Go to Finance → Property account and reconnect via Plaid.',
  NO_PROPERTY_BANK:
    'Link your property operating account under Finance before paying via ACH.',
  DUPLICATE_PAYMENT:
    'A payment for this period is already in progress or complete.',
  CASHAPP_NOT_CONFIGURED:
    'Cash App Pay is not available right now. Pay with bank (ACH) or contact your property manager.',
  CONNECT_ONBOARDING_REQUIRED:
    'Complete Stripe payout setup on the manager Boots on site page before paying.',
  CONNECT_NOT_ENABLED:
    'Stripe Connect is not enabled on this account. Contact the platform owner.',
  CHARGE_FAILED:
    'Payment could not be initiated. Please try again or use another payment method.',
};

export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;

  if (!err.response) {
    if (err.code === 'ECONNABORTED') return 'Request timed out. Check your connection and try again.';
    return 'Unable to reach the server. Check your connection and try again.';
  }

  const { status, data } = err.response;
  const code = data?.error;
  const msg = data?.message;

  if (typeof msg === 'string' && msg.length > 0) return msg;
  if (code && PAYMENT_ERROR_MESSAGES[code]) return PAYMENT_ERROR_MESSAGES[code];

  if (status === 429) {
    return 'Too many requests. Please wait a few minutes and try again.';
  }
  if (status === 403) {
    return 'You do not have permission to perform this action.';
  }
  if (status >= 500) {
    return 'The server encountered an error. Please try again later.';
  }
  if (typeof code === 'string' && code.length > 0 && !/^[A-Z_]+$/.test(code)) return code;
  return fallback;
}
