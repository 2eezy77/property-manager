/** UC04 — Tenant disputes their share. */

const pool = require('../../db/client');
const { assertDisputeAllowed } = require('./dispute-gates');

async function executeDisputeShare({ tenantId, splitId, reason }) {
  const { rows: [split] } = await pool.query(
    `SELECT s.*, ub.dispute_deadline_at, ub.status AS bill_status
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
      WHERE s.id = $1`,
    [splitId]
  );

  const trimmedReason = assertDisputeAllowed({ tenantId, split, reason });

  const { rows: [updated] } = await pool.query(
    `UPDATE utility_bill_splits
        SET status = 'disputed',
            disputed_at = NOW(),
            dispute_reason = $1,
            updated_at = NOW()
      WHERE id = $2
     RETURNING *`,
    [trimmedReason, splitId]
  );

  try {
    const { alertStaffUtilityDispute } = require('../../services/utility-comms.service');
    await alertStaffUtilityDispute(splitId);
  } catch (err) {
    console.warn('[uc04-dispute] staff alert:', err.message);
  }

  return { split: updated };
}

module.exports = { executeDisputeShare, assertDisputeAllowed };
