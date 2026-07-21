/**
 * stripe.webhook.js
 * Handles inbound Stripe webhook events for payment lifecycle management.
 *
 * CRITICAL: This route must receive the RAW request body (Buffer).
 *           Mount it BEFORE express.json() in app.js using express.raw().
 *
 * Events handled (active path — legacy Charges API):
 *   charge.pending                    — ACH debit submitted to bank
 *   charge.succeeded                  — funds confirmed
 *   charge.failed                     — ACH returned / failed
 *   charge.dispute.created            — chargeback initiated
 *
 * Events handled (PaymentIntents — ACH, Cash App Pay, utilities):
 *   payment_intent.processing
 *   payment_intent.succeeded
 *   payment_intent.payment_failed
 *   payment_intent.canceled
 *
 * Connect / platform (safe no-op):
 *   account.updated
 *
 * On each event the handler:
 *   1. Updates the payments row status
 *   2. Applies or marks late fees paid (on success)
 *   3. Inserts a notification row for the tenant
 *   4. Triggers payment_splits processing (on success)
 */

const express = require('express');

const { constructWebhookEvent } = require('../services/stripe.service');
const { maybeSettleBill }       = require('../use-cases/utilities');
const {
  notifyPaymentReceived,
  notifyPaymentFailed,
} = require('../services/payment-email.service');

const router = express.Router();
const pool = require('../db/client');

function paymentMethodFromIntent(pi) {
  if (pi.payment_method_types?.includes('cashapp')) return 'cash_app';
  if (pi.payment_method_types?.includes('us_bank_account')) return 'ach';
  return null;
}

function chargeIdFromIntent(pi) {
  return typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
}

/** Skip duplicate webhook deliveries; never re-settle an already-succeeded payment. */
async function findPaymentForIntent(piId) {
  const { rows } = await pool.query(
    `SELECT id, status, stripe_webhook_event_id, lease_id, tenant_id, amount, payment_type
       FROM payments
      WHERE stripe_payment_intent_id = $1`,
    [piId]
  );
  return rows[0] || null;
}

async function shouldSkipIntentWebhook(payment, eventId) {
  if (!payment) return { skip: true, reason: 'no_payment_row' };
  if (payment.status === 'succeeded') return { skip: true, reason: 'already_succeeded' };
  if (payment.stripe_webhook_event_id === eventId) return { skip: true, reason: 'duplicate_event' };
  return { skip: false };
}

async function stampPaymentMethodMetadata(client, paymentId, pi) {
  const method = paymentMethodFromIntent(pi);
  if (!method) return;
  const source = method === 'cash_app' ? 'stripe_cashapp' : 'stripe_ach';
  await client.query(
    `UPDATE payments
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify({ payment_method: method, source }), paymentId]
  );
}

// ── POST /webhooks/stripe ─────────────────────────────────────────────────────
// express.raw() is applied at the app level before mounting this route
router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature error: ${err.message}` });
  }

  // Acknowledge receipt immediately — processing is async
  res.status(200).json({ received: true });

  // Handle async without blocking the response
  handleEvent(event).catch((err) =>
    console.error(`[stripe-webhook] unhandled error for ${event.type}:`, err)
  );
});

// ── Event dispatcher ──────────────────────────────────────────────────────────
async function handleEvent(event) {
  const object = event.data.object;

  switch (event.type) {
    // ── Charges API (active path) ─────────────────────────────────────────────
    case 'charge.pending':
      await onChargeProcessing(object, event.id);
      break;
    case 'charge.succeeded':
      await onChargeSucceeded(object, event.id);
      break;
    case 'charge.failed':
      await onChargeFailed(object, event.id);
      break;
    case 'charge.dispute.created':
      await onDispute(object);
      break;

    // ── PaymentIntents API (legacy — kept for old rows still in-flight) ──────
    case 'payment_intent.processing':
      await onProcessing(object, event.id);
      break;
    case 'payment_intent.succeeded':
      await onSucceeded(object, event.id);
      break;
    case 'payment_intent.payment_failed':
      await onFailed(object, event.id);
      break;
    case 'payment_intent.canceled':
      await onCanceled(object, event.id);
      break;

    case 'account.updated':
      console.log(
        `[stripe-webhook] account.updated ${object.id} `
        + `transfers=${object.capabilities?.transfers ?? 'n/a'}`
      );
      break;

    default:
      console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
  }
}

