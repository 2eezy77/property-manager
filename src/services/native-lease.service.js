'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/client');
const { defaultTermsForRoomType } = require('./native-lease.constants');
const {
  generateRoomLeasePdf,
  flattenSignaturesOntoPdf,
} = require('./lease-pdf.service');
const { ensureLeaseSigningFee } = require('./lease-signing-pay.service');

const DOCS_DIR = path.resolve(__dirname, '../../documents');

const DEFAULT_HOUSE_RULES = {
  smoking: false,
  pets: false,
  quietHours: '10:00pm–8:00am',
  guestNights: 7,
};

const STAFF_ROLES = new Set(['super_admin', 'owner', 'property_manager']);

function httpError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function required(value, message) {
  if (value === undefined || value === null || value === '') {
    throw httpError(message, 400);
  }
}

function coalesceMoney(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function overrideValue(overrides, camelKey, snakeKey) {
  return overrides[camelKey] ?? overrides[snakeKey];
}

function normalizeHouseRules(houseRules) {
  return {
    ...DEFAULT_HOUSE_RULES,
    ...(houseRules || {}),
  };
}

function relativeDocumentPath(value) {
  if (!value) return null;
  if (String(value).startsWith('/documents/')) return value;
  return `/documents/${path.basename(String(value))}`;
}

function filesystemPathForDocument(value) {
  if (!value) return null;
  if (path.isAbsolute(value) && fs.existsSync(value)) return value;
  return path.join(DOCS_DIR, path.basename(String(value)));
}

function userDisplayName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
    || user?.email
    || 'Signer';
}

async function loadLeaseForPdf(client, leaseId) {
  const { rows } = await client.query(
    `SELECT l.*,
            un.unit_number,
            p.name AS property_name,
            p.address_line1,
            p.city,
            p.state,
            p.zip,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name,
            u.email AS tenant_email
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
      WHERE l.id = $1`,
    [leaseId]
  );
  return rows[0] || null;
}

