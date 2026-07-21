/** UC07 — Settle bill when all splits reach a terminal state. */

async function maybeSettleBill(db, billId) {
  const { rows } = await db.query(
    `SELECT status FROM utility_bill_splits WHERE bill_id = $1`,
    [billId]
  );
  if (rows.length === 0) return;

  const allTerminal = rows.every(r => ['paid', 'waived', 'failed'].includes(r.status));
  if (!allTerminal) return;

  await db.query(
    `UPDATE utility_bills
        SET status = 'settled', settled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status <> 'settled'`,
    [billId]
  );
}

module.exports = { maybeSettleBill };
