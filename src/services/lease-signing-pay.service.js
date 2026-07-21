/**
 * Manager lease-signing compensation — $350 per fully signed lease.
 * Payable only after the tenant has paid 3 months of rent (succeeded).
 */

const pool = require('../db/client');
const { resolveOrgIdForUser } = require('./site-visits.service');
const { getPropertyBank } = require('./property-bank.service');
const stripe = require('./stripe.service');
const plaid = require('./plaid.service');
const { decrypt } = require('../utils/encryption');
const {
  STRIPE_OWNER_PAY_METHODS,
  getOwnerStripePayContext,
  ensureManagerConnectAccount,
  requireConnectTransfersReady,
  getDefaultPayoutBankFull,
  getPropertyBankForAch,
  wrapStripePayrollError,
} = require('./site-visits-payout.service');

const MANAGER_EMAIL = 'konstantinhazlett@yahoo.com';
const LEASE_SIGNING_AMOUNT_CENTS = 35000;
const RENT_MONTHS_REQUIRED = 3;

const SIGNED_LEASE_STATUSES = new Set(['active', 'terminated', 'expired']);
const ENDED_LEASE_STATUSES = new Set(['terminated', 'expired']);

async function resolveOrgManager(orgId) {
  const { rows: byEmail } = await pool.query(
    `SELECT id, first_name, last_name, email
       FROM users
      WHERE org_id = $1 AND LOWER(email) = LOWER($2) AND role = 'property_manager'
      LIMIT 1`,
    [orgId, MANAGER_EMAIL]
  );
  if (byEmail.length) return byEmail[0];

  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, email
       FROM users
      WHERE org_id = $1 AND role = 'property_manager'
      ORDER BY created_at ASC
      LIMIT 1`,
    [orgId]
  );
  return rows[0] ?? null;
}

async function resolveOrgIdForLease(leaseId) {
  const { rows } = await pool.query(
    `SELECT p.org_id
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE l.id = $1`,
    [leaseId]
  );
  return rows[0]?.org_id ?? null;
}

async function countSucceededRentMonths(leaseId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS months
       FROM (
         SELECT DISTINCT COALESCE(period_start, DATE_TRUNC('month', created_at)::date) AS rent_month
           FROM payments
          WHERE lease_id = $1
            AND payment_type = 'rent'
            AND status = 'succeeded'
       ) m`,
    [leaseId]
  );
  return rows[0]?.months ?? 0;
}

function feeToJson(row) {
  if (!row) return null;
  const rentMonthsPaid = row.rent_months_paid ?? 0;
  return {
    id: row.id,
    orgId: row.org_id,
    managerId: row.manager_id,
    leaseId: row.lease_id,
    amountCents: row.amount_cents,
    amountDollars: row.amount_cents / 100,
    signedAt: row.signed_at,
    status: row.status,
    paymentMethod: row.payment_method,
    paidBy: row.paid_by,
    paidAt: row.paid_at,
    note: row.note,
    eligibleAt: row.eligible_at,
    rentMonthsPaid,
    rentMonthsRequired: RENT_MONTHS_REQUIRED,
    rentMonthsRemaining: Math.max(0, RENT_MONTHS_REQUIRED - rentMonthsPaid),
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    tenantName: row.tenant_name?.trim() || null,
    tenantEmail: row.tenant_email,
    unitNumber: row.unit_number,
    propertyName: row.property_name,
    leaseStart: row.start_date,
    leaseStatus: row.lease_status,
  };
}

async function loadFeeById(feeId, orgId) {
  const { rows } = await pool.query(
    `SELECT f.*,
            un.unit_number,
            p.name AS property_name,
            l.status AS lease_status,
            l.start_date,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name,
            u.email AS tenant_email
       FROM manager_lease_signing_fees f
       JOIN leases l ON l.id = f.lease_id
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
      WHERE f.id = $1 AND f.org_id = $2`,
    [feeId, orgId]
  );
  return rows[0] ?? null;
}

/**
 * Promote pending_rent → owed after 3 rent months, or cancel if tenant left early.
 */
