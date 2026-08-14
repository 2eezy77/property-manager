const { notifyPaymentReceived } = require('../services/payment-email.service');
const { refreshEligibilityForLease } = require('../services/lease-signing-pay.service');
const { applyRentCredit, applyLateFeeCredits } = require('../services/rent-partial.service');
const {
  rentSettlementPortions,
  shouldAutoClearLateFeesOnFullPay,
} = require('./rent-settlement-policy');

async function markLateFeesPaidForLease(db, leaseId) {
  await db.query(
    `UPDATE late_fees
        SET status = 'paid', applied_at = COALESCE(applied_at, NOW())
      WHERE lease_id = $1 AND status IN ('pending', 'applied')`,
    [leaseId]
  );
}

/**
 * Settle a succeeded rent payment — credits remaining rent invoice + late fees
 * from metadata allocation (rent first, then fees).
 */
async function settleRentPaymentSuccess(client, {
  paymentId,
  leaseId,
  amount,
  paidAt = new Date(),
}) {
  const { rows: [payment] } = await client.query(
    `SELECT id, amount, period_start, metadata, tenant_id
       FROM payments WHERE id = $1 FOR UPDATE`,
    [paymentId]
  );
  if (!payment) return null;

  const meta = payment.metadata || {};
  const { rentPortion, lateFeePortion, isInstallment } = rentSettlementPortions(meta, amount);

  // Paying the parent row itself for the final remaining balance: the row is
  // already marked succeeded by the caller — only apply late fee credits and
  // refresh parent metadata without zeroing a live succeeded amount incorrectly.
  if (!isInstallment) {
    if (lateFeePortion > 0) {
      await applyLateFeeCredits(client, leaseId, lateFeePortion);
    } else {
      // Legacy full-pay path with no fee split in metadata: clear open fees.
      const feeBal = await client.query(
        `SELECT COALESCE(SUM(amount),0) AS t FROM late_fees
          WHERE lease_id = $1 AND status IN ('pending','applied')`,
        [leaseId]
      );
      // Only auto-clear fees when this payment looks like a full period payoff
      // (no partial flags). Prefer metadata when present.
      if (shouldAutoClearLateFeesOnFullPay({
        isInstallment,
        lateFeePortion,
        rentPortion,
        meta,
        openLateFeeTotal: feeBal.rows[0].t,
      })) {
        await markLateFeesPaidForLease(client, leaseId);
      }
    }

    await client.query(
      `UPDATE payments
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        paymentId,
        JSON.stringify({
          rent_paid_settled: true,
          rent_amount: rentPortion.toFixed(2),
          late_fee_amount: lateFeePortion.toFixed(2),
        }),
      ]
    );

    return { completed: true, rentPortion, lateFeePortion, parentId: paymentId };
  }

  const credit = await applyRentCredit(client, {
    leaseId,
    periodStart: payment.period_start,
    rentPortion,
    lateFeePortion,
    installmentPaymentId: paymentId,
    paidAt,
    partMeta: {
      source: meta.source || null,
      payment_method: meta.payment_method || null,
    },
  });

  return credit;
}

async function settleSuccessfulRentPayment(db, {
  paymentId,
  tenantId,
  leaseId,
  amount,
  paymentType = 'rent',
  skipLateFeeClear = false,
}) {
  if (paymentType === 'rent' && !skipLateFeeClear) {
    // Prefer allocation-aware settlement when we have a connection that supports
    // transactions. pool.query clients still get safe fee handling via metadata.
    const client = typeof db.connect === 'function' ? await db.connect() : null;
    try {
      if (client) {
        await client.query('BEGIN');
        await settleRentPaymentSuccess(client, { paymentId, leaseId, amount });
        await client.query('COMMIT');
      } else {
        await settleRentPaymentSuccess(db, { paymentId, leaseId, amount });
      }
    } catch (err) {
      if (client) await client.query('ROLLBACK');
      console.error('[payment-settlement] rent credit:', err.message);
      // Fallback: do not wipe all late fees on unknown failure.
    } finally {
      if (client) client.release();
    }

    refreshEligibilityForLease(leaseId).catch((err) => {
      console.warn('[payment-settlement] lease-signing eligibility:', err.message);
    });
  } else if (paymentType === 'rent' && skipLateFeeClear) {
    refreshEligibilityForLease(leaseId).catch((err) => {
      console.warn('[payment-settlement] lease-signing eligibility:', err.message);
    });
  }

  notifyPaymentReceived({
    paymentId,
    tenantId,
    leaseId,
    amount,
    paymentType,
  }).catch((err) => console.error('[payment-settlement] email:', err.message));
}

module.exports = {
  markLateFeesPaidForLease,
  settleSuccessfulRentPayment,
  settleRentPaymentSuccess,
};
