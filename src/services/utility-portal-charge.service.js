/**
 * Tenant portal pay for open utility splits (ACH / card / Cash App).
 * Keeps utility_bills / splits as the obligation source of truth;
 * creates payments.payment_type = 'utility' and links splits via payment_id.
 *
 * Payable once: payment_id IS NULL + bill notified/charging. pending is allowed
 * only under that bill gate so recalc desync cannot block pay, but paid/charging
 * rows are never selected.
 */

const PAYABLE_SPLIT_STATUSES = ['pending', 'notified', 'disputed', 'failed'];

async function listOpenUtilitySplits(client, tenantId, { leaseId = null, splitId = null, forUpdate = false } = {}) {
  const params = [tenantId];
  const conditions = [
    's.tenant_id = $1',
    `s.status::text = ANY($${params.length + 1}::text[])`,
    's.payment_id IS NULL',
    's.amount > 0',
    `ub.status IN ('notified', 'charging')`,
  ];
  params.push(PAYABLE_SPLIT_STATUSES);

  if (leaseId) {
    params.push(leaseId);
    conditions.push(`s.lease_id = $${params.length}`);
  }
  if (splitId) {
    params.push(splitId);
    conditions.push(`s.id = $${params.length}`);
  }

  const lock = forUpdate ? ' FOR UPDATE OF s' : '';
  const { rows } = await client.query(
    `SELECT s.id AS split_id,
            s.lease_id,
            s.tenant_id,
            s.amount,
            s.status AS split_status,
            s.payment_id,
            ub.id AS bill_id,
            ub.service_type,
            ub.provider_name,
            ub.period_start,
            ub.period_end,
            ub.due_date,
            ub.status AS bill_status,
            p.name AS property_name
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN properties p ON p.id = ub.property_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ub.period_end ASC, ub.service_type ASC, s.created_at ASC${lock}`,
    params
  );
  return rows;
}

function summarizeOpenUtilities(splits) {
  const total = splits.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  return {
    utilityDue: Math.round(total * 100) / 100,
    utilitySplits: splits.map((s) => ({
      id: s.split_id,
      billId: s.bill_id,
      leaseId: s.lease_id,
      amount: Number(s.amount),
      status: s.split_status,
      serviceType: s.service_type,
      providerName: s.provider_name,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      dueDate: s.due_date,
      propertyName: s.property_name,
    })),
  };
}

/**
 * Create one utility payment covering one or all open splits for the tenant/lease.
 * All covered splits get payment_id set and status → charging.
 */
async function prepareUtilityPortalCharge(client, {
  tenantId,
  leaseId,
  splitId = null,
  bankAccountId = null,
  metadataExtra = {},
}) {
  const { rows: leaseRows } = await client.query(
    `SELECT id, tenant_id, status FROM leases
      WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
    [leaseId, tenantId]
  );
  if (!leaseRows[0]) {
    const err = new Error('LEASE_NOT_FOUND');
    err.code = 'LEASE_NOT_FOUND';
    throw err;
  }

  const splits = await listOpenUtilitySplits(client, tenantId, { leaseId, splitId, forUpdate: true });
  if (!splits.length) {
    const err = new Error('No open utility balance to pay.');
    err.code = 'NOTHING_DUE';
    throw err;
  }

  // Guard: all splits must belong to the same lease (caller supplied leaseId).
  if (splits.some((s) => s.lease_id !== leaseId)) {
    const err = new Error('Utility shares must match the selected lease.');
    err.code = 'LEASE_MISMATCH';
    throw err;
  }

  // Re-check after FOR UPDATE — another charge must not have claimed a share.
  if (
    splits.some(
      (s) =>
        s.payment_id != null
        || !PAYABLE_SPLIT_STATUSES.includes(String(s.split_status))
    )
  ) {
    const err = new Error('No open utility balance to pay.');
    err.code = 'NOTHING_DUE';
    throw err;
  }

  const amountDollars = Math.round(
    splits.reduce((sum, s) => sum + Number(s.amount || 0), 0) * 100
  ) / 100;
  if (amountDollars <= 0.009) {
    const err = new Error('No open utility balance to pay.');
    err.code = 'NOTHING_DUE';
    throw err;
  }
  const amountCents = Math.round(amountDollars * 100);

  const services = [...new Set(splits.map((s) => s.service_type))];
  const description = services.length === 1
    ? `Utility share (${services[0]})`
    : `Utility shares (${services.join(', ')})`;

  const splitIds = splits.map((s) => s.split_id);
  const billIds = [...new Set(splits.map((s) => s.bill_id))];
  const dueDate = splits.map((s) => s.due_date).filter(Boolean).sort()[0] || null;

  const chargeMeta = {
    ...metadataExtra,
    utility_split_ids: splitIds,
    utility_bill_ids: billIds,
    portal_utility: true,
  };

  const { rows: [payment] } = await client.query(
    `INSERT INTO payments
       (lease_id, tenant_id, bank_account_id, amount, currency,
        status, payment_type, due_date, metadata)
     VALUES ($1,$2,$3,$4,'USD','pending','utility',$5,$6::jsonb)
     RETURNING *`,
    [
      leaseId,
      tenantId,
      bankAccountId,
      amountDollars,
      dueDate,
      JSON.stringify(chargeMeta),
    ]
  );

  const { rowCount: claimed } = await client.query(
    `UPDATE utility_bill_splits
        SET payment_id = $1,
            status = 'charging',
            updated_at = NOW()
      WHERE id = ANY($2::uuid[])
        AND payment_id IS NULL
        AND status::text = ANY($3::text[])`,
    [payment.id, splitIds, PAYABLE_SPLIT_STATUSES]
  );

  if (Number(claimed) !== splitIds.length) {
    const err = new Error('No open utility balance to pay.');
    err.code = 'NOTHING_DUE';
    throw err;
  }

  await client.query(
    `UPDATE utility_bills
        SET status = 'charging', updated_at = NOW()
      WHERE id = ANY($1::uuid[])
        AND status = 'notified'`,
    [billIds]
  );

  return {
    payment,
    amountDollars,
    amountCents,
    description,
    chargeMeta,
    splits,
    splitIds,
    billIds,
  };
}

/**
 * Abandoned / failed Stripe utility pays must clear payment_id so portal retry works.
 * (onFailed already did this; onCanceled + Cash App sync failure did not.)
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @returns {Promise<string[]>} distinct bill ids touched
 */
async function releaseUtilitySplitsForFailedPayment(db, paymentId) {
  if (!paymentId) return [];
  const { rows } = await db.query(
    `UPDATE utility_bill_splits
        SET status = 'failed',
            payment_id = NULL,
            updated_at = NOW()
      WHERE payment_id = $1
        AND status <> 'paid'
     RETURNING bill_id`,
    [paymentId]
  );
  return [...new Set(rows.map((r) => r.bill_id).filter(Boolean))];
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @returns {Promise<string[]>} distinct bill ids touched
 */
async function markUtilitySplitsPaidForPayment(db, paymentId) {
  if (!paymentId) return [];
  const { rows } = await db.query(
    `UPDATE utility_bill_splits
        SET status = 'paid',
            updated_at = NOW()
      WHERE payment_id = $1
     RETURNING bill_id`,
    [paymentId]
  );
  return [...new Set(rows.map((r) => r.bill_id).filter(Boolean))];
}

module.exports = {
  PAYABLE_SPLIT_STATUSES,
  listOpenUtilitySplits,
  summarizeOpenUtilities,
  prepareUtilityPortalCharge,
  releaseUtilitySplitsForFailedPayment,
  markUtilitySplitsPaidForPayment,
};