// ── Manager site-visit payroll (Stripe Connect destination charge) ───────────
async function updateManagerPayoutByPaymentIntent(pi, { status, eventId, chargeId }) {
  const { rows } = await pool.query(
    `UPDATE manager_site_visit_payouts
        SET status = $1::site_visit_payout_status,
            stripe_charge_id = COALESCE($2, stripe_charge_id),
            paid_at = CASE WHEN $1::text = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
      WHERE stripe_payment_intent_id = $3
     RETURNING id, manager_id, amount_cents, period_year, period_month`,
    [status, chargeId ?? null, pi.id]
  );
  if (!rows[0]) return false;

  if (status === 'paid') {
    await pool.query(
      `INSERT INTO notifications
         (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
       VALUES ($1, 'manager_payroll_paid',
               'Site visit pay received',
               $2, 'push', 'manager_site_visit_payout', $3, NOW())`,
      [
        rows[0].manager_id,
        `Your site-visit payroll of $${(rows[0].amount_cents / 100).toFixed(2)} was deposited.`,
        rows[0].id,
      ]
    );
  }

  console.log(`[stripe-webhook] manager payroll ${status}: payout ${rows[0].id} PI ${pi.id}`);
  return true;
}

async function updateManagerPayoutByCharge(charge, { status, eventId }) {
  const { rows } = await pool.query(
    `UPDATE manager_site_visit_payouts
        SET status = $1::site_visit_payout_status,
            stripe_charge_id = $2,
            paid_at = CASE WHEN $1::text = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
      WHERE stripe_charge_id = $2
        OR stripe_payment_intent_id = $3
     RETURNING id, manager_id, amount_cents`,
    [status, charge.id, charge.payment_intent]
  );
  if (!rows[0]) return false;

  if (status === 'paid') {
    await pool.query(
      `INSERT INTO notifications
         (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
       VALUES ($1, 'manager_payroll_paid',
               'Site visit pay received',
               $2, 'push', 'manager_site_visit_payout', $3, NOW())`,
      [
        rows[0].manager_id,
        `Your site-visit payroll of $${(rows[0].amount_cents / 100).toFixed(2)} was deposited.`,
        rows[0].id,
      ]
    );
  }

  console.log(`[stripe-webhook] manager payroll ${status}: payout ${rows[0].id} charge ${charge.id}`);
  return true;
}

async function updateLeaseSigningFeeByPaymentIntent(pi, { status, chargeId }) {
  if (status === 'paid') {
    const { rows } = await pool.query(
      `UPDATE manager_lease_signing_fees
          SET status = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              stripe_charge_id = COALESCE($1, stripe_charge_id),
              updated_at = NOW()
        WHERE stripe_payment_intent_id = $2
       RETURNING id, manager_id, amount_cents`,
      [chargeId ?? null, pi.id]
    );
    if (!rows[0]) return false;

    await pool.query(
      `INSERT INTO notifications
         (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
       VALUES ($1, 'manager_payroll_paid',
               'Lease signing pay received',
               $2, 'push', 'manager_lease_signing_fee', $3, NOW())`,
      [
        rows[0].manager_id,
        `Your lease-signing fee of $${(rows[0].amount_cents / 100).toFixed(2)} was deposited.`,
        rows[0].id,
      ]
    );
    console.log(`[stripe-webhook] lease signing fee paid: ${rows[0].id} PI ${pi.id}`);
    return true;
  }

  if (status === 'failed') {
    const { rowCount } = await pool.query(
      `UPDATE manager_lease_signing_fees
          SET stripe_payment_intent_id = NULL,
              updated_at = NOW()
        WHERE stripe_payment_intent_id = $1
          AND status = 'owed'`,
      [pi.id]
    );
    if (rowCount) {
      console.log(`[stripe-webhook] lease signing fee failed/reset: PI ${pi.id}`);
      return true;
    }
  }

  return false;
}

