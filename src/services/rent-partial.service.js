/**
 * Partial / installment rent helpers.
 * Pending rent invoice amount = remaining rent for the period.
 * Succeeded installments are separate rows that credit the pending balance.
 * Payment amounts apply to rent first, then open late fees.
 */

'use strict';

const { roundMoney, parseMoney } = require('./security-deposit-partial.service');

const MIN_RENT_INSTALLMENT = 1;

function allocateTowardRentAndFees(requested, rentRemaining, lateFeeBalance) {
  const pay = roundMoney(requested);
  const rentDue = roundMoney(rentRemaining);
  const feesDue = roundMoney(lateFeeBalance);
  const rentPortion = roundMoney(Math.min(pay, rentDue));
  const lateFeePortion = roundMoney(Math.min(Math.max(pay - rentPortion, 0), feesDue));
  return {
    rentPortion,
    lateFeePortion,
    totalAllocated: roundMoney(rentPortion + lateFeePortion),
  };
}

/**
 * Apply a late-fee dollar credit FIFO against open late_fees rows.
 * Returns { applied, remainingCredit, paidFeeIds }.
 */
async function applyLateFeeCredits(client, leaseId, creditAmount) {
  let remaining = roundMoney(creditAmount);
  const paidFeeIds = [];
  if (!(remaining > 0)) {
    return { applied: 0, remainingCredit: 0, paidFeeIds };
  }

  const { rows: fees } = await client.query(
    `SELECT id, amount
       FROM late_fees
      WHERE lease_id = $1 AND status IN ('pending', 'applied')
      ORDER BY created_at ASC
      FOR UPDATE`,
    [leaseId]
  );

  let applied = 0;
  for (const fee of fees) {
    if (remaining <= 0.001) break;
    const feeAmt = roundMoney(fee.amount);
    if (remaining + 0.001 >= feeAmt) {
      await client.query(
        `UPDATE late_fees
            SET status = 'paid',
                applied_at = COALESCE(applied_at, NOW())
          WHERE id = $1`,
        [fee.id]
      );
      paidFeeIds.push(fee.id);
      remaining = roundMoney(remaining - feeAmt);
      applied = roundMoney(applied + feeAmt);
    } else {
      // Partial fee coverage isn't supported at row level — leave fee open.
      break;
    }
  }

  return { applied, remainingCredit: remaining, paidFeeIds };
}

/**
 * Apply a succeeded installment (or full) amount against the open pending rent invoice.
 * credits.rentPortion reduces the parent; credits.lateFeePortion pays late fees.
 */
async function applyRentCredit(client, {
  leaseId,
  periodStart,
  rentPortion,
  lateFeePortion = 0,
  installmentPaymentId = null,
  paidAt = new Date(),
  partMeta = {},
  monthlyRent = null,
}) {
  const rentCredit = roundMoney(rentPortion);
  const feeCredit = roundMoney(lateFeePortion);

  const feeResult = feeCredit > 0
    ? await applyLateFeeCredits(client, leaseId, feeCredit)
    : { applied: 0, remainingCredit: 0, paidFeeIds: [] };

  const { rows: pendingRows } = await client.query(
    `SELECT id, amount, metadata
       FROM payments
      WHERE lease_id = $1
        AND payment_type = 'rent'
        AND period_start = $2::date
        AND status = 'pending'
        AND COALESCE(metadata->>'partial_installment', 'false') <> 'true'
      ORDER BY due_date ASC
      LIMIT 1
      FOR UPDATE`,
    [leaseId, periodStart]
  );
  const pending = pendingRows[0];

  if (!pending) {
    return {
      rentRemaining: 0,
      paidTotal: rentCredit,
      completed: true,
      parentId: null,
      lateFeesPaid: feeResult.paidFeeIds,
    };
  }

  const meta = pending.metadata || {};
  if (installmentPaymentId) {
    const parts = Array.isArray(meta.rent_parts) ? meta.rent_parts : [];
    if (parts.some((p) => p.paymentId === installmentPaymentId)) {
      const owed = roundMoney(pending.amount);
      const priorPaid = parseMoney(meta.rent_paid_total);
      return {
        rentRemaining: owed,
        paidTotal: Number.isFinite(priorPaid) ? priorPaid : 0,
        completed: owed <= 0.01,
        parentId: pending.id,
        lateFeesPaid: feeResult.paidFeeIds,
      };
    }
  }

  const owed = roundMoney(pending.amount);
  const applyAmt = Math.min(rentCredit, owed);
  const rentRemaining = roundMoney(owed - applyAmt);
  const priorPaid = parseMoney(meta.rent_paid_total);
  const paidTotal = roundMoney((Number.isFinite(priorPaid) ? priorPaid : 0) + applyAmt);
  const original = parseMoney(meta.rent_original_amount);
  const rentOriginal = Number.isFinite(original)
    ? original
    : roundMoney(
      Number.isFinite(parseMoney(monthlyRent))
        ? parseMoney(monthlyRent)
        : paidTotal + Math.max(rentRemaining, 0)
    );

  const parts = Array.isArray(meta.rent_parts) ? [...meta.rent_parts] : [];
  if (installmentPaymentId) {
    parts.push({
      paymentId: installmentPaymentId,
      rentPortion: applyAmt,
      lateFeePortion: feeResult.applied,
      at: new Date(paidAt).toISOString(),
      ...partMeta,
    });
  }

  if (rentRemaining <= 0.01) {
    // Closing via installments: parent amount 0 so SUM(succeeded) isn't double-counted.
    // Closing via the parent itself is handled by the caller marking that row succeeded.
    const closeAsZero = Boolean(installmentPaymentId && installmentPaymentId !== pending.id);
    await client.query(
      `UPDATE payments
          SET status = 'succeeded',
              amount = $1,
              paid_at = COALESCE(paid_at, $2::timestamptz),
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $4`,
      [
        closeAsZero ? 0 : applyAmt,
        paidAt,
        JSON.stringify({
          partial_rent: paidTotal + 0.001 < rentOriginal,
          rent_paid_total: paidTotal,
          rent_original_amount: rentOriginal,
          rent_parts: parts,
          closed_by_installments: closeAsZero,
          notes: closeAsZero
            ? `Rent paid in full via installments ($${paidTotal.toFixed(2)}).`
            : `Rent payment of $${applyAmt.toFixed(2)}.`,
        }),
        pending.id,
      ]
    );
    return {
      rentRemaining: 0,
      paidTotal,
      completed: true,
      parentId: pending.id,
      lateFeesPaid: feeResult.paidFeeIds,
    };
  }

  await client.query(
    `UPDATE payments
        SET amount = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $3`,
    [
      rentRemaining,
      JSON.stringify({
        partial_rent: true,
        rent_paid_total: paidTotal,
        rent_original_amount: rentOriginal,
        rent_parts: parts,
        notes: `Partial rent — $${paidTotal.toFixed(2)} received; $${rentRemaining.toFixed(2)} still owed.`,
        last_rent_credit_at: new Date().toISOString(),
      }),
      pending.id,
    ]
  );

  return {
    rentRemaining,
    paidTotal,
    completed: false,
    parentId: pending.id,
    lateFeesPaid: feeResult.paidFeeIds,
  };
}

module.exports = {
  MIN_RENT_INSTALLMENT,
  allocateTowardRentAndFees,
  applyLateFeeCredits,
  applyRentCredit,
};
