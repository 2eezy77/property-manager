/**
 * Apply Stripe Dashboard (and API) refunds to local payments rows.
 *
 * Full vs partial uses Stripe Charge cents (amount / amount_refunded / refunded).
 * Ledger `payments.amount` stays the base rent/deposit — never rewritten from a refund.
 *
 * Paid-vs-owed queries already count only status = 'succeeded', so marking
 * refunded / partially_refunded drops that charge from rent paid totals.
 */

const { releaseUtilitySplitsForFailedPayment } = require('./utility-portal-charge.service');

const APPLIED_REFUND_STATUSES = new Set(['refunded', 'partially_refunded']);

function idOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

function parseCents(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function dollarsToCents(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function isRefundObject(object = {}) {
  if (object.object === 'refund') return true;
  if (object.object === 'charge') return false;
  const id = object.id || '';
  return Boolean(object.charge) && (id.startsWith('re_') || object.amount_refunded == null);
}

function stripeIdsFromRefundEvent(object = {}) {
  if (isRefundObject(object)) {
    return {
      chargeId: idOf(object.charge),
      paymentIntentId: idOf(object.payment_intent),
      refundId: object.id || null,
      refundStatus: object.status || null,
    };
  }
  return {
    chargeId: object.id || null,
    paymentIntentId: idOf(object.payment_intent),
    refundId: null,
    refundStatus: null,
  };
}

/**
 * Decide refunded vs partially_refunded from Stripe Charge fields.
 * Does not use local payments.amount (base rent) — card charges include the fee.
 */
function refundStatusFromCharge(charge) {
  if (!charge) return null;
  const amount = parseCents(charge.amount);
  const amountRefunded = parseCents(charge.amount_refunded);
  if (amountRefunded == null || amountRefunded <= 0) return null;
  if (charge.refunded === true) return 'refunded';
  if (amount != null && amountRefunded >= amount) return 'refunded';
  return 'partially_refunded';
}

/**
 * When the event object is a Refund (no Charge totals), infer full vs partial
 * from this refund's cents vs the Stripe-charged total already stored on the row.
 */
function refundStatusFromRefund(refund, payment) {
  if (!refund) return null;
  const status = refund.status;
  if (status && status !== 'succeeded') return null;
  const refundCents = parseCents(refund.amount);
  if (refundCents == null || refundCents <= 0) return null;

  const chargedCents = chargedCentsFromPayment(payment);
  if (chargedCents != null && refundCents >= chargedCents) return 'refunded';
  if (chargedCents != null && refundCents < chargedCents) return 'partially_refunded';
  return 'refunded';
}

function chargedCentsFromPayment(payment) {
  if (!payment) return null;
  const meta = payment.metadata || {};
  const fromChargedTotal = dollarsToCents(meta.charged_total);
  if (fromChargedTotal != null && fromChargedTotal > 0) return fromChargedTotal;
  const feeCents = parseCents(meta.processing_fee_cents) || 0;
  const baseCents = dollarsToCents(meta.base_amount) ?? dollarsToCents(payment.amount);
  if (baseCents == null) return null;
  return baseCents + feeCents;
}

function shouldSkipRefundApply(payment, eventId, nextStatus) {
  if (!payment) return { skip: true, reason: 'unknown_charge' };
  if (payment.stripe_webhook_event_id === eventId) return { skip: true, reason: 'duplicate_event' };
  if (payment.status === 'refunded') return { skip: true, reason: 'already_refunded' };
  if (payment.status === nextStatus && APPLIED_REFUND_STATUSES.has(payment.status)) {
    return { skip: true, reason: 'already_applied' };
  }
  return { skip: false };
}

function refundMetadataPatch({ eventId, charge, refund, nextStatus }) {
  const amountRefunded = parseCents(charge?.amount_refunded) ?? parseCents(refund?.amount);
  const refundId = refund?.id || charge?.refunds?.data?.[0]?.id || null;
  const patch = {
    stripe_refund_status: nextStatus,
    stripe_refund_event_id: eventId,
  };
  if (amountRefunded != null) patch.stripe_amount_refunded_cents = String(amountRefunded);
  if (refundId) patch.stripe_refund_id = refundId;
  if (charge?.id) patch.stripe_refund_charge_id = charge.id;
  return patch;
}

/**
 * Sum rent that still counts as paid (succeeded only). Mirrors balance SQL.
 */
function paidRentFromRows(rows) {
  return (rows || []).reduce((sum, row) => {
    if (!row || row.payment_type !== 'rent' || row.status !== 'succeeded') return sum;
    const meta = row.metadata || {};
    const rent = Number(meta.rent_amount != null && meta.rent_amount !== '' ? meta.rent_amount : row.amount);
    if (!Number.isFinite(rent)) return sum;
    return Math.round((sum + rent) * 100) / 100;
  }, 0);
}

async function findPaymentForRefund(db, { chargeId, paymentIntentId }) {
  if (!chargeId && !paymentIntentId) return null;
  const { rows } = await db.query(
    `SELECT id, status, stripe_webhook_event_id, lease_id, tenant_id, amount,
            payment_type, metadata, stripe_charge_id, stripe_payment_intent_id
       FROM payments
      WHERE ($1::text IS NOT NULL AND stripe_charge_id = $1)
         OR ($2::text IS NOT NULL AND stripe_payment_intent_id = $2)
      ORDER BY CASE
                 WHEN $1::text IS NOT NULL AND stripe_charge_id = $1 THEN 0
                 ELSE 1
               END
      LIMIT 1`,
    [chargeId || null, paymentIntentId || null]
  );
  return rows[0] || null;
}

async function applyStripeRefund(db, { charge = null, refund = null, eventId }) {
  const object = charge || refund || {};
  const ids = stripeIdsFromRefundEvent(object);
  const chargeId = charge?.id || ids.chargeId;
  const paymentIntentId = ids.paymentIntentId || idOf(charge?.payment_intent);

  if (refund?.status && !['succeeded', 'pending'].includes(refund.status) && !charge) {
    return { applied: false, reason: 'refund_not_succeeded', chargeId, paymentIntentId };
  }

  const payment = await findPaymentForRefund(db, { chargeId, paymentIntentId });
  const nextStatus = charge
    ? refundStatusFromCharge(charge)
    : refundStatusFromRefund(refund, payment);

  if (!nextStatus) {
    if (!payment) return { applied: false, reason: 'unknown_charge', chargeId, paymentIntentId };
    return { applied: false, reason: 'no_refund_amount', chargeId, paymentIntentId, paymentId: payment.id };
  }

  const gate = shouldSkipRefundApply(payment, eventId, nextStatus);
  if (gate.skip) {
    return {
      applied: false,
      reason: gate.reason,
      chargeId,
      paymentIntentId,
      paymentId: payment?.id || null,
      status: payment?.status || null,
    };
  }

  const metaPatch = refundMetadataPatch({ eventId, charge, refund, nextStatus });
  const { rows } = await db.query(
    `UPDATE payments
        SET status = $1::payment_status,
            stripe_webhook_event_id = $2,
            stripe_charge_id = COALESCE(stripe_charge_id, $3),
            metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
            updated_at = NOW()
      WHERE id = $5
        AND status <> 'refunded'
     RETURNING id, status, lease_id, tenant_id, amount, payment_type, metadata`,
    [nextStatus, eventId, chargeId, JSON.stringify(metaPatch), payment.id]
  );

  if (!rows[0]) {
    return { applied: false, reason: 'already_refunded', paymentId: payment.id, chargeId, paymentIntentId };
  }

  const updated = rows[0];

  if (updated.payment_type === 'utility' && nextStatus === 'refunded') {
    await releaseUtilitySplitsForFailedPayment(db, updated.id);
    await db.query(
      `UPDATE utility_bill_splits
          SET status = 'failed',
              payment_id = NULL,
              updated_at = NOW()
        WHERE payment_id = $1
          AND status = 'paid'`,
      [updated.id]
    );
  }

  await db.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
     VALUES ($1, 'payment_refunded',
             $2,
             $3,
             'in_app', 'payment', $4, NOW())`,
    [
      updated.tenant_id,
      nextStatus === 'partially_refunded' ? 'Payment Partially Refunded' : 'Payment Refunded',
      nextStatus === 'partially_refunded'
        ? `A partial refund was issued for your $${parseFloat(updated.amount).toFixed(2)} payment. It no longer counts as paid.`
        : `A refund was issued for your $${parseFloat(updated.amount).toFixed(2)} payment. It no longer counts as paid.`,
      updated.id,
    ]
  );

  return {
    applied: true,
    reason: 'applied',
    paymentId: updated.id,
    status: updated.status,
    chargeId,
    paymentIntentId,
    amount: updated.amount,
    paymentType: updated.payment_type,
  };
}

async function applyChargeRefunded(db, charge, eventId) {
  return applyStripeRefund(db, { charge, eventId });
}

async function applyRefundObject(db, refund, eventId) {
  return applyStripeRefund(db, { refund, eventId });
}

module.exports = {
  applyStripeRefund,
  applyChargeRefunded,
  applyRefundObject,
  refundStatusFromCharge,
  refundStatusFromRefund,
  stripeIdsFromRefundEvent,
  shouldSkipRefundApply,
  paidRentFromRows,
  chargedCentsFromPayment,
  findPaymentForRefund,
};