function tenantLeftEarly(leaseRow) {
  if (ENDED_LEASE_STATUSES.has(leaseRow.lease_status)) return true;
  if (leaseRow.offboard_moveout_confirmed_at) return true;
  if (leaseRow.offboard_portal_disabled_at) return true;
  if (leaseRow.offboarding_started_at && leaseRow.offboard_keys_returned_at) return true;
  return false;
}

async function refreshFeeEligibility(feeId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.status, f.lease_id, l.status AS lease_status,
            l.offboarding_started_at, l.offboard_moveout_confirmed_at,
            l.offboard_portal_disabled_at, l.offboard_keys_returned_at
       FROM manager_lease_signing_fees f
       JOIN leases l ON l.id = f.lease_id
      WHERE f.id = $1`,
    [feeId]
  );
  const fee = rows[0];
  if (!fee || fee.status === 'paid' || fee.status === 'cancelled') return fee?.status;

  const rentMonths = await countSucceededRentMonths(fee.lease_id);

  if (rentMonths >= RENT_MONTHS_REQUIRED) {
    await pool.query(
      `UPDATE manager_lease_signing_fees
          SET status = 'owed',
              rent_months_paid = $1,
              eligible_at = COALESCE(eligible_at, NOW()),
              updated_at = NOW()
        WHERE id = $2 AND status = 'pending_rent'`,
      [rentMonths, feeId]
    );
    return 'owed';
  }

  if (tenantLeftEarly(fee)) {
    await pool.query(
      `UPDATE manager_lease_signing_fees
          SET status = 'cancelled',
              rent_months_paid = $1,
              cancelled_at = COALESCE(cancelled_at, NOW()),
              cancel_reason = COALESCE(
                cancel_reason,
                'Tenant left before paying 3 months of rent — signing fee not payable.'
              ),
              updated_at = NOW()
        WHERE id = $2 AND status IN ('pending_rent', 'owed')`,
      [rentMonths, feeId]
    );
    return 'cancelled';
  }

  await pool.query(
    `UPDATE manager_lease_signing_fees
        SET rent_months_paid = $1, updated_at = NOW()
      WHERE id = $2 AND status = 'pending_rent'`,
    [rentMonths, feeId]
  );
  return 'pending_rent';
}

async function refreshOrgEligibility(orgId) {
  const { rows } = await pool.query(
    `SELECT id FROM manager_lease_signing_fees
      WHERE org_id = $1 AND status = 'pending_rent'`,
    [orgId]
  );
  for (const row of rows) {
    await refreshFeeEligibility(row.id);
  }
}

async function refreshEligibilityForLease(leaseId) {
  const { rows } = await pool.query(
    `SELECT id FROM manager_lease_signing_fees
      WHERE lease_id = $1 AND status = 'pending_rent'`,
    [leaseId]
  );
  for (const row of rows) {
    await refreshFeeEligibility(row.id);
  }
}

/**
 * Create signing fee when lease is fully signed (idempotent per lease).
 * Starts as pending_rent until 3 succeeded rent months.
 */
async function ensureLeaseSigningFee(leaseId, { signedAt } = {}) {
  const orgId = await resolveOrgIdForLease(leaseId);
  if (!orgId) return null;

  const manager = await resolveOrgManager(orgId);
  if (!manager) return null;

  const { rows: leaseRows } = await pool.query(
    `SELECT id, status, updated_at FROM leases WHERE id = $1`,
    [leaseId]
  );
  if (!leaseRows[0] || !SIGNED_LEASE_STATUSES.has(leaseRows[0].status)) return null;

  const when = signedAt || leaseRows[0].updated_at || new Date();
  const rentMonths = await countSucceededRentMonths(leaseId);

  const { rows } = await pool.query(
    `INSERT INTO manager_lease_signing_fees
       (org_id, manager_id, lease_id, amount_cents, signed_at, status, rent_months_paid)
     VALUES ($1, $2, $3, $4, $5, 'pending_rent', $6)
     ON CONFLICT (lease_id) DO NOTHING
     RETURNING id`,
    [orgId, manager.id, leaseId, LEASE_SIGNING_AMOUNT_CENTS, when, rentMonths]
  );

  let feeId = rows[0]?.id;
  if (!feeId) {
    const { rows: existing } = await pool.query(
      `SELECT id FROM manager_lease_signing_fees WHERE lease_id = $1`,
      [leaseId]
    );
    feeId = existing[0]?.id ?? null;
  }

  if (feeId) await refreshFeeEligibility(feeId);
  return feeId;
}

async function listLeaseSigningFees({ userId, userRole, status }) {
  const orgId = await resolveOrgIdForUser(userId);
  if (!orgId) {
    const err = new Error('No organization found.');
    err.statusCode = 400;
    throw err;
  }

  await refreshOrgEligibility(orgId);

  const params = [orgId];
  let conditions = ['f.org_id = $1'];

  if (userRole === 'property_manager') {
    params.push(userId);
    conditions.push(`f.manager_id = $${params.length}`);
  }

  if (['owed', 'paid', 'pending_rent', 'cancelled'].includes(status)) {
    params.push(status);
    conditions.push(`f.status = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT f.*,
            un.unit_number,
            p.name AS property_name,
            l.status AS lease_status,
            l.start_date,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name,
            u.email AS tenant_email
       FROM manager_lease_signing_fees f
       JOIN leases l ON l.id = f.lease_id
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.signed_at DESC`,
    params
  );

  const fees = rows.map(feeToJson);
  const owed = fees.filter((f) => f.status === 'owed');
  const paid = fees.filter((f) => f.status === 'paid');
  const pending = fees.filter((f) => f.status === 'pending_rent');
  const cancelled = fees.filter((f) => f.status === 'cancelled');

  const manager = await resolveOrgManager(orgId);
  const payoutBankFull = manager ? await getDefaultPayoutBankFull(manager.id) : null;
  const stripeContext = userRole !== 'property_manager' && manager
    ? await getOwnerStripePayContext(orgId, payoutBankFull)
    : {
      connectPayoutReady: null,
      cashAppPayAvailable: false,
      stripePayReady: false,
      propertyBankLinked: false,
      paymentMethods: [],
    };

  return {
    fees,
    policy: {
      amountPerLease: LEASE_SIGNING_AMOUNT_CENTS / 100,
      amountCents: LEASE_SIGNING_AMOUNT_CENTS,
      rentMonthsRequired: RENT_MONTHS_REQUIRED,
      managerEmail: MANAGER_EMAIL,
      rule: `Pay $${LEASE_SIGNING_AMOUNT_CENTS / 100} only after the tenant has paid ${RENT_MONTHS_REQUIRED} months of rent.`,
    },
    summary: {
      owedCount: owed.length,
      owedCents: owed.reduce((s, f) => s + f.amountCents, 0),
      paidCount: paid.length,
      paidCents: paid.reduce((s, f) => s + f.amountCents, 0),
      pendingCount: pending.length,
      cancelledCount: cancelled.length,
    },
    ...stripeContext,
    paymentMethods: stripeContext.paymentMethods,
  };
}

async function syncLeaseSigningFees(orgId) {
  const manager = await resolveOrgManager(orgId);
  if (!manager) {
    const err = new Error('No property manager found for this organization.');
    err.statusCode = 404;
    throw err;
  }

  const { rows: leases } = await pool.query(
    `SELECT l.id, l.updated_at, l.status, u.email AS tenant_email
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
      WHERE p.org_id = $1
        AND l.status IN ('active', 'terminated', 'expired')
        AND NOT EXISTS (
          SELECT 1 FROM manager_lease_signing_fees f WHERE f.lease_id = l.id
        )`,
    [orgId]
  );

  let created = 0;
  for (const lease of leases) {
    if (lease.status !== 'active') {
      const months = await countSucceededRentMonths(lease.id);
      if (months < RENT_MONTHS_REQUIRED) continue;
    }
    const id = await ensureLeaseSigningFee(lease.id, { signedAt: lease.updated_at });
    if (id) created += 1;
  }

  await refreshOrgEligibility(orgId);

  return { scanned: leases.length, created };
}

async function payLeaseSigningFee({
  orgId,
  ownerId,
  feeId,
  paymentMethod,
  note,
  ipAddress,
  userAgent,
}) {
  if (paymentMethod === 'cash_app') {
    const err = new Error('Use Cash App Pay on the lease-signing form — it opens your Cash App app to confirm.');
    err.statusCode = 400;
    err.code = 'USE_CASHAPP_INTENT';
    throw err;
  }

  if (!STRIPE_OWNER_PAY_METHODS.has(paymentMethod)) {
    const err = new Error('Pay through the portal with Cash App Pay or ACH. Off-app methods are not supported.');
    err.statusCode = 400;
    err.code = 'STRIPE_PAY_ONLY';
    throw err;
  }

  await refreshFeeEligibility(feeId);

  const row = await loadFeeById(feeId, orgId);
  if (!row) {
    const err = new Error('Lease signing fee not found.');
    err.statusCode = 404;
    throw err;
  }
  if (row.status === 'paid') {
    const err = new Error('This lease signing fee is already paid.');
    err.statusCode = 409;
    err.code = 'ALREADY_PAID';
    throw err;
  }
  if (row.stripe_payment_intent_id) {
    const err = new Error('A Stripe payment is already in progress for this lease-signing fee.');
    err.statusCode = 409;
    err.code = 'ALREADY_PROCESSING';
    throw err;
  }
  if (row.status === 'pending_rent') {
    const months = row.rent_months_paid ?? await countSucceededRentMonths(row.lease_id);
    const err = new Error(
      `Not payable yet — tenant has ${months}/${RENT_MONTHS_REQUIRED} rent months paid.`
    );
    err.statusCode = 400;
    err.code = 'PENDING_RENT';
    throw err;
  }
  if (row.status === 'cancelled') {
    const err = new Error(row.cancel_reason || 'This signing fee was cancelled (tenant left too early).');
    err.statusCode = 400;
    err.code = 'CANCELLED';
    throw err;
  }

  const manager = await resolveOrgManager(orgId);
  if (!manager) {
    const err = new Error('No property manager found for this organization.');
    err.statusCode = 404;
    throw err;
  }

  const payoutBankFull = await getDefaultPayoutBankFull(manager.id);
  const propertyBankRow = await getPropertyBankForAch(orgId);

  if (!payoutBankFull) {
    const err = new Error('Manager has no verified payout bank on file. Konstantin must link a bank under Boots on site first.');
    err.statusCode = 400;
    err.code = 'NO_PAYOUT_BANK';
    throw err;
  }

  if (!propertyBankRow) {
    const err = new Error('Link your property operating account first (Finance → Property account), then pay via ACH.');
    err.statusCode = 400;
    err.code = 'NO_PROPERTY_BANK';
    throw err;
  }

  const connectId = await ensureManagerConnectAccount(payoutBankFull, manager);
  await requireConnectTransfersReady(connectId);

  const accessToken = decrypt(propertyBankRow.plaid_access_token_encrypted);
  const { routing, account: acctNum } = await plaid.getAchAccountNumbers(
    accessToken,
    propertyBankRow.plaid_account_id
  );

  const { rows: [ownerRow] } = await pool.query(
    `SELECT first_name, last_name, email FROM users WHERE id = $1`,
    [ownerId]
  );
  const holderName = [ownerRow?.first_name, ownerRow?.last_name].filter(Boolean).join(' ')
    || ownerRow?.email
    || 'Property operating account';

  let paymentIntent;
  try {
    paymentIntent = await stripe.chargeACH({
      amountCents: row.amount_cents,
      customerId: propertyBankRow.stripe_customer_id,
      routingNumber: routing,
      accountNumber: acctNum,
      accountHolderName: holderName,
      description: `Lease signing fee — ${row.tenant_name || row.tenant_email}`,
      metadata: {
        payment_type: 'manager_lease_signing_fee',
        fee_id: feeId,
        org_id: orgId,
        manager_id: manager.id,
        payment_method: 'ach',
      },
      ipAddress,
      userAgent,
      transferDestination: connectId,
    });
  } catch (err) {
    throw wrapStripePayrollError(err);
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE manager_lease_signing_fees
        SET payment_method = 'ach',
            paid_by = $1,
            note = $2,
            stripe_payment_intent_id = $3,
            updated_at = NOW()
      WHERE id = $4 AND org_id = $5 AND status = 'owed'
      RETURNING *`,
    [ownerId, note?.trim() || null, paymentIntent.id, feeId, orgId]
  );

  if (!updated) {
    const err = new Error('Could not start ACH payment for this fee.');
    err.statusCode = 409;
    throw err;
  }

  return {
    fee: feeToJson({
      ...updated,
      tenant_name: row.tenant_name,
      tenant_email: row.tenant_email,
      unit_number: row.unit_number,
      property_name: row.property_name,
      lease_status: row.lease_status,
      start_date: row.start_date,
    }),
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
  };
}

