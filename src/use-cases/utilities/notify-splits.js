/**
 * Shared helpers for UC03 notify / heal paths.
 * Kept free of the pool import so unit tests can exercise them with a fake client.
 */

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

/**
 * Heal recalc desync: pending rows on a notified bill become tenant-payable,
 * then ensure each open share has an in-app notification.
 */
async function healPendingSplitsForBill(client, billId) {
  const { rowCount } = await client.query(
    `UPDATE utility_bill_splits
        SET status = 'notified', updated_at = NOW()
      WHERE bill_id = $1
        AND status = 'pending'
        AND payment_id IS NULL`,
    [billId]
  );
  await backfillSplitNotifications(client, billId);
  return rowCount ?? 0;
}

module.exports = {
  backfillSplitNotifications,
  healPendingSplitsForBill,
};
