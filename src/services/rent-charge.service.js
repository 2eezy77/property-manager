/**
 * Shared rent/deposit charge preparation for ACH and Cash App Pay.
 */

const rentBilling = require('./rent-billing.service');
const stripe = require('./stripe.service');
const { roundMoney, parseMoney } = require('./security-deposit-partial.service');
const {
  MIN_RENT_INSTALLMENT,
  allocateTowardRentAndFees,
} = require('./rent-partial.service');
const {
  MIN_DEPOSIT_INSTALLMENT,
  resolveDepositChargeAmount,
  resolveRentChargeAmount,
} = require('./charge-amount-policy');

async function assertNoInFlightDeposit(client, leaseId) {
  // Only block in-flight processing. Succeeded installments are expected while a
  // pending remaining-balance row still exists.
  const { rows: inFlight } = await client.query(
    `SELECT id FROM payments
      WHERE lease_id = $1 AND payment_type = 'security_deposit'
        AND status = 'processing'`,
    [leaseId]
  );
  if (inFlight.length > 0) {
    const err = new Error('A security deposit payment is already in progress.');
    err.code = 'DUPLICATE_PAYMENT';
    throw err;
  }
}

/**
 * Cancel an abandoned PaymentIntent, or signal that Stripe already finished it.
 * Returns { action: 'canceled'|'noop'|'succeeded'|'processing', pi }.
 */
async function cancelReplacedDepositPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return { action: 'noop', pi: null };

  const pi = await stripe.retrievePaymentIntent(paymentIntentId);
  if (pi.status === 'succeeded') {
    return { action: 'succeeded', pi };
  }
  if (pi.status === 'processing') {
    const err = new Error('A payment is already in progress.');
    err.code = 'DUPLICATE_PAYMENT';
    throw err;
  }
  if (pi.status === 'canceled') return { action: 'noop', pi };

  try {
    await stripe.cancelPaymentIntent(paymentIntentId);
    return { action: 'canceled', pi };
  } catch (cancelErr) {
    const refreshed = await stripe.retrievePaymentIntent(paymentIntentId);
    if (refreshed.status === 'succeeded') {
      return { action: 'succeeded', pi: refreshed };
    }
    if (refreshed.status === 'processing') {
      const err = new Error('A payment is already in progress.');
      err.code = 'DUPLICATE_PAYMENT';
      throw err;
    }
    if (refreshed.status !== 'canceled') throw cancelErr;
    return { action: 'noop', pi: refreshed };
  }
}

async function syncLocalPaymentIfStripeSucceeded(client, paymentRow, pi) {
  if (!paymentRow?.id || !pi || pi.status !== 'succeeded') return false;
  if (paymentRow.status === 'succeeded') return true;

  await client.query(
    `UPDATE payments
        SET status = 'succeeded',
            stripe_charge_id = COALESCE(stripe_charge_id, $2),
            paid_at = COALESCE(paid_at, NOW()),
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND status <> 'succeeded'`,
    [
      paymentRow.id,
      typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null,
      JSON.stringify({
        synced_from_stripe_at: new Date().toISOString(),
        sync_note: 'Local row lagged behind succeeded Stripe PaymentIntent.',
      }),
    ]
  );
  return true;
}

