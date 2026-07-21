/** UC05 — Manager resolves a dispute (waive or reject). */

const pool = require('../../db/client');
const { accessiblePropertyIds } = require('./access');
const { fetchBillWithSplits } = require('./queries');
const { maybeSettleBill } = require('./uc07-settle-bill');
const { useCaseError } = require('./errors');

async function loadSplitForStaff(splitId, userId, role) {
  const propIds = await accessiblePropertyIds(userId, role);
  const { rows: [split] } = await pool.query(
    `SELECT s.*, ub.property_id
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
      WHERE s.id = $1`,
    [splitId]
  );
  if (!split || !propIds.includes(split.property_id)) {
    throw useCaseError('NOT_FOUND', 'Split not found.');
  }
  return split;
}

async function executeWaiveShare({ userId, role, splitId }) {
  const split = await loadSplitForStaff(splitId, userId, role);
  if (['paid', 'waived'].includes(split.status)) {
    throw useCaseError('INVALID_STATE', `Split already ${split.status}.`);
  }

  await pool.query(
    `UPDATE utility_bill_splits
        SET status = 'waived', waived_by = $1, waived_at = NOW(), updated_at = NOW()
      WHERE id = $2`,
    [userId, splitId]
  );

  await maybeSettleBill(pool, split.bill_id);
  return fetchBillWithSplits(pool, split.bill_id);
}

async function executeRejectDispute({ userId, role, splitId }) {
  const split = await loadSplitForStaff(splitId, userId, role);
  if (split.status !== 'disputed') {
    throw useCaseError('INVALID_STATE', 'Split is not disputed.');
  }

  await pool.query(
    `UPDATE utility_bill_splits
        SET status = 'notified', updated_at = NOW()
      WHERE id = $1`,
    [splitId]
  );

  return fetchBillWithSplits(pool, split.bill_id);
}

module.exports = { executeWaiveShare, executeRejectDispute };
