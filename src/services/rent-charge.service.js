/**
 * Shared rent/deposit charge preparation for ACH and Cash App Pay.
 */

const rentBilling = require('./rent-billing.service');

async function prepareTenantCharge(client, {
  tenantId,
  leaseId,
  paymentType = 'rent',
  bankAccountId = null,
  metadataExtra = {},
}) {
  const { rows: leaseRows } = await client.query(
    `SELECT id, monthly_rent, tenant_id FROM leases
      WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
    [leaseId, tenantId]
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
    const { rows: depRows } = await client.query(
      `SELECT id, amount, period_start, period_end, due_date
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
    amountDollars = parseFloat(depRows[0].amount);
    amountCents = Math.round(amountDollars * 100);
    description = 'Security deposit';
    chargeMeta = { ...chargeMeta, payment_kind: 'security_deposit' };
    payment = { id: depRows[0].id };

    await client.query(
      `UPDATE payments
          SET amount = $1, bank_account_id = $2, metadata = $3, updated_at = NOW()
        WHERE id = $4`,
      [amountDollars, bankAccountId, JSON.stringify(chargeMeta), depRows[0].id]
    );
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
    amountDollars,
    amountCents,
    description,
    chargeMeta,
    rentAmount,
    lateFeeAmount,
    monthStart,
  };
}

module.exports = { prepareTenantCharge };