async function startCashAppLeaseSigningFee({ orgId, ownerId, feeId, note }) {
  if (!stripe.isCashAppPayConfigured()) {
    const err = new Error('Cash App Pay is not configured. Enable it in Stripe Dashboard → Settings → Payment methods.');
    err.statusCode = 503;
    err.code = 'CASHAPP_NOT_CONFIGURED';
    throw err;
  }

  await refreshFeeEligibility(feeId);

  const row = await loadFeeById(feeId, orgId);
  if (!row) {
    const err = new Error('Lease signing fee not found.');
    err.statusCode = 404;
    throw err;
  }
  if (row.status === 'paid') {
    const err = new Error('This lease signing fee is already paid.');
    err.statusCode = 409;
    err.code = 'ALREADY_PAID';
    throw err;
  }
  if (row.stripe_payment_intent_id) {
    const pi = await stripe.retrievePaymentIntent(row.stripe_payment_intent_id);
    if (pi.status === 'succeeded') {
      const err = new Error('This lease signing fee is already paid.');
      err.statusCode = 409;
      err.code = 'ALREADY_PAID';
      throw err;
    }
    if (!['canceled', 'requires_action', 'requires_payment_method'].includes(pi.status)) {
      const err = new Error('A Cash App payment is already in progress for this fee.');
      err.statusCode = 409;
      err.code = 'ALREADY_PROCESSING';
      throw err;
    }
    await stripe.cancelPaymentIntent(row.stripe_payment_intent_id);
    await pool.query(
      `UPDATE manager_lease_signing_fees SET stripe_payment_intent_id = NULL, updated_at = NOW() WHERE id = $1`,
      [feeId]
    );
  }

  const manager = await resolveOrgManager(orgId);
  if (!manager) {
    const err = new Error('No property manager found for this organization.');
    err.statusCode = 404;
    throw err;
  }

  const payoutBankFull = await getDefaultPayoutBankFull(manager.id);
  if (!payoutBankFull) {
    const err = new Error('Manager has no verified payout bank on file. Konstantin must link a bank under Boots on site first.');
    err.statusCode = 400;
    err.code = 'NO_PAYOUT_BANK';
    throw err;
  }

  const connectId = await ensureManagerConnectAccount(payoutBankFull, manager);
  await requireConnectTransfersReady(connectId);

  const { rows: [ownerRow] } = await pool.query(
    `SELECT first_name, last_name, email FROM users WHERE id = $1`,
    [ownerId]
  );
  const customerId = await stripe.getOrCreateCustomer(ownerId, ownerRow.email);

  let paymentIntent;
  try {
    paymentIntent = await stripe.createCashAppPaymentIntent({
      amountCents: row.amount_cents,
      customerId,
      description: `Lease signing fee — ${row.tenant_name || row.tenant_email}`,
      metadata: {
        payment_type: 'manager_lease_signing_fee',
        fee_id: feeId,
        org_id: orgId,
        manager_id: manager.id,
        payment_method: 'cash_app',
      },
      transferDestination: connectId,
    });
  } catch (err) {
    throw wrapStripePayrollError(err);
  }

  await pool.query(
    `UPDATE manager_lease_signing_fees
        SET payment_method = 'cash_app',
            paid_by = $1,
            note = $2,
            stripe_payment_intent_id = $3,
            updated_at = NOW()
      WHERE id = $4 AND org_id = $5 AND status = 'owed'`,
    [ownerId, note?.trim() || null, paymentIntent.id, feeId, orgId]
  );

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    feeId,
    amountCents: row.amount_cents,
    publishableKey: stripe.getPublishableKey(),
  };
}

