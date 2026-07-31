'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/client');
const { sendEmail } = require('./email.service');
const { PORTAL_ORIGIN } = require('./email-templates/brand');
const { render: renderLeaseInviteEmail } = require('./email-templates/tenantLeaseInvite');

const RESET_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function httpError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function requiredString(value, message, code) {
  const str = String(value || '').trim();
  if (!str) throw httpError(message, 400, code);
  return str;
}

function hashResetToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function resetUrlForToken(raw) {
  const origin = (PORTAL_ORIGIN || 'https://www.monterorentals.com').replace(/\/$/, '');
  return `${origin}/reset-password?token=${encodeURIComponent(raw)}&next=/tenant/lease`;
}

async function inviteTenantForLease({
  orgId,
  email,
  firstName,
  lastName,
  phone,
  db = pool,
}) {
  if (!orgId) throw httpError('orgId is required', 400, 'ORG_REQUIRED');

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw httpError('email is required', 400, 'EMAIL_REQUIRED');
  const cleanFirstName = requiredString(firstName, 'first_name is required', 'FIRST_NAME_REQUIRED');
  const cleanPhone = requiredString(phone, 'phone is required', 'PHONE_REQUIRED');
  const cleanLastName = String(lastName || '').trim() || null;

  const { rows: existingRows } = await db.query(
    `SELECT id, email, role
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [normalizedEmail]
  );
  const existing = existingRows[0];
  if (existing?.role === 'tenant') {
    throw httpError(
      'This email already belongs to a tenant. Use Existing tenant instead.',
      409,
      'USE_EXISTING_TENANT'
    );
  }
  if (existing) {
    throw httpError(
      'This email is already in use by a non-tenant account.',
      409,
      'EMAIL_IN_USE'
    );
  }

  const randomPassword = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(randomPassword, BCRYPT_ROUNDS);
  const { rows } = await db.query(
    `INSERT INTO users
       (email, password_hash, role, first_name, last_name, phone, org_id, email_verified_at)
     VALUES ($1, $2, 'tenant', $3, $4, $5, $6, NULL)
     RETURNING id, email, first_name, last_name, phone, role, org_id, is_active, created_at`,
    [
      normalizedEmail,
      passwordHash,
      cleanFirstName,
      cleanLastName,
      cleanPhone,
      orgId,
    ]
  );

  return {
    tenant: rows[0],
  };
}

async function sendLeaseInviteEmail({ user, orgId, leaseId, ip }) {
  if (!user?.id) throw httpError('user is required', 400, 'USER_REQUIRED');
  if (!orgId) throw httpError('orgId is required', 400, 'ORG_REQUIRED');

  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  const setPasswordUrl = resetUrlForToken(raw);

  const { subject, text, html } = renderLeaseInviteEmail({
    recipientName: user.first_name || 'there',
    setPasswordUrl,
    loginEmail: user.email,
    leaseId,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [user.id]
    );
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expiresAt, ip ?? null]
    );

    let result;
    try {
      result = await sendEmail({
        orgId,
        to: user.email,
        subject,
        text,
        html,
      });
    } catch (err) {
      console.error('[tenant-invite] send failed:', err.message, {
        email: user.email,
        code: err.code,
        leaseId,
      });
      await client.query('ROLLBACK');
      return { sent: false, reason: err.code || 'send_failed' };
    }

    if (!result.sent) {
      console.error('[tenant-invite] send skipped:', result.skipped, {
        email: user.email,
        leaseId,
      });
      await client.query('ROLLBACK');
      return { sent: false, reason: result.skipped || 'not_sent' };
    }

    await client.query('COMMIT');
    return { sent: true, ...result };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  inviteTenantForLease,
  sendLeaseInviteEmail,
};
