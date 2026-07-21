/**
 * Admin password set + credential emails + owner alerts on tenant password change.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/client');
const { sendEmail, sendOperationalStaffEmail } = require('./email.service');
const { getStoredRefreshToken } = require('./gmail.service');
const { render: renderCredentials } = require('./email-templates/tenantPortalCredentials');
const { render: renderPasswordChangedStaff } = require('./email-templates/tenantPasswordChangedStaff');

const BCRYPT_ROUNDS = 12;

function generatePassword(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.randomBytes(len))
    .map((b) => chars[b % chars.length])
    .join('');
}

function validatePassword(plain) {
  const s = String(plain || '');
  if (s.length < 8) {
    const err = new Error('Password must be at least 8 characters.');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  return s;
}

async function resolveOrgIdForUser(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1),
       (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1)
     ) AS org_id`,
    [userId]
  );
  return rows[0]?.org_id ?? null;
}

async function loadUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, email, first_name, last_name, role, org_id, is_active, password_changed_at
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

async function loadTenantContext(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name,
            un.unit_number, p.name AS property_name
       FROM users u
       LEFT JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       LEFT JOIN units un ON un.id = l.unit_id
       LEFT JOIN properties p ON p.id = un.property_id
      WHERE u.id = $1
      ORDER BY l.start_date DESC NULLS LAST
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Set password hash; clear password_changed_at so onboarding still flags "set password".
 */
async function setPasswordHash(userId, plainPassword) {
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  await pool.query(
    `UPDATE users
        SET password_hash = $1,
            password_changed_at = NULL,
            updated_at = NOW()
      WHERE id = $2`,
    [hash, userId]
  );
  return hash;
}

async function sendCredentialEmail({ orgId, user, plainPassword, unitNumber, propertyName }) {
  const name = user.first_name || 'there';
  const unitLabel = unitNumber ? `Unit ${unitNumber}` : '';
  const { html, text, subject } = renderCredentials({
    tenantName: name,
    email: user.email,
    temporaryPassword: plainPassword,
    unitLabel,
    propertyName: propertyName || '743 A Ave',
    role: user.role,
  });

  let bcc;
  try {
    const stored = await getStoredRefreshToken(orgId);
    bcc = stored?.gmailAddress;
  } catch {
    bcc = undefined;
  }

  return sendEmail({
    orgId,
    to: user.email,
    bcc: bcc || undefined,
    subject,
    text,
    html,
  });
}

/**
 * Owner/manager sets a user's password; optionally email credentials (never for primary owner).
 */
async function adminSetPassword({
  actorUserId,
  targetUserId,
  password,
  generate = false,
  sendEmail: shouldSend = true,
  primaryOwnerId = null,
}) {
  const target = await loadUser(targetUserId);
  if (!target || !target.is_active) {
    const err = new Error('User not found or inactive.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (primaryOwnerId && target.id === primaryOwnerId) {
    const err = new Error('Cannot set or email a password for the primary owner account from here.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (target.role === 'owner' && actorUserId !== target.id) {
    const err = new Error('Use account settings to change owner passwords.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const plain = generate ? generatePassword() : validatePassword(password);
  await setPasswordHash(target.id, plain);

  let emailResult = { sent: false, skipped: 'not_requested' };
  if (shouldSend) {
    const orgId = target.org_id || (await resolveOrgIdForUser(actorUserId));
    if (!orgId) {
      const err = new Error('Organization Gmail is not configured.');
      err.code = 'NO_ORG';
      throw err;
    }
    const ctx = target.role === 'tenant' ? await loadTenantContext(target.id) : null;
    emailResult = await sendCredentialEmail({
      orgId,
      user: target,
      plainPassword: plain,
      unitNumber: ctx?.unit_number,
      propertyName: ctx?.property_name,
    });
  }

  return {
    userId: target.id,
    email: target.email,
    role: target.role,
    password: plain,
    emailed: !!emailResult.sent,
    emailSkipped: emailResult.skipped,
  };
}

async function notifyOwnersTenantPasswordChanged(tenantId) {
  const tenant = await loadUser(tenantId);
  if (!tenant || tenant.role !== 'tenant') return { sent: false, skipped: 'not_tenant' };

  const orgId = tenant.org_id || (await resolveOrgIdForUser(tenantId));
  if (!orgId) return { sent: false, skipped: 'no_org' };

  const ctx = await loadTenantContext(tenantId);
  const name = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || tenant.email;
  const { html, text, subject } = renderPasswordChangedStaff({
    tenantName: name,
    tenantEmail: tenant.email,
    unitLabel: ctx?.unit_number ? `Unit ${ctx.unit_number}` : '',
    propertyName: ctx?.property_name,
    changedAt: new Date(),
  });

  return sendOperationalStaffEmail(pool, {
    orgId,
    subject,
    text,
    html,
  });
}

/**
 * Generate unique passwords + email all active org tenants (excludes owner).
 */
async function adminEmailAllTenantPasswords({ actorUserId, primaryOwnerId }) {
  const orgId = await resolveOrgIdForUser(actorUserId);
  if (!orgId) return { results: [], error: 'NO_ORG' };

  const { rows: tenants } = await pool.query(
    `SELECT DISTINCT ON (u.id) u.id
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id AND p.org_id = $1
      WHERE u.role = 'tenant' AND u.is_active = TRUE
      ORDER BY u.id`,
    [orgId]
  );

  const results = [];
  for (const { id } of tenants) {
    if (primaryOwnerId && id === primaryOwnerId) continue;
    try {
      const r = await adminSetPassword({
        actorUserId,
        targetUserId: id,
        generate: true,
        sendEmail: true,
        primaryOwnerId,
      });
      results.push({ ...r, status: 'ok' });
      await new Promise((res) => setTimeout(res, 1500));
    } catch (err) {
      results.push({ userId: id, status: 'error', message: err.message });
    }
  }
  return { results };
}

module.exports = {
  generatePassword,
  validatePassword,
  setPasswordHash,
  resolveOrgIdForUser,
  adminSetPassword,
  adminEmailAllTenantPasswords,
  notifyOwnersTenantPasswordChanged,
  sendCredentialEmail,
};
