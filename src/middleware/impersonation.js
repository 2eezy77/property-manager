/**
 * Helpers for staff "view as tenant" preview sessions.
 * Any staff preview must not access bank/payment actions (owners included).
 */

function isManagerImpersonation(req) {
  return req.user?.impersonatorRole === 'property_manager';
}

/** True when the JWT is an impersonated tenant session (any staff actor). */
function isStaffImpersonation(req) {
  return Boolean(req.user?.impersonatedBy);
}

function blockStaffPaymentAccess(req, res) {
  if (isStaffImpersonation(req)) {
    res.status(403).json({
      error: 'PREVIEW_NO_PAYMENTS',
      message: 'Cannot link banks or start payments while previewing a tenant portal. Exit preview and have the tenant pay, or use Manager → Payments to record offline.',
    });
    return true;
  }
  return false;
}

/** @deprecated Use blockStaffPaymentAccess — kept as alias for existing call sites. */
function blockManagerPaymentAccess(req, res) {
  return blockStaffPaymentAccess(req, res);
}

/** Strip linked-bank details from payment history for staff preview. */
function redactPaymentHistoryRow(row) {
  const out = { ...row };
  delete out.institution_name;
  delete out.account_mask;
  if (!out.payment_method) out.payment_method = 'ach';
  return out;
}

module.exports = {
  isManagerImpersonation,
  isStaffImpersonation,
  blockStaffPaymentAccess,
  blockManagerPaymentAccess,
  redactPaymentHistoryRow,
};
