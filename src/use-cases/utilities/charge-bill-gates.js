/** Pure validation for UC06 charge-bill (no DB / Stripe). */

const { useCaseError } = require('./errors');

/**
 * Assert the bill exists and the actor can access its property.
 */
function assertBillAccessibleForCharge({ bill, accessiblePropertyIds = [] } = {}) {
  if (!bill || !accessiblePropertyIds.includes(bill.property_id)) {
    throw useCaseError('NOT_FOUND', 'Bill not found.');
  }
  return true;
}

/**
 * Assert a utility bill is in a chargeable state.
 * @param {object} opts
 * @param {object} opts.bill
 * @param {boolean} [opts.force]
 * @param {Date} [opts.now] — used for dispute deadline comparison
 * @param {(bill: object) => boolean} [opts.isElectricChargeable] — injected for tests
 */
function assertChargeBillReady({
  bill,
  force = false,
  now = new Date(),
  isElectricChargeable,
} = {}) {
  if (bill.status !== 'notified' && bill.status !== 'charging') {
    throw useCaseError(
      'INVALID_STATE',
      `Bill is ${bill.status}; only notified bills can be charged.`
    );
  }
  if (!force && bill.dispute_deadline_at && new Date(bill.dispute_deadline_at) > now) {
    throw useCaseError(
      'DEADLINE_NOT_REACHED',
      'Dispute deadline has not passed. Pass force=true to charge anyway.'
    );
  }
  if (
    !force
    && bill.service_type === 'electric'
    && typeof isElectricChargeable === 'function'
    && !isElectricChargeable(bill)
  ) {
    const after = bill.chargeable_after || bill.period_end;
    throw useCaseError(
      'BILLING_PERIOD_OPEN',
      `Electric bill billing period has not ended yet. Charge on or after ${after}, or pass force=true.`
    );
  }
  return true;
}

/**
 * Return a skip reason for a notified split that cannot be ACH-charged yet.
 * @returns {string|null}
 */
function classifyEligibleSplitSkip(split) {
  if (!split?.bank_account_id) return 'NO_VERIFIED_BANK';
  if (split.link_status === 'needs_relink') return 'ACCOUNT_NEEDS_RELINK';
  return null;
}

module.exports = {
  assertBillAccessibleForCharge,
  assertChargeBillReady,
  classifyEligibleSplitSkip,
};
