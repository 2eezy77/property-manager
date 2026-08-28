/**
 * Pure validation gates for UC04 dispute / UC05 resolve.
 * Keep in sync with uc04-dispute-share.js and uc05-resolve-dispute.js.
 */

'use strict';

const { useCaseError } = require('./errors');

/**
 * Validate a tenant dispute attempt before writing.
 * `split` is the joined split + bill row (needs tenant_id, status, dispute_deadline_at).
 */
function assertDisputeAllowed({ tenantId, split, reason, now = new Date() } = {}) {
  if (!reason || !String(reason).trim()) {
    throw useCaseError('MISSING_REASON', 'A dispute reason is required.');
  }
  if (!split) throw useCaseError('NOT_FOUND', 'Split not found.');
  if (split.tenant_id !== tenantId) throw useCaseError('FORBIDDEN', 'Not your split.');
  if (split.status !== 'notified') {
    throw useCaseError('INVALID_STATE', `Split is ${split.status}; only notified splits can be disputed.`);
  }
  if (!split.dispute_deadline_at || new Date(split.dispute_deadline_at) < new Date(now)) {
    throw useCaseError('DEADLINE_PASSED', 'Dispute window has closed.');
  }
  return String(reason).trim();
}

function assertWaiveAllowed(split) {
  if (!split) throw useCaseError('NOT_FOUND', 'Split not found.');
  if (['paid', 'waived'].includes(split.status)) {
    throw useCaseError('INVALID_STATE', `Split already ${split.status}.`);
  }
  return true;
}

function assertRejectDisputeAllowed(split) {
  if (!split) throw useCaseError('NOT_FOUND', 'Split not found.');
  if (split.status !== 'disputed') {
    throw useCaseError('INVALID_STATE', 'Split is not disputed.');
  }
  return true;
}

module.exports = {
  assertDisputeAllowed,
  assertWaiveAllowed,
  assertRejectDisputeAllowed,
};