async function syncCashAppLeaseSigningFee({ orgId, ownerId, paymentIntentId }) {
  if (!paymentIntentId) {
    const err = new Error('payment_intent is required.');
    err.statusCode = 400;
    throw err;
  }

  const pi = await stripe.retrievePaymentIntent(paymentIntentId);
  if (pi.metadata?.payment_type !== 'manager_lease_signing_fee') {
    const err = new Error('Not a lease-signing fee payment.');
    err.statusCode = 400;
    throw err;
  }
  if (pi.metadata?.org_id && String(pi.metadata.org_id) !== String(orgId)) {
    const err = new Error('Payment does not belong to this organization.');
    err.statusCode = 403;
    throw err;
  }

  const feeId = pi.metadata?.fee_id;
  const row = await loadFeeById(feeId, orgId);
  if (!row) {
    const err = new Error('Lease signing fee not found.');
    err.statusCode = 404;
    throw err;
  }
  if (row.paid_by && row.paid_by !== ownerId) {
    const err = new Error('Access denied.');
    err.statusCode = 403;
    throw err;
  }

  if (pi.status === 'succeeded' && row.status !== 'paid') {
    const chargeId = typeof pi.latest_charge === 'string'
      ? pi.latest_charge
      : pi.latest_charge?.id ?? null;
    await pool.query(
      `UPDATE manager_lease_signing_fees
          SET status = 'paid',
              payment_method = 'cash_app',
              paid_at = COALESCE(paid_at, NOW()),
              stripe_charge_id = COALESCE($1, stripe_charge_id),
              updated_at = NOW()
        WHERE id = $2`,
      [chargeId, feeId]
    );
  }

  const data = await listLeaseSigningFees({ userId: ownerId, userRole: 'owner' });
  return {
    status: pi.status === 'succeeded' ? 'paid' : pi.status,
    paymentIntentStatus: pi.status,
    failureReason: pi.last_payment_error?.message || null,
    ...data,
  };
}

