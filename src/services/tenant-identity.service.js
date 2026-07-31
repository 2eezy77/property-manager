const pool = require('../db/client');
const stripe = require('./stripe.service');
const {
  computeCardCashAppFee,
  feeMetadata,
} = require('./payment-processing-fee.service');
const { encryptSsn, ssnLast4 } = require('./identity-pii-crypto.service');

const IDENTITY_FEE_BASE_CENTS = 150;
const IDENTITY_FEE_GRACE_HOURS = 72;
const IDENTITY_FEE_GRACE_MS = IDENTITY_FEE_GRACE_HOURS * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function publicOrigin() {
  return (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
}

function identityReturnUrl(leaseId) {
  const url = new URL('/tenant/lease', publicOrigin());
  url.searchParams.set('identity', 'return');
  url.searchParams.set('lease_id', leaseId);
  return url.toString();
}

function isWithinGrace(value, now = new Date()) {
  if (!value) return false;
  const paidAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(paidAt.getTime())) return false;
  return now.getTime() - paidAt.getTime() <= IDENTITY_FEE_GRACE_MS;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadLeaseForTenant(client, leaseId, tenantId) {
  const { rows } = await client.query(
    `SELECT l.id, l.tenant_id, l.status,
            u.email AS tenant_email,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name
       FROM leases l
       JOIN users u ON u.id = l.tenant_id
      WHERE l.id = $1`,
    [leaseId]
  );
  const lease = rows[0];
  if (!lease) throw httpError('Lease not found.', 404, 'LEASE_NOT_FOUND');
  if (String(lease.tenant_id) !== String(tenantId)) {
    throw httpError('Access denied.', 403, 'ACCESS_DENIED');
  }
  return lease;
}

async function ensureIdentityRow(leaseId, tenantId, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO tenant_identity_verifications (lease_id, tenant_id)
     VALUES ($1, $2)
     ON CONFLICT (lease_id) DO UPDATE
       SET tenant_id = EXCLUDED.tenant_id,
           updated_at = NOW()
     RETURNING *`,
    [leaseId, tenantId]
  );
  return rows[0];
}

async function lockIdentityRow(client, leaseId) {
  const { rows } = await client.query(
    `SELECT *
       FROM tenant_identity_verifications
      WHERE lease_id = $1
      FOR UPDATE`,
    [leaseId]
  );
  return rows[0] || null;
}

async function latestSucceededFee(client, leaseId, tenantId) {
  const { rows } = await client.query(
    `SELECT id, stripe_payment_intent_id, paid_at, updated_at
       FROM payments
      WHERE lease_id = $1
        AND tenant_id = $2
        AND payment_type = 'identity_verification_fee'
        AND status = 'succeeded'
      ORDER BY paid_at DESC NULLS LAST, updated_at DESC
      LIMIT 1`,
    [leaseId, tenantId]
  );
  return rows[0] || null;
}

async function syncPaidFeeOntoIdentity(client, identityRow, paymentRow) {
  if (!paymentRow) return identityRow;
  const feePaidAt = paymentRow.paid_at || paymentRow.updated_at || new Date();
  const { rows } = await client.query(
    `UPDATE tenant_identity_verifications
        SET fee_payment_id = $1,
            stripe_fee_payment_intent_id = $2,
            fee_paid_at = $3,
            updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
    [paymentRow.id, paymentRow.stripe_payment_intent_id || null, feePaidAt, identityRow.id]
  );
  return rows[0];
}

