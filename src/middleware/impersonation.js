/**
 * Helpers for staff "view as tenant" preview sessions.
 * Property managers may preview the portal but must not access bank/payment actions.
 */

function isManagerImpersonation(req) {
  return req.user?.impersonatorRole === 'property_manager';
}

function blockManagerPaymentAccess(req, res) {
  if (isManagerImpersonation(req)) {
    res.status(403).json({
      error:   'MANAGER_PREVIEW_NO_PAYMENTS',
      message: 'Managers cannot access tenant bank accounts or initiate payments in preview mode.',
    });
    return true;
  }
  return false;
}

/** Strip linked-bank details from payment history for manager preview. */
function redactPaymentHistoryRow(row) {
  const out = { ...row };
  delete out.institution_name;
  delete out.account_mask;
  if (!out.payment_method) out.payment_method = 'ach';
  return out;
}

module.exports = {
  isManagerImpersonation,
  blockManagerPaymentAccess,
  redactPaymentHistoryRow,
};
