/** UC04 — Tenant disputes their share. */

const pool = require('../../db/client');
const { useCaseError } = require('./errors');

async function executeDisputeShare({ tenantId, splitId, reason }) {
  if (!reason || !String(reason).trim()) {
    throw useCaseError('MISSING_REASON', 'A dispute reason is required.');
  }

  const { rows: [split] } = await pool.query(
    `SELECT s.*, ub.dispute_deadline_at, ub.status AS bill_status
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
      WHERE s.id = $1`,
    [splitId]
  );

  if (!split) throw useCaseError('NOT_FOUND', 'Split not found.');
  if (split.tenant_id !== tenantId) throw useCaseError('FORBIDDEN', 'Not your split.');
  if (split.status !== 'notified') {
    throw useCaseError('INVALID_STATE', `Split is ${split.status}; only notified splits can be disputed.`);
  }
  if (!split.dispute_deadline_at || new Date(split.dispute_deadline_at) < new Date()) {
    throw useCaseError('DEADLINE_PASSED', 'Dispute window has closed.');
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE utility_bill_splits
        SET status = 'disputed',
            disputed_at = NOW(),
            dispute_reason = $1,
            updated_at = NOW()
      WHERE id = $2
     RETURNING *`,
    [String(reason).trim(), splitId]
  );

  return { split: updated };
}

module.exports = { executeDisputeShare };
