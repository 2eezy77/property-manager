/**
 * Shared rent/deposit charge preparation for ACH and Cash App Pay.
 */

const rentBilling = require('./rent-billing.service');
const stripe = require('./stripe.service');
const { roundMoney, parseMoney } = require('./security-deposit-partial.service');

const MIN_DEPOSIT_INSTALLMENT = 1;

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

async function cancelReplacedDepositPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return;

  const pi = await stripe.retrievePaymentIntent(paymentIntentId);
  if (pi.status === 'succeeded' || pi.status === 'processing') {
    const err = new Error('A security deposit payment is already in progress or complete.');
    err.code = 'DUPLICATE_PAYMENT';
    throw err;
  }
  if (pi.status === 'canceled') return;

  try {
    await stripe.cancelPaymentIntent(paymentIntentId);
  } catch (cancelErr) {
    const refreshed = await stripe.retrievePaymentIntent(paymentIntentId);
    if (refreshed.status === 'succeeded' || refreshed.status === 'processing') {
      const err = new Error('A security deposit payment is already in progress or complete.');
      err.code = 'DUPLICATE_PAYMENT';
      throw err;
    }
    if (refreshed.status !== 'canceled') throw cancelErr;
  }
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
    await cancelReplacedDepositPaymentIntent(parent.stripe_payment_intent_id);

    // Cancel abandoned pending installment rows for this deposit so only one open PI exists.
    const { rows: openInstallments } = await client.query(
      `SELECT id, stripe_payment_intent_id
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'security_deposit'
          AND status = 'pending'
          AND id <> $2
          AND COALESCE(metadata->>'partial_installment', 'false') = 'true'`,
      [leaseId, parent.id]
    );
    for (const row of openInstallments) {
      await cancelReplacedDepositPaymentIntent(row.stripe_payment_intent_id);
      await client.query(
        `UPDATE payments
            SET status = 'failed',
                failure_reason = 'Superseded by a new deposit payment attempt',
                updated_at = NOW()
          WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
    }

    const remaining = roundMoney(parent.amount);
    const requestedRaw = amount == null || amount === '' ? remaining : parseMoney(amount);
    if (!Number.isFinite(requestedRaw)) {
      const err = new Error('Enter a valid deposit amount.');
      err.code = 'INVALID_DEPOSIT_AMOUNT';
      throw err;
    }
    const requested = roundMoney(requestedRaw);
    if (requested < MIN_DEPOSIT_INSTALLMENT) {
      const err = new Error(`Minimum deposit payment is $${MIN_DEPOSIT_INSTALLMENT.toFixed(2)}.`);
      err.code = 'INVALID_DEPOSIT_AMOUNT';
      throw err;
    }
    if (requested > remaining + 0.001) {
      const err = new Error(`Deposit payment cannot exceed the $${remaining.toFixed(2)} still owed.`);
      err.code = 'INVALID_DEPOSIT_AMOUNT';
      throw err;
    }

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

    const isPartial = requested < remaining - 0.001;
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
    if (paymentType === 'rent') {
      const { rows: inFlight } = await client.query(
        `SELECT id FROM payments
          WHERE lease_id = $1 AND payment_type = 'rent'
            AND period_start = $2 AND status IN ('processing','succeeded')`,
        [leaseId, monthStart]
      );
      if (inFlight.length > 0) {
        const err = new Error('A payment for this period is already in progress or complete.');
        err.code = 'DUPLICATE_PAYMENT';
        throw err;
      }
    }

    const breakdown = await rentBilling.computeChargeBreakdown(client, leaseId);
    rentAmount = breakdown.rentAmount;
    lateFeeAmount = breakdown.lateFeeAmount;
    amountDollars = breakdown.totalAmount;
    amountCents = Math.round(amountDollars * 100);

    const dueDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().split('T')[0];
    const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    description = lateFeeAmount > 0
      ? `Rent + late fees — ${monthLabel}`
      : `Rent — ${monthLabel}`;

    chargeMeta = {
      ...chargeMeta,
      rent_amount: rentAmount.toFixed(2),
      late_fee_amount: lateFeeAmount.toFixed(2),
    };

    const { rows: pendingRows } = await client.query(
      `SELECT id FROM payments
        WHERE lease_id = $1 AND payment_type = 'rent'
          AND period_start = $2 AND status = 'pending'
        FOR UPDATE`,
      [leaseId, monthStart]
    );

    if (pendingRows[0]) {
      const { rows: [updated] } = await client.query(
        `UPDATE payments
            SET amount = $1, bank_account_id = $2,
                metadata = $3, updated_at = NOW()
          WHERE id = $4
         RETURNING id`,
        [amountDollars, bankAccountId, JSON.stringify(chargeMeta), pendingRows[0].id]
      );
      payment = updated;
    } else {
      const { rows: [inserted] } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, bank_account_id, amount, currency,
            status, payment_type, period_start, period_end, due_date, metadata)
         VALUES ($1,$2,$3,$4,'USD','pending',$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          leaseId, tenantId, bankAccountId, amountDollars,
          paymentType, monthStart, monthEnd, dueDate.toISOString().split('T')[0],
          JSON.stringify(chargeMeta),
        ]
      );
      payment = inserted;
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
};
