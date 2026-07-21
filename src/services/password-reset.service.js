/**
 * Self-service forgot / reset password via email link.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/client');
const { sendEmail } = require('./email.service');
const { getStoredRefreshToken } = require('./gmail.service');
const { render: renderResetEmail } = require('./email-templates/passwordReset');
const { validatePassword, resolveOrgIdForUser } = require('./password-admin.service');
const { PORTAL_ORIGIN } = require('./email-templates/brand');

const RESET_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function hashResetToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function resetUrlForToken(raw) {
  const origin = (PORTAL_ORIGIN || 'https://www.monterorentals.com').replace(/\/$/, '');
  return `${origin}/reset-password?token=${encodeURIComponent(raw)}`;
}

async function resolveOrgIdForPasswordReset(user) {
  if (user.org_id) return user.org_id;

  const ownerOrg = await resolveOrgIdForUser(user.id);
  if (ownerOrg) return ownerOrg;

  if (user.role === 'tenant') {
    const { rows } = await pool.query(
      `SELECT p.org_id
         FROM leases l
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
        WHERE l.tenant_id = $1 AND l.status = 'active'
        ORDER BY l.start_date DESC NULLS LAST
        LIMIT 1`,
      [user.id]
    );
    if (rows[0]?.org_id) return rows[0].org_id;
  }

  const { rows: gmailRows } = await pool.query(
    `SELECT org_id FROM gmail_oauth_tokens ORDER BY updated_at DESC NULLS LAST LIMIT 1`
  );
  return gmailRows[0]?.org_id ?? null;
}

async function requestPasswordReset({ email, ip }) {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized) return { sent: false, reason: 'invalid_email' };

  const { rows } = await pool.query(
    `SELECT id, email, first_name, last_name, role, org_id, is_active
       FROM users WHERE email = $1 LIMIT 1`,
    [normalized]
  );
  const user = rows[0];
  if (!user?.is_active) return { sent: false, reason: 'no_user' };

  const orgId = await resolveOrgIdForPasswordReset(user);
  if (!orgId) {
    console.error('[password-reset] no org for user', user.email);
    return { sent: false, reason: 'no_org', email: user.email };
  }

  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  const name = user.first_name || 'there';
  const { subject, text, html } = renderResetEmail({
    recipientName: name,
    resetUrl: resetUrlForToken(raw),
    loginEmail: user.email,
  });

  let bcc;
  try {
    const stored = await getStoredRefreshToken(orgId);
    bcc = stored?.gmailAddress;
  } catch {
    bcc = undefined;
  }

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
        bcc: bcc || undefined,
        subject,
        text,
        html,
      });
    } catch (err) {
      console.error('[password-reset] send failed:', err.message, { email: user.email, code: err.code });
      await client.query('ROLLBACK');
      return { sent: false, reason: err.code || 'send_failed', email: user.email };
    }

    if (!result.sent) {
      console.error('[password-reset] send skipped:', result.skipped, { email: user.email });
      await client.query('ROLLBACK');
      return { sent: false, reason: result.skipped || 'not_sent', email: user.email };
    }

    await client.query('COMMIT');
    console.log('[password-reset] email sent to', user.email);
    return { sent: true, email: user.email };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function completePasswordReset({ token, newPassword, ip }) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 32) {
    const err = new Error('Invalid or expired reset link.');
    err.code = 'INVALID_TOKEN';
    err.statusCode = 400;
    throw err;
  }

  const plain = validatePassword(newPassword);
  const tokenHash = hashResetToken(raw);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at,
              u.email, u.role, u.is_active
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = $1
        LIMIT 1`,
      [tokenHash]
    );

    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date() || !row.is_active) {
      const err = new Error('Invalid or expired reset link. Request a new one from the login page.');
      err.code = 'INVALID_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    const hash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
    await client.query(
      `UPDATE users
          SET password_hash = $1,
              password_changed_at = CASE WHEN role = 'tenant' THEN NOW() ELSE password_changed_at END,
              updated_at = NOW()
        WHERE id = $2`,
      [hash, row.user_id]
    );

    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    await client.query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id]
    );

    await client.query('COMMIT');
    return { email: row.email, role: row.role };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  requestPasswordReset,
  completePasswordReset,
};
