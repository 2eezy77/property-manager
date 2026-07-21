const { notifyPaymentReceived } = require('../services/payment-email.service');
const { refreshEligibilityForLease } = require('../services/lease-signing-pay.service');

async function markLateFeesPaidForLease(db, leaseId) {
  await db.query(
    `UPDATE late_fees
        SET status = 'paid', applied_at = COALESCE(applied_at, NOW())
      WHERE lease_id = $1 AND status IN ('pending', 'applied')`,
    [leaseId]
  );
}

async function settleSuccessfulRentPayment(db, { paymentId, tenantId, leaseId, amount, paymentType = 'rent' }) {
  if (paymentType === 'rent') {
    await markLateFeesPaidForLease(db, leaseId);
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

module.exports = { markLateFeesPaidForLease, settleSuccessfulRentPayment };