async function updateLeaseSigningFeeByCharge(charge, { status }) {
  if (status !== 'paid') return false;
  const { rows } = await pool.query(
    `UPDATE manager_lease_signing_fees
        SET status = 'paid',
            paid_at = COALESCE(paid_at, NOW()),
            stripe_charge_id = $1,
            updated_at = NOW()
      WHERE stripe_charge_id = $1
        OR stripe_payment_intent_id = $2
     RETURNING id, manager_id, amount_cents`,
    [charge.id, charge.payment_intent]
  );
  if (!rows[0]) return false;

  await pool.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
     VALUES ($1, 'manager_payroll_paid',
             'Lease signing pay received',
             $2, 'push', 'manager_lease_signing_fee', $3, NOW())`,
    [
      rows[0].manager_id,
      `Your lease-signing fee of $${(rows[0].amount_cents / 100).toFixed(2)} was deposited.`,
      rows[0].id,
    ]
  );
  console.log(`[stripe-webhook] lease signing fee paid: ${rows[0].id} charge ${charge.id}`);
  return true;
}

// ── charge.pending ────────────────────────────────────────────────────────────
async function onChargeProcessing(charge, eventId) {
  await pool.query(
    `UPDATE payments
        SET status                  = 'processing',
            stripe_webhook_event_id = $1,
            updated_at              = NOW()
      WHERE stripe_charge_id = $2`,
    [eventId, charge.id]
  );
  console.log(`[stripe-webhook] charge pending: ${charge.id}`);
}

// ── charge.succeeded ──────────────────────────────────────────────────────────
async function onChargeSucceeded(charge, eventId) {
  if (charge.metadata?.payment_type === 'manager_site_visit_payroll') {
    const handled = await updateManagerPayoutByCharge(charge, { status: 'paid', eventId });
    if (handled) return;
  }
  if (charge.metadata?.payment_type === 'manager_lease_signing_fee') {
    const handled = await updateLeaseSigningFeeByCharge(charge, { status: 'paid' });
    if (handled) return;
  }

  // Reuse the existing PaymentIntent success path by synthesising the fields it
  // reads (.id used to look up the row, .latest_charge used to populate
  // stripe_charge_id). Since we already wrote stripe_charge_id at creation time
  // we just pass the charge.id in both positions and onSucceeded looks up by
  // stripe_payment_intent_id — which won't match. So instead, run the same
  // body but match by stripe_charge_id.
  const client = await pool.connect();
  let utilityBillId = null;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE payments
          SET status                   = 'succeeded',
              stripe_charge_id         = $1,
              stripe_webhook_event_id  = $2,
              paid_at                  = COALESCE(paid_at, NOW()),
              updated_at               = NOW()
        WHERE stripe_charge_id         = $1
       RETURNING id, lease_id, tenant_id, amount, payment_type`,
      [charge.id, eventId]
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return console.warn(`[stripe-webhook] no payment row for charge ${charge.id}`);
    }

    const { id: paymentId, lease_id, tenant_id, amount, payment_type } = rows[0];

    if (payment_type === 'utility') {
      const { rows: splitRows } = await client.query(
        `UPDATE utility_bill_splits
            SET status     = 'paid',
                updated_at = NOW()
          WHERE payment_id = $1
         RETURNING bill_id`,
        [paymentId]
      );
      utilityBillId = splitRows[0]?.bill_id ?? null;

      await client.query(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
         VALUES ($1, 'utility_paid',
                 'Utility Payment Confirmed',
                 $2, 'push', 'payment', $3, NOW())`,
        [tenant_id, `Your utility share of $${parseFloat(amount).toFixed(2)} has been paid.`, paymentId]
      );
    } else {
      await client.query(
        `UPDATE late_fees
            SET status = 'paid', applied_at = NOW()
          WHERE lease_id = $1 AND status IN ('pending','applied')`,
        [lease_id]
      );

      await client.query(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
         VALUES ($1, 'rent_received',
                 'Payment Confirmed',
                 $2, 'push', 'payment', $3, NOW())`,
        [tenant_id, `Your rent payment of $${parseFloat(amount).toFixed(2)} has been confirmed.`, paymentId]
      );

      await processSplits(client, paymentId, lease_id, amount, { id: charge.id });
    }

    await client.query('COMMIT');

    if (utilityBillId) await maybeSettleBill(pool, utilityBillId);
    console.log(`[stripe-webhook] charge succeeded: ${charge.id} ($${amount}) [${payment_type}]`);

    notifyPaymentReceived({
      paymentId,
      tenantId: tenant_id,
      leaseId: lease_id,
      amount,
      paymentType: payment_type,
    }).catch(err => console.error('[stripe-webhook] payment email:', err.message));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── charge.failed ─────────────────────────────────────────────────────────────