async function prepareTenantCharge(client, {
  tenantId,
  leaseId,
  paymentType = 'rent',
  bankAccountId = null,
  metadataExtra = {},
  amount = null,
}) {
  if (!['rent', 'security_deposit'].includes(paymentType)) {
    const err = new Error('UNSUPPORTED_PAYMENT_TYPE');
    err.code = 'UNSUPPORTED_PAYMENT_TYPE';
    throw err;
  }

  const { rows: leaseRows } = await client.query(
    `SELECT id, monthly_rent, security_deposit, tenant_id FROM leases
      WHERE id = $1
        AND tenant_id = $2
        AND (
          ($3 = 'security_deposit' AND status IN ('active', 'awaiting_deposit', 'awaiting_identity'))
          OR ($3 = 'rent' AND status = 'active')
        )`,
    [leaseId, tenantId, paymentType]
  );
  const lease = leaseRows[0];
  if (!lease) {
    const err = new Error('LEASE_NOT_FOUND');
    err.code = 'LEASE_NOT_FOUND';
    throw err;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().split('T')[0];

  let amountDollars;
  let amountCents;
  let description;
  let chargeMeta = { ...metadataExtra };
  let payment;
  let rentAmount;
  let lateFeeAmount;

  if (paymentType === 'security_deposit') {
    await assertNoInFlightDeposit(client, leaseId);

    const { rows: depRows } = await client.query(
      `SELECT id, amount, period_start, period_end, due_date, stripe_payment_intent_id, metadata
         FROM payments
        WHERE lease_id = $1 AND payment_type = 'security_deposit'
          AND status = 'pending'
        ORDER BY due_date ASC
        LIMIT 1
        FOR UPDATE`,
      [leaseId]
    );
    if (!depRows[0]) {
      const err = new Error('No pending security deposit on file.');
      err.code = 'NO_DEPOSIT_DUE';
      throw err;
    }

    const parent = depRows[0];
    const parentPi = await cancelReplacedDepositPaymentIntent(parent.stripe_payment_intent_id);
    if (parentPi.action === 'succeeded') {
      await syncLocalPaymentIfStripeSucceeded(client, parent, parentPi.pi);
      const { applyDepositCredit } = require('./security-deposit-partial.service');
      const meta = parent.metadata || {};
      if (meta.partial_installment === true || meta.partial_installment === 'true') {
        await applyDepositCredit(client, {
          leaseId,
          creditAmount: parseMoney(parent.amount),
          installmentPaymentId: parent.id,
          paidAt: new Date(),
          partMeta: { source: 'stripe_sync' },
        });
      } else {
        await client.query(
          `UPDATE leases
              SET deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1`,
          [leaseId]
        );
      }
      const err = new Error('This deposit was already paid. Refresh to see your updated balance.');
      err.code = 'NOTHING_DUE';
      throw err;
    }

    // Cancel abandoned pending installment rows for this deposit so only one open PI exists.
    const { rows: openInstallments } = await client.query(
      `SELECT id, stripe_payment_intent_id, amount, status, metadata
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'security_deposit'
          AND status = 'pending'
          AND id <> $2
          AND COALESCE(metadata->>'partial_installment', 'false') = 'true'`,
      [leaseId, parent.id]
    );
    for (const row of openInstallments) {
      const res = await cancelReplacedDepositPaymentIntent(row.stripe_payment_intent_id);
      if (res.action === 'succeeded') {
        await syncLocalPaymentIfStripeSucceeded(client, row, res.pi);
        continue;
      }
      await client.query(
        `UPDATE payments
            SET status = 'failed',
                failure_reason = 'Superseded by a new deposit payment attempt',
                updated_at = NOW()
          WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
    }

    const {
      requested,
      remaining,
      isPartial,
    } = resolveDepositChargeAmount({
      amount,
      remaining: parent.amount,
      minInstallment: MIN_DEPOSIT_INSTALLMENT,
    });

    const parentMeta = parent.metadata || {};
    const priorPaid = parseMoney(parentMeta.deposit_paid_total);
    const depositPaidTotal = Number.isFinite(priorPaid) ? priorPaid : 0;
    const original = parseMoney(parentMeta.deposit_original_amount);
    const depositOriginal = Number.isFinite(original)
      ? original
      : roundMoney(
        Number.isFinite(parseMoney(lease.security_deposit))
          ? parseMoney(lease.security_deposit)
          : remaining + depositPaidTotal
      );

    amountDollars = requested;
    amountCents = Math.round(amountDollars * 100);
    description = isPartial
      ? `Security deposit payment ($${amountDollars.toFixed(2)} of $${remaining.toFixed(2)} remaining)`
      : 'Security deposit';
    chargeMeta = {
      ...chargeMeta,
      payment_kind: 'security_deposit',
      deposit_remaining_before: remaining.toFixed(2),
      deposit_original_amount: depositOriginal.toFixed(2),
      deposit_paid_total: depositPaidTotal.toFixed(2),
    };

    if (isPartial) {
      chargeMeta.partial_installment = true;
      chargeMeta.parent_deposit_payment_id = parent.id;
      const { rows: [inserted] } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, bank_account_id, amount, currency,
            status, payment_type, period_start, period_end, due_date, metadata)
         VALUES ($1,$2,$3,$4,'USD','pending','security_deposit',$5,$6,$7,$8)
         RETURNING id`,
        [
          leaseId,
          tenantId,
          bankAccountId,
          amountDollars,
          parent.period_start,
          parent.period_end,
          parent.due_date,
          JSON.stringify(chargeMeta),
        ]
      );
      payment = inserted;

      // Keep parent metadata/original totals accurate without changing remaining yet.
      await client.query(
        `UPDATE payments
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [
          parent.id,
          JSON.stringify({
            deposit_original_amount: depositOriginal,
            deposit_paid_total: depositPaidTotal,
            partial_deposit: depositPaidTotal > 0,
          }),
        ]
      );
    } else {
      payment = { id: parent.id };
      await client.query(
        `UPDATE payments
            SET amount = $1,
                bank_account_id = $2,
                metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = NOW()
          WHERE id = $4`,
        [
          amountDollars,
          bankAccountId,
          JSON.stringify({
            ...chargeMeta,
            deposit_original_amount: depositOriginal,
            deposit_paid_total: depositPaidTotal,
            partial_installment: false,
          }),
          parent.id,
        ]
      );
    }
  } else {
    // Rent (optional amount — pay any portion of rent remaining + late fees).
    const { rows: processing } = await client.query(
      `SELECT id FROM payments
        WHERE lease_id = $1 AND payment_type = 'rent'
          AND period_start = $2 AND status = 'processing'`,
      [leaseId, monthStart]
    );
    if (processing.length > 0) {
      const err = new Error('A rent payment is already in progress.');
      err.code = 'DUPLICATE_PAYMENT';
      throw err;
    }

    const breakdown = await rentBilling.computeChargeBreakdown(client, leaseId, { monthStart });
    const rentRemaining = breakdown.rentAmount;
    const lateFeeBalance = breakdown.lateFeeAmount;
    const {
      requested,
      totalRemaining,
      isPartial,
    } = resolveRentChargeAmount({
      amount,
      totalRemaining: breakdown.totalAmount,
      minInstallment: MIN_RENT_INSTALLMENT,
    });

    const alloc = allocateTowardRentAndFees(requested, rentRemaining, lateFeeBalance);
    rentAmount = alloc.rentPortion;
    lateFeeAmount = alloc.lateFeePortion;
    amountDollars = alloc.totalAllocated;
    amountCents = Math.round(amountDollars * 100);

    const dueDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().split('T')[0];
    const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    description = isPartial
      ? `Partial rent payment ($${amountDollars.toFixed(2)} of $${totalRemaining.toFixed(2)}) — ${monthLabel}`
      : (lateFeeAmount > 0
        ? `Rent + late fees — ${monthLabel}`
        : `Rent — ${monthLabel}`);

    const { rows: pendingRows } = await client.query(
      `SELECT id, amount, stripe_payment_intent_id, metadata
         FROM payments
        WHERE lease_id = $1 AND payment_type = 'rent'
          AND period_start = $2 AND status = 'pending'
          AND COALESCE(metadata->>'partial_installment', 'false') <> 'true'
        FOR UPDATE`,
      [leaseId, monthStart]
    );

    let parent = pendingRows[0];
    if (!parent) {
      const { rows: [inserted] } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, bank_account_id, amount, currency,
            status, payment_type, period_start, period_end, due_date, metadata)
         VALUES ($1,$2,$3,$4,'USD','pending','rent',$5,$6,$7,$8)
         RETURNING id, amount, stripe_payment_intent_id, metadata`,
        [
          leaseId, tenantId, bankAccountId, rentRemaining > 0 ? rentRemaining : breakdown.monthlyRent,
          monthStart, monthEnd, dueDate.toISOString().split('T')[0],
          JSON.stringify({
            rent_original_amount: breakdown.monthlyRent,
            rent_paid_total: breakdown.paidThisMonth,
          }),
        ]
      );
      parent = inserted;
    } else {
      const parentPi = await cancelReplacedDepositPaymentIntent(parent.stripe_payment_intent_id);
      if (parentPi.action === 'succeeded') {
        await syncLocalPaymentIfStripeSucceeded(client, parent, parentPi.pi);
        const { settleRentPaymentSuccess } = require('../utils/payment-settlement');
        await settleRentPaymentSuccess(client, {
          paymentId: parent.id,
          leaseId,
          amount: parseMoney(parent.amount),
        });
        const err = new Error('This period was already paid. Refresh to see your updated balance.');
        err.code = 'NOTHING_DUE';
        throw err;
      }
      // Keep parent amount = rent remaining (not late fees).
      await client.query(
        `UPDATE payments
            SET amount = $1,
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $3`,
        [
          rentRemaining > 0 ? rentRemaining : roundMoney(parent.amount),
          JSON.stringify({
            rent_original_amount: breakdown.monthlyRent,
            rent_paid_total: breakdown.paidThisMonth,
          }),
          parent.id,
        ]
      );
    }

    // Cancel abandoned pending installment rows for this period.
    const { rows: openInstallments } = await client.query(
      `SELECT id, stripe_payment_intent_id, amount, status, metadata
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'rent'
          AND period_start = $2
          AND status = 'pending'
          AND id <> $3
          AND COALESCE(metadata->>'partial_installment', 'false') = 'true'`,
      [leaseId, monthStart, parent.id]
    );
    for (const row of openInstallments) {
      const res = await cancelReplacedDepositPaymentIntent(row.stripe_payment_intent_id);
      if (res.action === 'succeeded') {
        await syncLocalPaymentIfStripeSucceeded(client, row, res.pi);
        const { settleRentPaymentSuccess } = require('../utils/payment-settlement');
        await settleRentPaymentSuccess(client, {
          paymentId: row.id,
          leaseId,
          amount: parseMoney(row.amount),
        });
        continue;
      }
      await client.query(
        `UPDATE payments
            SET status = 'failed',
                failure_reason = 'Superseded by a new rent payment attempt',
                updated_at = NOW()
          WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
    }

    chargeMeta = {
      ...chargeMeta,
      payment_kind: 'rent',
      rent_amount: rentAmount.toFixed(2),
      late_fee_amount: lateFeeAmount.toFixed(2),
      rent_remaining_before: rentRemaining.toFixed(2),
      late_fee_balance_before: lateFeeBalance.toFixed(2),
      total_remaining_before: totalRemaining.toFixed(2),
      rent_original_amount: breakdown.monthlyRent.toFixed(2),
      rent_paid_total: breakdown.paidThisMonth.toFixed(2),
      partial_rent: isPartial,
    };

    if (isPartial) {
      chargeMeta.partial_installment = true;
      chargeMeta.parent_rent_payment_id = parent.id;
      const { rows: [inserted] } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, bank_account_id, amount, currency,
            status, payment_type, period_start, period_end, due_date, metadata)
         VALUES ($1,$2,$3,$4,'USD','pending','rent',$5,$6,$7,$8)
         RETURNING id`,
        [
          leaseId,
          tenantId,
          bankAccountId,
          amountDollars,
          monthStart,
          monthEnd,
          dueDate.toISOString().split('T')[0],
          JSON.stringify(chargeMeta),
        ]
      );
      payment = inserted;
    } else {
      // Full remaining: charge against parent. Row amount = total charged;
      // rent_amount metadata drives remaining-balance math.
      payment = { id: parent.id };
      await client.query(
        `UPDATE payments
            SET amount = $1,
                bank_account_id = $2,
                metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = NOW()
          WHERE id = $4`,
        [
          amountDollars,
          bankAccountId,
          JSON.stringify({
            ...chargeMeta,
            partial_installment: false,
          }),
          parent.id,
        ]
      );
    }
  }

  return {
    payment,
    lease,
    amountDollars,
    amountCents,
    description,
    chargeMeta,
    rentAmount,
    lateFeeAmount,
    monthStart,
  };
}

module.exports = {
  prepareTenantCharge,
  assertNoInFlightDeposit,
  cancelReplacedDepositPaymentIntent,
  MIN_DEPOSIT_INSTALLMENT,
  MIN_RENT_INSTALLMENT,
  resolveDepositChargeAmount,
  resolveRentChargeAmount,
};