/** Owner: off-app settlement is not supported — use Cash App Pay or ACH in the portal. */
async function markFeePaidExternally({ orgId, ownerId, feeId, note }) {
  void orgId;
  void ownerId;
  void feeId;
  void note;
  const err = new Error('Pay through the portal with Cash App Pay or ACH. Off-app recording is not supported.');
  err.statusCode = 400;
  err.code = 'STRIPE_PAY_ONLY';
  throw err;
}

async function markTenantFeePaidExternally({ orgId, ownerId, tenantEmail, note }) {
  const { rows } = await pool.query(
    `SELECT f.id
       FROM manager_lease_signing_fees f
       JOIN leases l ON l.id = f.lease_id
       JOIN users u ON u.id = l.tenant_id
      WHERE f.org_id = $1
        AND f.status = 'owed'
        AND LOWER(u.email) = LOWER($2)`,
    [orgId, tenantEmail]
  );
  if (!rows[0]) {
    const err = new Error('No owed lease-signing fee found for that tenant.');
    err.statusCode = 404;
    throw err;
  }
  return markFeePaidExternally({
    orgId,
    ownerId,
    feeId: rows[0].id,
    note,
  });
}

module.exports = {
  LEASE_SIGNING_AMOUNT_CENTS,
  RENT_MONTHS_REQUIRED,
  ensureLeaseSigningFee,
  refreshEligibilityForLease,
  listLeaseSigningFees,
  syncLeaseSigningFees,
  payLeaseSigningFee,
  startCashAppLeaseSigningFee,
  syncCashAppLeaseSigningFee,
  markFeePaidExternally,
  markTenantFeePaidExternally,
};
