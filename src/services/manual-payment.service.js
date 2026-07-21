/**
 * Record an offline payment (Cash App, check, etc.) — shared by API route and import scripts.
 */

const pool = require('../db/client');

const MANUAL_METHODS = new Set(['cash_app', 'check', 'zelle', 'venmo', 'wire', 'cash', 'other']);

function monthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function periodForMonth(year, monthIndex0) {
  const start = new Date(year, monthIndex0, 1);
  const end = new Date(year, monthIndex0 + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function recordManualPayment(db, {
  leaseId,
  tenantId,
  amount,
  paidAt,
  periodStart,
  periodEnd,
  paymentType = 'rent',
  paymentMethod = 'cash_app',
  reference,
  notes,
  metadataExtra = {},
  recordedBy = null,
  allowPartial = false,
}) {
  if (!MANUAL_METHODS.has(paymentMethod)) {
    throw new Error(`Invalid payment method: ${paymentMethod}`);
  }

  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error('Invalid amount');
  }

  const paidDate = paidAt ? new Date(`${String(paidAt).slice(0, 10)}T12:00:00`) : new Date();
  const bounds = monthBounds(paidDate);
  const pStart = periodStart ? String(periodStart).slice(0, 10) : bounds.start;
  const pEnd = periodEnd ? String(periodEnd).slice(0, 10) : bounds.end;

  const metadata = {
    payment_method: paymentMethod,
    external_reference: reference || null,
    notes: notes || null,
    recorded_by: recordedBy,
    recorded_at: new Date().toISOString(),
    source: metadataExtra.source || 'manual',
    partial_rent: allowPartial || metadataExtra.partial_rent || false,
    ...metadataExtra,
  };

  const { rows: dupRows } = await db.query(
    `SELECT id FROM payments
      WHERE lease_id = $1 AND payment_type = $2 AND period_start = $3::date
        AND status = 'succeeded'
        AND COALESCE(metadata->>'partial_rent', 'false') <> 'true'`,
    [leaseId, paymentType, pStart]
  );
  if (dupRows.length && !allowPartial) {
    return { skipped: true, reason: 'duplicate', paymentId: dupRows[0].id };
  }

  if (allowPartial) {
    const { rows: partialDup } = await db.query(
      `SELECT id FROM payments
        WHERE lease_id = $1 AND payment_type = $2 AND period_start = $3::date
          AND status = 'succeeded'
          AND metadata->>'partial_rent' = 'true'
          AND metadata->>'external_reference' = $4`,
      [leaseId, paymentType, pStart, reference || '']
    );
    if (partialDup.length) {
      return { skipped: true, reason: 'duplicate_partial', paymentId: partialDup[0].id };
    }
  }

  const { rows: pendingRows } = await db.query(
    `SELECT id FROM payments
      WHERE lease_id = $1 AND payment_type = $2 AND period_start = $3::date
        AND status IN ('pending','processing')
      ORDER BY created_at DESC LIMIT 1`,
    [leaseId, paymentType, pStart]
  );

  let paymentId;
  if (pendingRows[0]) {
    const { rows: updated } = await db.query(
      `UPDATE payments
          SET amount = $1, status = 'succeeded', paid_at = $2,
              metadata = $3, updated_at = NOW()
        WHERE id = $4
       RETURNING id`,
      [amountNum, paidDate.toISOString(), JSON.stringify(metadata), pendingRows[0].id]
    );
    paymentId = updated[0].id;
  } else {
    const { rows: inserted } = await db.query(
      `INSERT INTO payments
         (lease_id, tenant_id, amount, currency, status, payment_type,
          period_start, period_end, due_date, paid_at, metadata)
       VALUES ($1,$2,$3,'USD','succeeded',$4,$5::date,$6::date,$5::date,$7,$8)
       RETURNING id`,
      [leaseId, tenantId, amountNum, paymentType, pStart, pEnd, paidDate.toISOString(), JSON.stringify(metadata)]
    );
    paymentId = inserted[0].id;
  }

  if (paymentType === 'rent') {
    await db.query(
      `UPDATE late_fees
          SET status = 'paid', applied_at = NOW()
        WHERE lease_id = $1 AND status IN ('pending','applied')`,
      [leaseId]
    );
  }

  return { skipped: false, paymentId };
}

module.exports = {
  MANUAL_METHODS,
  monthBounds,
  periodForMonth,
  recordManualPayment,
};
