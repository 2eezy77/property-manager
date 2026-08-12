/** UC03 — Notify tenants and open the 48-hour dispute window. */

const pool = require('../../db/client');
const { isElectricBillChargeable } = require('../../services/dominion-billing.service');
const { accessiblePropertyIds } = require('./access');
const { fetchBillWithSplits } = require('./queries');
const { useCaseError } = require('./errors');
const {
  backfillSplitNotifications,
  healPendingSplitsForBill,
} = require('./notify-splits');

async function executeNotifyTenants({ userId, role, billId }) {
  const propIds = await accessiblePropertyIds(userId, role);
  const client = await pool.connect();
  let alreadyNotified = false;

  try {
    await client.query('BEGIN');

    const { rows: [bill] } = await client.query(
      `SELECT * FROM utility_bills WHERE id = $1 FOR UPDATE`,
      [billId]
    );
    if (!bill || !propIds.includes(bill.property_id)) {
      await client.query('ROLLBACK');
      throw useCaseError('NOT_FOUND', 'Bill not found.');
    }

    if (bill.status === 'notified') {
      // Heal recalc desync: pending rows on an already-notified bill become payable.
      alreadyNotified = true;
      await healPendingSplitsForBill(client, billId);
      await client.query('COMMIT');
    } else if (bill.status !== 'draft') {
      await client.query('ROLLBACK');
      throw useCaseError('INVALID_STATE', `Bill is ${bill.status}, expected draft.`);
    } else {
      if (bill.service_type === 'electric' && !isElectricBillChargeable(bill)) {
        const after = bill.chargeable_after || bill.period_end;
        await client.query('ROLLBACK');
        throw useCaseError(
          'BILLING_PERIOD_OPEN',
          `Electric bill billing period has not ended yet. Tenants can be notified on or after ${after} (chargeable after date).`
        );
      }

      await client.query(
        `UPDATE utility_bills
            SET status = 'notified',
                notified_at = NOW(),
                dispute_deadline_at = NOW() + INTERVAL '48 hours',
                updated_at = NOW()
          WHERE id = $1`,
        [billId]
      );

      await healPendingSplitsForBill(client, billId);
      await client.query('COMMIT');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }

  // Comms outside the bill transaction (in-app notify + optional staff alert)
  try {
    const {
      sendUtilityBillNotifyEmails,
      alertStaffNewUtilityBill,
    } = require('../../services/utility-comms.service');
    await sendUtilityBillNotifyEmails(billId);
    if (!alreadyNotified) {
      await alertStaffNewUtilityBill(billId);
    }
  } catch (err) {
    console.warn('[uc03-notify] email/staff:', err.message);
  }

  return fetchBillWithSplits(pool, billId);
}

module.exports = {
  executeNotifyTenants,
  backfillSplitNotifications,
  healPendingSplitsForBill,
};
