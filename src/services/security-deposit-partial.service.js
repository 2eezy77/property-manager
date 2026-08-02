/**
 * Partial / installment security deposit helpers.
 * Pending deposit row amount = remaining owed.
 * Successful installments are separate succeeded rows that credit the pending balance.
 */

'use strict';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseMoney(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Apply a succeeded installment (or full) amount against the open pending deposit.
 * Returns { remaining, paidTotal, completed, parentId }.
 */
async function applyDepositCredit(client, {
  leaseId,
  creditAmount,
  installmentPaymentId = null,
  paidAt = new Date(),
  partMeta = {},
}) {
  const credit = roundMoney(creditAmount);
  if (!(credit > 0)) {
    const err = new Error('Deposit credit must be positive.');
    err.code = 'INVALID_DEPOSIT_AMOUNT';
    throw err;
  }

  const { rows: pendingRows } = await client.query(
    `SELECT id, amount, metadata
       FROM payments
      WHERE lease_id = $1
        AND payment_type = 'security_deposit'
        AND status = 'pending'
      ORDER BY due_date ASC
      LIMIT 1
      FOR UPDATE`,
    [leaseId]
  );
  const pending = pendingRows[0];
  if (!pending) {
    // Installment already succeeded and parent may have been closed in the same flow.
    return { remaining: 0, paidTotal: credit, completed: true, parentId: null };
  }

  const meta = pending.metadata || {};
  const owed = roundMoney(pending.amount);
  const applyAmt = Math.min(credit, owed);
  const remaining = roundMoney(owed - applyAmt);
  const priorPaid = parseMoney(meta.deposit_paid_total);
  const paidTotal = roundMoney((Number.isFinite(priorPaid) ? priorPaid : 0) + applyAmt);
  const original = parseMoney(meta.deposit_original_amount);
  const depositOriginal = Number.isFinite(original)
    ? original
    : roundMoney(paidTotal + Math.max(remaining, 0));

  const parts = Array.isArray(meta.deposit_parts) ? [...meta.deposit_parts] : [];
  if (installmentPaymentId && parts.some((p) => p.paymentId === installmentPaymentId)) {
    // Idempotent: webhook + cashapp sync can both observe the same success.
    return {
      remaining: owed,
      paidTotal: Number.isFinite(priorPaid) ? priorPaid : 0,
      completed: owed <= 0.01,
      parentId: pending.id,
    };
  }
  if (installmentPaymentId) {
    parts.push({
      paymentId: installmentPaymentId,
      amount: applyAmt,
      at: new Date(paidAt).toISOString(),
      ...partMeta,
    });
  }

  if (remaining <= 0.01) {
    await client.query(
      `UPDATE payments
          SET status = 'succeeded',
              amount = $1,
              paid_at = COALESCE(paid_at, $2::timestamptz),
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $4`,
      [
        depositOriginal,
        paidAt,
        JSON.stringify({
          partial_deposit: false,
          deposit_paid_total: paidTotal,
          deposit_original_amount: depositOriginal,
          deposit_parts: parts,
          notes: `Security deposit paid in full ($${paidTotal.toFixed(2)}).`,
        }),
        pending.id,
      ]
    );
    await client.query(
      `UPDATE leases
          SET deposit_paid_at = COALESCE(deposit_paid_at, $2::timestamptz),
              updated_at = NOW()
        WHERE id = $1`,
      [leaseId, paidAt]
    );
    return { remaining: 0, paidTotal, completed: true, parentId: pending.id };
  }

  await client.query(
    `UPDATE payments
        SET amount = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $3`,
    [
      remaining,
      JSON.stringify({
        partial_deposit: true,
        deposit_paid_total: paidTotal,
        deposit_original_amount: depositOriginal,
        deposit_parts: parts,
        notes: `Partial security deposit — $${paidTotal.toFixed(2)} received; $${remaining.toFixed(2)} still owed.`,
        last_deposit_credit_at: new Date().toISOString(),
      }),
      pending.id,
    ]
  );

  return { remaining, paidTotal, completed: false, parentId: pending.id };
}

module.exports = {
  roundMoney,
  parseMoney,
  applyDepositCredit,
};