async function onChargeFailed(charge, eventId) {
  const failureReason = charge.failure_message ?? 'ACH debit was returned by the bank.';

  if (charge.metadata?.payment_type === 'manager_site_visit_payroll') {
    const handled = await updateManagerPayoutByCharge(charge, { status: 'failed', eventId });
    if (handled) return;
  }

  const { rows } = await pool.query(
    `UPDATE payments
        SET status                  = 'failed',
            failure_reason          = $1,
            stripe_webhook_event_id = $2,
            updated_at              = NOW()
      WHERE stripe_charge_id = $3
     RETURNING id, tenant_id, lease_id, amount, payment_type`,
    [failureReason, eventId, charge.id]
  );

  if (!rows[0]) return;

  let utilityBillId = null;
  if (rows[0].payment_type === 'utility') {
    const { rows: splitRows } = await pool.query(
      `UPDATE utility_bill_splits
          SET status = 'failed', updated_at = NOW()
        WHERE payment_id = $1
       RETURNING bill_id`,
      [rows[0].id]
    );
    utilityBillId = splitRows[0]?.bill_id ?? null;
  }

  const label = rows[0].payment_type === 'utility' ? 'utility' : 'rent';
  await pool.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
     VALUES ($1, 'payment_failed',
             'Payment Failed',
             $2, 'push', 'payment', $3, NOW())`,
    [
      rows[0].tenant_id,
      `Your ${label} payment of $${parseFloat(rows[0].amount).toFixed(2)} failed: ${failureReason}`,
      rows[0].id,
    ]
  );

  if (utilityBillId) await maybeSettleBill(pool, utilityBillId);
  console.log(`[stripe-webhook] charge failed: ${charge.id} — ${failureReason}`);

  notifyPaymentFailed({
    paymentId: rows[0].id,
    tenantId: rows[0].tenant_id,
    leaseId: rows[0].lease_id,
    amount: rows[0].amount,
    paymentType: rows[0].payment_type,
    failureReason,
  }).catch(err => console.error('[stripe-webhook] payment email:', err.message));
}

// ── payment_intent.processing ─────────────────────────────────────────────────
async function onProcessing(pi, eventId) {
  if (pi.metadata?.payment_type === 'manager_site_visit_payroll') {
    const handled = await updateManagerPayoutByPaymentIntent(pi, {
      status: 'processing',
      eventId,
      chargeId: chargeIdFromIntent(pi),
    });
    if (handled) return;
  }
  if (pi.metadata?.payment_type === 'manager_lease_signing_fee') {
    return;
  }

  const payment = await findPaymentForIntent(pi.id);
  const gate = await shouldSkipIntentWebhook(payment, eventId);
  if (gate.skip && gate.reason !== 'no_payment_row') return;

  await pool.query(
    `UPDATE payments
        SET status = 'processing',
            stripe_webhook_event_id = $1,
            updated_at = NOW()
      WHERE stripe_payment_intent_id = $2
        AND status IN ('pending', 'processing')`,
    [eventId, pi.id]
  );
  console.log(`[stripe-webhook] payment processing: ${pi.id}`);
}

async function onCanceled(pi, eventId) {
  const payment = await findPaymentForIntent(pi.id);
  if (!payment || payment.status === 'succeeded') return;

  await pool.query(
    `UPDATE payments
        SET status = 'failed',
            failure_reason = 'Payment canceled.',
            stripe_webhook_event_id = $1,
            updated_at = NOW()
      WHERE stripe_payment_intent_id = $2
        AND status IN ('pending', 'processing')`,
    [eventId, pi.id]
  );
  console.log(`[stripe-webhook] payment canceled: ${pi.id}`);
}

// ── payment_intent.succeeded ──────────────────────────────────────────────────
async function onSucceeded(pi, eventId) {
  if (pi.metadata?.payment_type === 'manager_site_visit_payroll') {
    const handled = await updateManagerPayoutByPaymentIntent(pi, {
      status: 'paid',
      eventId,
      chargeId: chargeIdFromIntent(pi),
    });
    if (handled) return;
  }
  if (pi.metadata?.payment_type === 'manager_lease_signing_fee') {
    const handled = await updateLeaseSigningFeeByPaymentIntent(pi, {
      status: 'paid',
      chargeId: chargeIdFromIntent(pi),
    });
    if (handled) return;
  }

  const existing = await findPaymentForIntent(pi.id);
  const gate = await shouldSkipIntentWebhook(existing, eventId);
  if (gate.skip) {
    if (gate.reason === 'no_payment_row') {
      console.warn(`[stripe-webhook] no payment row for PI ${pi.id}`);
    }
    return;
  }

  const client = await pool.connect();
  let utilityBillId = null;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE payments
          SET status                   = 'succeeded',
              stripe_charge_id         = $1,
              stripe_webhook_event_id  = $2,
              paid_at                  = COALESCE(paid_at, NOW()),
              updated_at               = NOW()
        WHERE stripe_payment_intent_id = $3
          AND status <> 'succeeded'
       RETURNING id, lease_id, tenant_id, amount, payment_type`,
      [chargeIdFromIntent(pi), eventId, pi.id]
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return;
    }

    const { id: paymentId, lease_id, tenant_id, amount, payment_type } = rows[0];
    await stampPaymentMethodMetadata(client, paymentId, pi);

    if (payment_type === 'utility') {
      // Utility payment — flip the linked split to paid and possibly settle the bill
      const { rows: splitRows } = await client.query(
        `UPDATE utility_bill_splits
            SET status     = 'paid',
                updated_at = NOW()
          WHERE payment_id = $1
         RETURNING bill_id`,
        [paymentId]
      );
      utilityBillId = splitRows[0]?.bill_id ?? null;

      await client.query(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
         VALUES ($1, 'utility_paid',
                 'Utility Payment Confirmed',
                 $2,
                 'push', 'payment', $3, NOW())`,
        [
          tenant_id,
          `Your utility share of $${parseFloat(amount).toFixed(2)} has been paid.`,
          paymentId,
        ]
      );
    } else {
      // Rent / late_fee / security_deposit / other — original flow

      // 2. Mark any pending late fees as paid for this lease
      await client.query(
        `UPDATE late_fees
            SET status = 'paid', applied_at = NOW()
          WHERE lease_id = $1 AND status IN ('pending','applied')`,
        [lease_id]
      );

      // 3. Insert success notification for tenant
      await client.query(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
         VALUES ($1, 'rent_received',
                 'Payment Confirmed',
                 $2,
                 'push', 'payment', $3, NOW())`,
        [
          tenant_id,
          `Your rent payment of $${parseFloat(amount).toFixed(2)} has been confirmed.`,
          paymentId,
        ]
      );

      // 4. Trigger payment splits (fetch split rules from lease → property → org)
      await processSplits(client, paymentId, lease_id, amount, pi);
    }

    await client.query('COMMIT');

    // Settle the bill outside the transaction (own statement, idempotent)
    if (utilityBillId) {
      await maybeSettleBill(pool, utilityBillId);
    }
    console.log(`[stripe-webhook] payment succeeded: ${pi.id} ($${amount}) [${payment_type}]`);

    notifyPaymentReceived({
      paymentId,
      tenantId: tenant_id,
      leaseId: lease_id,
      amount,
      paymentType: payment_type,
    }).catch(err => console.error('[stripe-webhook] payment email:', err.message));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── payment_intent.payment_failed ─────────────────────────────────────────────