async function findReusableFeePayment(client, leaseId, tenantId) {
  const { rows } = await client.query(
    `SELECT id, stripe_payment_intent_id
       FROM payments
      WHERE lease_id = $1
        AND tenant_id = $2
        AND payment_type = 'identity_verification_fee'
        AND status IN ('pending', 'processing')
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [leaseId, tenantId]
  );
  return rows[0] || null;
}

async function createPaymentIntentForFee({ lease, tenantId, paymentId, fee }) {
  const customerId = await stripe.getOrCreateCustomer(tenantId, lease.tenant_email);
  const meta = feeMetadata(fee);
  return stripe.createCardPaymentIntent({
    amountCents: fee.totalCents,
    customerId,
    description: 'Stripe Identity verification fee',
    metadata: {
      payment_id: paymentId,
      lease_id: lease.id,
      tenant_id: tenantId,
      payment_type: 'identity_verification_fee',
      payment_method: 'card',
      source: 'stripe_identity',
      ...meta,
    },
  });
}

async function createIdentityFeeIntent({ leaseId, tenantId }) {
  const fee = computeCardCashAppFee(IDENTITY_FEE_BASE_CENTS);

  return withTransaction(async (client) => {
    const lease = await loadLeaseForTenant(client, leaseId, tenantId);
    await ensureIdentityRow(leaseId, tenantId, client);
    let identityRow = await lockIdentityRow(client, leaseId);
    const paidFee = await latestSucceededFee(client, leaseId, tenantId);
    identityRow = await syncPaidFeeOntoIdentity(client, identityRow, paidFee);
    if (isWithinGrace(identityRow.fee_paid_at)) {
      throw httpError(
        'Identity fee is already paid. Continue to verification.',
        409,
        'IDENTITY_FEE_ALREADY_PAID'
      );
    }

    const feeMeta = feeMetadata(fee);
    let payment = await findReusableFeePayment(client, leaseId, tenantId);
    if (!payment) {
      const { rows } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, amount, currency, status, payment_type, due_date, metadata)
         VALUES ($1, $2, $3, 'USD', 'pending', 'identity_verification_fee', CURRENT_DATE, $4::jsonb)
         RETURNING id, stripe_payment_intent_id`,
        [
          leaseId,
          tenantId,
          fee.baseAmount,
          JSON.stringify({
            payment_method: 'card',
            source: 'stripe_identity',
            identity_fee_base_cents: String(IDENTITY_FEE_BASE_CENTS),
            ...feeMeta,
          }),
        ]
      );
      payment = rows[0];
    }

    let paymentIntent = null;
    if (payment.stripe_payment_intent_id) {
      try {
        paymentIntent = await stripe.retrievePaymentIntent(payment.stripe_payment_intent_id);
      } catch (_err) {
        paymentIntent = null;
      }
    }
    if (!paymentIntent || paymentIntent.status === 'canceled') {
      paymentIntent = await createPaymentIntentForFee({
        lease,
        tenantId,
        paymentId: payment.id,
        fee,
      });
      await client.query(
        `UPDATE payments
            SET stripe_payment_intent_id = $1,
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $3`,
        [
          paymentIntent.id,
          JSON.stringify({
            payment_method: 'card',
            source: 'stripe_identity',
            ...feeMeta,
          }),
          payment.id,
        ]
      );
    }

    await client.query(
      `UPDATE tenant_identity_verifications
          SET fee_payment_id = $1,
              stripe_fee_payment_intent_id = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [payment.id, paymentIntent.id, identityRow.id]
    );

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: fee.totalAmount,
      baseAmount: fee.baseAmount,
      processingFee: fee.processingFee,
      paymentId: payment.id,
      publishableKey: stripe.getPublishableKey(),
    };
  });
}

async function requirePaidIdentityFee(client, leaseId, tenantId) {
  let identityRow = await lockIdentityRow(client, leaseId);
  if (!identityRow) identityRow = await ensureIdentityRow(leaseId, tenantId, client);
  const paidFee = await latestSucceededFee(client, leaseId, tenantId);
  identityRow = await syncPaidFeeOntoIdentity(client, identityRow, paidFee);
  if (!isWithinGrace(identityRow.fee_paid_at)) {
    throw httpError(
      'Pay the identity verification fee before starting verification.',
      402,
      'IDENTITY_FEE_REQUIRED'
    );
  }
  return identityRow;
}

async function createIdentitySession({ leaseId, tenantId }) {
  const { lease, identityRow } = await withTransaction(async (client) => {
    const lease = await loadLeaseForTenant(client, leaseId, tenantId);
    await ensureIdentityRow(leaseId, tenantId, client);
    const identityRow = await requirePaidIdentityFee(client, leaseId, tenantId);
    return { lease, identityRow };
  });

  const session = await stripe.createIdentityVerificationSession({
    returnUrl: identityReturnUrl(leaseId),
    metadata: {
      lease_id: leaseId,
      tenant_id: tenantId,
      email: lease.tenant_email,
      fee_payment_id: identityRow.fee_payment_id || '',
    },
  });

  await pool.query(
    `UPDATE tenant_identity_verifications
        SET stripe_verification_session_id = $1,
            status = 'requires_input',
            updated_at = NOW()
      WHERE id = $2`,
    [session.id, identityRow.id]
  );

  return { url: session.url, sessionId: session.id };
}

async function isIdentityVerified(leaseId) {
  const { rows } = await pool.query(
    `SELECT status
       FROM tenant_identity_verifications
      WHERE lease_id = $1`,
    [leaseId]
  );
  return rows[0]?.status === 'verified';
}

function statusFromSession(session) {
  if (session.status === 'verified') return 'verified';
  if (session.status === 'processing') return 'processing';
  if (session.status === 'canceled') return 'canceled';
  if (session.last_error) return 'failed';
  return 'requires_input';
}

function dateOfBirthFromOutputs(outputs) {
  const dob = outputs?.dob || outputs?.date_of_birth;
  if (!dob?.year || !dob?.month || !dob?.day) return null;
  return `${dob.year}-${String(dob.month).padStart(2, '0')}-${String(dob.day).padStart(2, '0')}`;
}

function addressFromOutputs(outputs) {
  return outputs?.address || {};
}

function legalNameFromOutputs(outputs) {
  return [outputs?.first_name, outputs?.last_name].filter(Boolean).join(' ').trim() || null;
}

async function rowForSession(session) {
  const { rows } = await pool.query(
    `SELECT *
       FROM tenant_identity_verifications
      WHERE stripe_verification_session_id = $1`,
    [session.id]
  );
  if (rows[0]) return rows[0];

  const leaseId = session.metadata?.lease_id;
  const tenantId = session.metadata?.tenant_id;
  if (!UUID_RE.test(leaseId || '') || !UUID_RE.test(tenantId || '')) return null;
  const row = await ensureIdentityRow(leaseId, tenantId);
  await pool.query(
    `UPDATE tenant_identity_verifications
        SET stripe_verification_session_id = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [session.id, row.id]
  );
  return { ...row, stripe_verification_session_id: session.id };
}

