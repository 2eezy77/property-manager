/**
 * Pure Cash App Pay sync policy (GET /api/payments/cashapp/sync).
 * Keeps terminal-failure / utility unlock gates testable without Stripe or DB.
 */

/** Stripe PI statuses that mean the Cash App attempt is done and failed. */
const TERMINAL_CASHAPP_PI_FAILURES = new Set(['canceled', 'requires_payment_method']);

/** Local payment rows that may still be marked failed + unlock utility splits. */
const FAILABLE_LOCAL_STATUSES = new Set(['pending', 'processing']);

function isTerminalCashAppPiFailure(piStatus) {
  return TERMINAL_CASHAPP_PI_FAILURES.has(String(piStatus || ''));
}

/**
 * Enter the sync failure branch only for terminal PI failures, and never after
 * a local succeeded row (stale last_payment_error on processing must not unlock).
 */
function shouldMarkCashAppSyncFailed(piStatus, localStatus) {
  return isTerminalCashAppPiFailure(piStatus) && String(localStatus || '') !== 'succeeded';
}

function isFailableLocalCashAppStatus(localStatus) {
  return FAILABLE_LOCAL_STATUSES.has(String(localStatus || ''));
}

function cashAppSyncFailureReason(pi) {
  return pi?.last_payment_error?.message || 'Cash App payment was not completed.';
}

/** Unlock splits only when the UPDATE returned a utility payment row. */
function shouldUnlockUtilitySplitsOnCashAppSyncFail(updatedRow) {
  return !!updatedRow?.id && updatedRow.payment_type === 'utility';
}

/** Mark utility splits paid only when this sync won the succeed race. */
function shouldMarkUtilityPaidOnCashAppSyncSuccess({ rowCount, paymentType }) {
  return !!rowCount && paymentType === 'utility';
}

module.exports = {
  TERMINAL_CASHAPP_PI_FAILURES,
  FAILABLE_LOCAL_STATUSES,
  isTerminalCashAppPiFailure,
  shouldMarkCashAppSyncFailed,
  isFailableLocalCashAppStatus,
  cashAppSyncFailureReason,
  shouldUnlockUtilitySplitsOnCashAppSyncFail,
  shouldMarkUtilityPaidOnCashAppSyncSuccess,
};