async function onFailed(pi, eventId) {
  const isCashApp = pi.payment_method_types?.includes('cashapp');
  const failureReason =
    pi.last_payment_error?.message
    ?? (isCashApp ? 'Cash App payment was not completed.' : 'ACH debit was returned by the bank.');

  if (pi.metadata?.payment_type === 'manager_site_visit_payroll') {
    const handled = await updateManagerPayoutByPaymentIntent(pi, {
      status: 'failed',
      eventId,
      chargeId: chargeIdFromIntent(pi),
    });
    if (handled) return;
  }
  if (pi.metadata?.payment_type === 'manager_lease_signing_fee') {
    const handled = await updateLeaseSigningFeeByPaymentIntent(pi, { status: 'failed' });
    if (handled) return;
  }

  const existing = await findPaymentForIntent(pi.id);
  if (existing?.status === 'succeeded') return;

  const { rows } = await pool.query(
    `UPDATE payments
        SET status                  = 'failed',
            failure_reason          = $1,
            stripe_webhook_event_id = $2,
            updated_at              = NOW()
      WHERE stripe_payment_intent_id = $3
        AND status <> 'succeeded'
     RETURNING id, tenant_id, lease_id, amount, payment_type`,
    [failureReason, eventId, pi.id]
  );

  if (!rows[0]) return;

  // Flip any utility split that was charging → failed (manager can retry)
  let utilityBillId = null;
  if (rows[0].payment_type === 'utility') {
    const { rows: splitRows } = await pool.query(
      `UPDATE utility_bill_splits
          SET status = 'failed', updated_at = NOW()
        WHERE payment_id = $1
       RETURNING bill_id`,
      [rows[0].id]
    );
    utilityBillId = splitRows[0]?.bill_id ?? null;
  }

  const label = rows[0].payment_type === 'utility' ? 'utility' : 'rent';
  // Notify tenant of failure
  await pool.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
     VALUES ($1, 'payment_failed',
             'Payment Failed',
             $2,
             'push', 'payment', $3, NOW())`,
    [
      rows[0].tenant_id,
      `Your ${label} payment of $${parseFloat(rows[0].amount).toFixed(2)} failed: ${failureReason}`,
      rows[0].id,
    ]
  );

  if (utilityBillId) {
    await maybeSettleBill(pool, utilityBillId);
  }

  console.log(`[stripe-webhook] payment failed: ${pi.id} — ${failureReason}`);

  notifyPaymentFailed({
    paymentId: rows[0].id,
    tenantId: rows[0].tenant_id,
    leaseId: rows[0].lease_id,
    amount: rows[0].amount,
    paymentType: rows[0].payment_type,
    failureReason,
  }).catch(err => console.error('[stripe-webhook] payment email:', err.message));
}

// ── charge.dispute.created ────────────────────────────────────────────────────
async function onDispute(dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) {
    console.warn('[stripe-webhook] dispute without charge id:', dispute.id);
    return;
  }

  const { rows } = await pool.query(
    `SELECT p.id AS payment_id, p.tenant_id, p.amount,
            l.unit_id, u.property_id,
            pa.user_id AS manager_id
       FROM payments p
       JOIN leases           l  ON l.id = p.lease_id
       JOIN units            u  ON u.id = l.unit_id
       LEFT JOIN property_assignments pa ON pa.property_id = u.property_id
      WHERE p.stripe_charge_id = $1
      LIMIT 1`,
    [chargeId]
  );

  if (!rows[0]) return;

  await pool.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at)
     VALUES ($1, 'charge_disputed',
             'Payment Dispute Opened',
             $2,
             'in_app', 'payment', $3, NOW())`,
    [
      rows[0].manager_id ?? rows[0].tenant_id,
      `A dispute was opened on payment $${parseFloat(rows[0].amount).toFixed(2)}.`,
      rows[0].payment_id,
    ]
  );

  console.warn(`[stripe-webhook] dispute created on charge ${chargeId}`);
}