async function createNativeLease({
  unitId,
  tenantId,
  roomType,
  startDate,
  endDate,
  overrides = {},
  houseRules,
  createdBy,
}) {
  required(unitId, 'unitId is required');
  required(tenantId, 'tenantId is required');
  required(roomType, 'roomType is required');
  required(startDate, 'startDate is required');
  required(endDate, 'endDate is required');
  required(createdBy, 'createdBy is required');

  const defaults = defaultTermsForRoomType(roomType);
  const rules = normalizeHouseRules(houseRules);
  const monthlyRent = overrideValue(overrides, 'monthlyRent', 'monthly_rent');
  const securityDeposit = overrideValue(overrides, 'securityDeposit', 'security_deposit');
  const gracePeriodDays = overrideValue(overrides, 'gracePeriodDays', 'grace_period_days');
  const lateFeeType = overrideValue(overrides, 'lateFeeType', 'late_fee_type');
  const lateFeeAmount = overrideValue(overrides, 'lateFeeAmount', 'late_fee_amount');
  const lateFeeCap = overrideValue(overrides, 'lateFeeCap', 'late_fee_cap');
  const documentUrl = overrideValue(overrides, 'documentUrl', 'document_url');
  const nsfFee = overrideValue(overrides, 'nsfFee', 'nsf_fee');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO leases
         (unit_id, tenant_id, status, start_date, end_date, monthly_rent,
          security_deposit, grace_period_days, late_fee_type, late_fee_amount,
          late_fee_cap, document_url, created_by, signing_provider, room_type,
          nsf_fee, house_rules)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'native',$13,$14,$15)
       RETURNING *`,
      [
        unitId,
        tenantId,
        startDate,
        endDate,
        coalesceMoney(monthlyRent, defaults.monthlyRent),
        coalesceMoney(securityDeposit, defaults.securityDeposit),
        gracePeriodDays ?? defaults.gracePeriodDays,
        lateFeeType ?? defaults.lateFeeType,
        coalesceMoney(lateFeeAmount, defaults.lateFeeAmount),
        lateFeeCap ?? null,
        documentUrl ?? null,
        createdBy,
        defaults.roomType,
        coalesceMoney(nsfFee, defaults.nsfFee),
        JSON.stringify(rules),
      ]
    );
    return rows[0];
  });
}

async function generateAndAttachPdf(leaseId) {
  const lease = await withTransaction(async (client) => {
    const row = await loadLeaseForPdf(client, leaseId);
    if (!row) throw httpError('Lease not found', 404);
    if (row.signing_provider !== 'native') {
      throw httpError('This lease does not use native signing.', 400);
    }
    if (row.status !== 'draft') {
      throw httpError('Native PDFs can only be generated for draft leases.', 400);
    }
    return row;
  });

  const pdf = await generateRoomLeasePdf({
    leaseId: lease.id,
    roomType: lease.room_type,
    unitNumber: lease.unit_number,
    tenantName: lease.tenant_name,
    startDate: lease.start_date,
    endDate: lease.end_date,
    monthlyRent: lease.monthly_rent,
    securityDeposit: lease.security_deposit,
    gracePeriodDays: lease.grace_period_days,
    lateFeeAmount: lease.late_fee_amount,
    nsfFee: lease.nsf_fee,
    houseRules: lease.house_rules,
  });

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE leases
          SET pdf_path = $1,
              document_url = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [pdf.relativePath, leaseId]
    );
  });

  return pdf.relativePath;
}

async function sendNativeForSignature(leaseId, sentBy = null) {
  let pdfPath;
  const existing = await pool.query(
    `SELECT pdf_path FROM leases WHERE id = $1 AND signing_provider = 'native'`,
    [leaseId]
  );
  if (!existing.rows[0]) throw httpError('Lease not found', 404);
  pdfPath = existing.rows[0].pdf_path;
  if (!pdfPath) {
    pdfPath = await generateAndAttachPdf(leaseId);
  }

  return withTransaction(async (client) => {
    const { rows: leaseRows } = await client.query(
      `SELECT l.*,
              TRIM(CONCAT(t.first_name, ' ', t.last_name)) AS tenant_name,
              t.email AS tenant_email,
              un.unit_number,
              p.name AS property_name
         FROM leases l
         JOIN users t ON t.id = l.tenant_id
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
        WHERE l.id = $1
        FOR UPDATE OF l`,
      [leaseId]
    );
    const lease = leaseRows[0];
    if (!lease) throw httpError('Lease not found', 404);
    if (lease.signing_provider !== 'native') {
      throw httpError('This lease does not use native signing.', 400);
    }
    if (lease.status !== 'draft') {
      throw httpError('Only draft native leases can be sent for signature.', 400);
    }

    const managerId = sentBy || lease.created_by;
    const { rows: managerRows } = await client.query(
      `SELECT id, email, first_name, last_name, role
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [managerId]
    );
    const manager = managerRows[0];
    if (!manager || !STAFF_ROLES.has(manager.role)) {
      throw httpError('A staff signer is required to send a native lease.', 400);
    }

    const subject = `Lease Agreement — ${lease.property_name} Unit ${lease.unit_number}`;
    const message = `Please review and sign your lease for ${lease.property_name}, Unit ${lease.unit_number}.`;

    const { rows: envelopeRows } = await client.query(
      `INSERT INTO signature_envelopes
         (lease_id, provider, provider_envelope_id, status, subject, message, sent_at)
       VALUES ($1, 'native', $2, 'sent', $3, $4, NOW())
       RETURNING *`,
      [lease.id, `native-${lease.id}`, subject, message]
    );
    const envelope = envelopeRows[0];

    const signerValues = [
      [
        envelope.id,
        lease.tenant_id,
        'Tenant',
        lease.tenant_email,
        lease.tenant_name || lease.tenant_email,
        1,
        'sent',
      ],
      [
        envelope.id,
        manager.id,
        'Property Manager',
        manager.email,
        userDisplayName(manager),
        2,
        'pending',
      ],
    ];

    const { rows: signers } = await client.query(
      `INSERT INTO envelope_signers
         (envelope_id, user_id, signer_role, email, name, routing_order, status)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7),
         ($8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      signerValues.flat()
    );

    const { rows: updatedRows } = await client.query(
      `UPDATE leases
          SET status = 'pending_tenant_signature',
              pdf_path = $1,
              document_url = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [pdfPath, lease.id]
    );

    return { lease: updatedRows[0], envelope, signers };
  });
}

