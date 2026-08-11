/** UC03 — Notify tenants and open the 48-hour dispute window. */

const pool = require('../../db/client');
const { isElectricBillChargeable } = require('../../services/dominion-billing.service');
const { accessiblePropertyIds } = require('./access');
const { fetchBillWithSplits } = require('./queries');
const { useCaseError } = require('./errors');

async function backfillSplitNotifications(client, billId) {
  const { rows: splits } = await client.query(
    `SELECT s.id AS split_id, s.tenant_id, s.amount, ub.service_type, ub.period_start, ub.period_end
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
      WHERE s.bill_id = $1
        AND s.status NOT IN ('waived', 'paid')`,
    [billId]
  );

  for (const s of splits) {
    const { rows: existing } = await client.query(
      `SELECT 1 FROM notifications
        WHERE user_id = $1 AND type = 'utility_bill' AND channel = 'in_app'
          AND related_entity_id = $2
        LIMIT 1`,
      [s.tenant_id, s.split_id]
    );
    if (existing.length) continue;

    await client.query(
      `INSERT INTO notifications
         (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
       VALUES ($1, 'utility_bill', $2, $3, 'in_app', 'utility_bill_split', $4, NOW())`,
      [
        s.tenant_id,
        `Utility bill — ${s.service_type}`,
        `Your share is $${Number(s.amount).toFixed(2)} for ${s.period_start} to ${s.period_end}. Dispute within 48 hours if anything looks wrong. Pay in the portal when ready.`,
        s.split_id,
      ]
    );
  }
}

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
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'notified', updated_at = NOW()
          WHERE bill_id = $1
            AND status = 'pending'
            AND payment_id IS NULL`,
        [billId]
      );
      await backfillSplitNotifications(client, billId);
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

      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'notified', updated_at = NOW()
          WHERE bill_id = $1
            AND status = 'pending'
            AND payment_id IS NULL`,
        [billId]
      );

      await backfillSplitNotifications(client, billId);
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

module.exports = { executeNotifyTenants, backfillSplitNotifications };