// ���─ Helper: process payment splits ────────────────────────────────────────────
async function processSplits(client, paymentId, leaseId, totalAmount, pi) {
  // Fetch split config from the property's org vendors (if any vendor auto-splits exist)
  // For now we create the owner split; vendor splits are added when work orders are invoiced.
  const { rows: leaseRows } = await client.query(
    `SELECT u.property_id, p.org_id, o.owner_id
       FROM leases l
       JOIN units      u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN organizations o ON o.id = p.org_id
      WHERE l.id = $1`,
    [leaseId]
  );

  if (!leaseRows[0]) return;

  const { owner_id } = leaseRows[0];

  // Insert owner split row (full amount minus platform fee — adjust % as needed)
  const platformFeeRate  = 0.01;          // 1% platform fee
  const platformFee      = Math.round(parseFloat(totalAmount) * platformFeeRate * 100) / 100;
  const ownerAmount      = parseFloat(totalAmount) - platformFee;

  // Owner split
  await client.query(
    `INSERT INTO payment_splits
       (payment_id, recipient_type, recipient_user_id, amount, payout_status)
     VALUES ($1, 'owner', $2, $3, 'pending')`,
    [paymentId, owner_id, ownerAmount]
  );
  // Platform fee tracked in metadata for now; add a platform_fees table in a future sprint.
}

module.exports = router;
