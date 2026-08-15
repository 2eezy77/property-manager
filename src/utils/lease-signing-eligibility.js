/**
 * Pure lease-signing fee eligibility helpers (no DB).
 * Manager $350 fee cancels when the tenant leaves before 3 rent months.
 */

'use strict';

const ENDED_LEASE_STATUSES = new Set(['terminated', 'expired']);
const RENT_MONTHS_REQUIRED = 3;

/**
 * True when the lease ended / offboarded such that the signing fee should cancel.
 */
function tenantLeftEarly(leaseRow = {}) {
  if (ENDED_LEASE_STATUSES.has(leaseRow.lease_status)) return true;
  if (leaseRow.offboard_moveout_confirmed_at) return true;
  if (leaseRow.offboard_portal_disabled_at) return true;
  if (leaseRow.offboarding_started_at && leaseRow.offboard_keys_returned_at) return true;
  return false;
}

function shouldPromoteSigningFeeToOwed(rentMonthsPaid, monthsRequired = RENT_MONTHS_REQUIRED) {
  return Number(rentMonthsPaid) >= monthsRequired;
}

module.exports = {
  ENDED_LEASE_STATUSES,
  RENT_MONTHS_REQUIRED,
  tenantLeftEarly,
  shouldPromoteSigningFeeToOwed,
};