async function latestNativeEnvelope(client, leaseId) {
  const { rows } = await client.query(
    `SELECT *
       FROM signature_envelopes
      WHERE lease_id = $1 AND provider = 'native'
      ORDER BY created_at DESC
      LIMIT 1`,
    [leaseId]
  );
  return rows[0] || null;
}

async function loadEnvelopeSigners(client, envelopeId) {
  const { rows } = await client.query(
    `SELECT *
       FROM envelope_signers
      WHERE envelope_id = $1
      ORDER BY routing_order`,
    [envelopeId]
  );
  return rows;
}

function signaturePayload(signers) {
  return signers
    .filter((signer) => signer.status === 'signed')
    .map((signer) => ({
      role: signer.signer_role,
      name: signer.signed_name || signer.name,
      signedAt: signer.signed_at,
      imageDataUrl: signer.signature_image || null,
    }));
}

async function applyTenantSignature(client, { lease, envelope, userId, signedName, signatureImage, ip, userAgent }) {
  if (lease.status !== 'pending_tenant_signature') {
    throw httpError('Tenant signature is not pending for this lease.', 400);
  }
  if (lease.tenant_id !== userId) {
    throw httpError('Only this lease tenant can sign as tenant.', 403);
  }

  const { rows: signerRows } = await client.query(
    `UPDATE envelope_signers
        SET status = 'signed',
            signed_at = NOW(),
            signed_name = $1,
            signature_image = $2,
            signer_ip = $3,
            user_agent = $4,
            updated_at = NOW()
      WHERE envelope_id = $5
        AND user_id = $6
        AND routing_order = 1
      RETURNING *`,
    [signedName, signatureImage ?? null, ip ?? null, userAgent ?? null, envelope.id, userId]
  );
  if (!signerRows[0]) throw httpError('Tenant signer not found.', 404);

  await client.query(
    `UPDATE envelope_signers
        SET status = 'sent', updated_at = NOW()
      WHERE envelope_id = $1 AND routing_order = 2 AND status = 'pending'`,
    [envelope.id]
  );

  const { rows: updatedRows } = await client.query(
    `UPDATE leases
        SET status = 'pending_manager_signature',
            tenant_signed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [lease.id]
  );

  const signers = await loadEnvelopeSigners(client, envelope.id);
  return { lease: updatedRows[0], envelope, signers, depositPayment: null, feeId: null };
}

async function applyManagerSignature(client, { lease, envelope, userId, role, signedName, signatureImage, ip, userAgent }) {
  if (lease.status !== 'pending_manager_signature') {
    throw httpError('Manager signature is not pending for this lease.', 400);
  }
  if (!STAFF_ROLES.has(role)) {
    throw httpError('Only staff can sign as property manager.', 403);
  }

  const { rows: signerRows } = await client.query(
    `UPDATE envelope_signers
        SET status = 'signed',
            user_id = COALESCE(user_id, $1),
            signed_at = NOW(),
            signed_name = $2,
            signature_image = $3,
            signer_ip = $4,
            user_agent = $5,
            updated_at = NOW()
      WHERE envelope_id = $6
        AND routing_order = 2
      RETURNING *`,
    [userId, signedName, signatureImage ?? null, ip ?? null, userAgent ?? null, envelope.id]
  );
  if (!signerRows[0]) throw httpError('Manager signer not found.', 404);

  const signers = await loadEnvelopeSigners(client, envelope.id);
  const sourcePath = filesystemPathForDocument(lease.pdf_path);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw httpError('Native lease PDF has not been generated.', 400);
  }
  const signedPdf = await flattenSignaturesOntoPdf({
    sourcePath,
    outputFilename: `lease-${lease.id}-signed.pdf`,
    signatures: signaturePayload(signers),
  });

  const { rows: paymentRows } = await client.query(
    `INSERT INTO payments
       (lease_id, tenant_id, amount, payment_type, status, period_start, period_end, due_date, metadata)
     VALUES ($1, $2, $3, 'security_deposit', 'pending', $4, $4, $4,
             '{"source":"native_lease_activation"}'::jsonb)
     RETURNING *`,
    [lease.id, lease.tenant_id, lease.security_deposit, lease.start_date]
  );

  const { rows: updatedRows } = await client.query(
    `UPDATE leases
        SET status = 'awaiting_deposit',
            manager_signed_at = NOW(),
            signed_pdf_path = $1,
            document_url = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [signedPdf.relativePath, lease.id]
  );

  const { rows: envelopeRows } = await client.query(
    `UPDATE signature_envelopes
        SET status = 'completed',
            signed_document_url = $1,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [signedPdf.relativePath, envelope.id]
  );

  return {
    lease: updatedRows[0],
    envelope: envelopeRows[0],
    signers,
    depositPayment: paymentRows[0],
    feeId: null,
  };
}

async function applyNativeSignature({ leaseId, userId, role, signedName, signatureImage, ip, userAgent }) {
  required(leaseId, 'leaseId is required');
  required(userId, 'userId is required');
  if (!signedName || !String(signedName).trim()) {
    throw httpError('signedName is required', 400);
  }

  const result = await withTransaction(async (client) => {
    const { rows: leaseRows } = await client.query(
      `SELECT *
         FROM leases
        WHERE id = $1
        FOR UPDATE`,
      [leaseId]
    );
    const lease = leaseRows[0];
    if (!lease) throw httpError('Lease not found', 404);
    if (lease.signing_provider !== 'native') {
      throw httpError('This lease does not use native signing.', 400);
    }

    const envelope = await latestNativeEnvelope(client, lease.id);
    if (!envelope) throw httpError('Native signature envelope not found.', 404);

    if (lease.status === 'pending_tenant_signature') {
      return applyTenantSignature(client, {
        lease,
        envelope,
        userId,
        signedName: String(signedName).trim(),
        signatureImage,
        ip,
        userAgent,
      });
    }

    if (lease.status === 'pending_manager_signature') {
      return applyManagerSignature(client, {
        lease,
        envelope,
        userId,
        role,
        signedName: String(signedName).trim(),
        signatureImage,
        ip,
        userAgent,
      });
    }

    throw httpError('No native signature is pending for this lease.', 400);
  });

  if (result.lease.status === 'awaiting_deposit') {
    result.feeId = await ensureLeaseSigningFee(leaseId, { signedAt: result.lease.manager_signed_at });
  }

  return result;
}

async function getNativeDocumentForUser(leaseId, user) {
  required(leaseId, 'leaseId is required');
  const { rows } = await pool.query(
    `SELECT id, tenant_id, signing_provider, pdf_path, signed_pdf_path, document_url
       FROM leases
      WHERE id = $1`,
    [leaseId]
  );
  const lease = rows[0];
  if (!lease) throw httpError('Lease not found', 404);
  if (lease.signing_provider !== 'native') {
    throw httpError('This lease does not use native signing.', 400);
  }
  if (user.role === 'tenant' && lease.tenant_id !== user.id) {
    throw httpError('Access denied', 403);
  }

  const url = relativeDocumentPath(lease.signed_pdf_path || lease.pdf_path || lease.document_url);
  if (!url) throw httpError('Native lease PDF has not been generated.', 404);
  return { url, leaseId: lease.id };
}

module.exports = {
  createNativeLease,
  generateAndAttachPdf,
  sendNativeForSignature,
  applyNativeSignature,
  getNativeDocumentForUser,
};