async function applyIdentitySessionUpdate(session) {
  const row = await rowForSession(session);
  if (!row) return null;

  const outputs = session.verified_outputs || {};
  const address = addressFromOutputs(outputs);
  const idNumber = outputs.id_number || outputs.ssn || null;
  const ssnDigits = idNumber ? String(idNumber).replace(/\D/g, '') : '';
  const encrypted = ssnDigits.length === 9 ? encryptSsn(ssnDigits) : null;
  const status = statusFromSession(session);

  const { rows } = await pool.query(
    `UPDATE tenant_identity_verifications
        SET status = $2::varchar,
            verified_at = CASE WHEN $2::varchar = 'verified' THEN COALESCE(verified_at, NOW()) ELSE verified_at END,
            last_error_code = $3,
            last_error_reason = $4,
            legal_name = COALESCE($5, legal_name),
            date_of_birth = COALESCE($6::date, date_of_birth),
            address_line1 = COALESCE($7, address_line1),
            address_line2 = COALESCE($8, address_line2),
            address_city = COALESCE($9, address_city),
            address_state = COALESCE($10, address_state),
            address_postal = COALESCE($11, address_postal),
            ssn_ciphertext = COALESCE($12, ssn_ciphertext),
            ssn_last4 = COALESCE($13, ssn_last4),
            encryption_key_id = COALESCE($14, encryption_key_id),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      row.id,
      status,
      session.last_error?.code || null,
      session.last_error?.reason || session.last_error?.message || null,
      legalNameFromOutputs(outputs),
      dateOfBirthFromOutputs(outputs),
      address.line1 || null,
      address.line2 || null,
      address.city || null,
      address.state || null,
      address.postal_code || address.postal || null,
      encrypted?.ciphertext || null,
      encrypted ? ssnLast4(ssnDigits) : null,
      encrypted?.keyId || null,
    ]
  );
  return rows[0] || null;
}

module.exports = {
  IDENTITY_FEE_BASE_CENTS,
  IDENTITY_FEE_GRACE_HOURS,
  ensureIdentityRow,
  createIdentityFeeIntent,
  createIdentitySession,
  isIdentityVerified,
  applyIdentitySessionUpdate,
};
