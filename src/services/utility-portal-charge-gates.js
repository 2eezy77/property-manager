/**
 * Pure validation for tenant portal utility charges (no DB / Stripe).
 * Keeps prepareUtilityPortalCharge eligibility deterministic and unit-testable.
 */

/** Split statuses eligible for portal pay when payment_id is null. */
const PAYABLE_SPLIT_STATUSES = ['pending', 'notified', 'disputed', 'failed'];

function nothingDueError(message = 'No open utility balance to pay.') {
  const err = new Error(message);
  err.code = 'NOTHING_DUE';
  return err;
}

function leaseMismatchError(message = 'Utility shares must match the selected lease.') {
  const err = new Error(message);
  err.code = 'LEASE_MISMATCH';
  return err;
}

function leaseNotFoundError(message = 'LEASE_NOT_FOUND') {
  const err = new Error(message);
  err.code = 'LEASE_NOT_FOUND';
  return err;
}

/**
 * Active lease must belong to the paying tenant.
 * @param {object|null|undefined} lease
 */
function assertLeaseReadyForPortalCharge(lease) {
  if (!lease || lease.status !== 'active') {
    throw leaseNotFoundError();
  }
  return true;
}

/**
 * After FOR UPDATE fetch: splits must be open, match the lease, and sum to a payable amount.
 * @returns {{ amountDollars: number, amountCents: number, description: string, splitIds: string[], billIds: string[], dueDate: string|null }}
 */
function assertSplitsReadyForPortalCharge(splits, { leaseId } = {}) {
  if (!splits?.length) {
    throw nothingDueError();
  }

  if (splits.some((s) => s.lease_id !== leaseId)) {
    throw leaseMismatchError();
  }

  if (
    splits.some(
      (s) =>
        s.payment_id != null
        || !PAYABLE_SPLIT_STATUSES.includes(String(s.split_status))
    )
  ) {
    throw nothingDueError();
  }

  const amountDollars = Math.round(
    splits.reduce((sum, s) => sum + Number(s.amount || 0), 0) * 100
  ) / 100;
  if (amountDollars <= 0.009) {
    throw nothingDueError();
  }

  const amountCents = Math.round(amountDollars * 100);
  const services = [...new Set(splits.map((s) => s.service_type))];
  const description = services.length === 1
    ? `Utility share (${services[0]})`
    : `Utility shares (${services.join(', ')})`;

  const splitIds = splits.map((s) => s.split_id);
  const billIds = [...new Set(splits.map((s) => s.bill_id))];
  const dueDate = splits.map((s) => s.due_date).filter(Boolean).sort()[0] || null;

  return {
    amountDollars,
    amountCents,
    description,
    splitIds,
    billIds,
    dueDate,
  };
}

/**
 * Claim UPDATE must lock every intended split (race / stale payment_id).
 */
function assertPortalChargeClaimComplete(claimed, splitIds) {
  if (Number(claimed) !== (splitIds || []).length) {
    throw nothingDueError();
  }
  return true;
}

module.exports = {
  PAYABLE_SPLIT_STATUSES,
  assertLeaseReadyForPortalCharge,
  assertSplitsReadyForPortalCharge,
  assertPortalChargeClaimComplete,
  leaseNotFoundError,
  leaseMismatchError,
  nothingDueError,
};
