/**
 * users.routes.js — self-service profile and password (all authenticated roles).
 *
 * PATCH /api/users/me           — update first_name, last_name, phone
 * POST  /api/users/me/password  — change password (session stays active)
 */

const express      = require('express');
const bcrypt       = require('bcrypt');
const pool         = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { authorizeMin, Guards } = require('../middleware/authorize');
const { signImpersonationToken } = require('../utils/jwt.utils');
const { buildCheckinStatus } = require('../services/tenant-checkin.service');
const {
  buildTenantOffboardingStatus,
  TENANT_STEP_KEYS,
  resolveStepMeta,
  isOffboardingActive,
} = require('../services/tenant-offboarding.service');

const router = express.Router();
router.use(authenticate);

const ME_SELECT = `SELECT id, email, role, first_name, last_name, phone, avatar_url, created_at
                     FROM users WHERE id = $1`;

function impersonationBlocked(req, res) {
  if (req.user.impersonatedBy) {
    res.status(403).json({
      error:   'IMPERSONATION_READONLY',
      message: 'Exit preview before changing account settings.',
    });
    return true;
  }
  return false;
}

async function resolveOrgId(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1 AND org_id IS NOT NULL),
       (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1),
       (SELECT p.org_id FROM leases l
          JOIN units un ON un.id = l.unit_id
          JOIN properties p ON p.id = un.property_id
         WHERE l.tenant_id = $1
         ORDER BY CASE
                    WHEN l.status = 'active' THEN 0
                    WHEN l.status = 'pending_signature' THEN 1
                    ELSE 2
                  END,
                  l.created_at DESC NULLS LAST
         LIMIT 1)
     ) AS org_id`,
    [userId]
  );
  return rows[0]?.org_id ?? null;
}

async function getPrimaryOwnerId(orgId) {
  if (!orgId) return null;
  const { rows } = await pool.query(
    `SELECT owner_id FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );
  return rows[0]?.owner_id ?? null;
}

async function accessiblePropertyIds(userId, userRole) {
  if (['super_admin', 'owner'].includes(userRole)) {
    const { rows } = await pool.query(
      `SELECT p.id FROM properties p JOIN users u ON u.org_id = p.org_id WHERE u.id = $1`,
      [userId]
    );
    return rows.map(r => r.id);
  }
  const { rows } = await pool.query(
    `SELECT property_id AS id FROM property_assignments WHERE user_id = $1`,
    [userId]
  );
  return rows.map(r => r.id);
}

async function tenantInProperties(tenantId, propIds) {
  const { rows } = await pool.query(
    `SELECT 1 FROM leases l
     JOIN units un ON un.id = l.unit_id
     WHERE l.tenant_id = $1 AND un.property_id = ANY($2)
     LIMIT 1`,
    [tenantId, propIds]
  );
  return rows.length > 0;
}

// GET /api/users/me/checkin — tenant onboarding checklist state
router.get('/me/checkin', Guards.tenantOnly, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query(
      `SELECT password_changed_at, lease_viewed_at, maintenance_viewed_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    }
    const { rows: banks } = await pool.query(
      `SELECT id FROM bank_accounts WHERE user_id = $1 AND status = 'verified' LIMIT 1`,
      [req.user.id]
    );
    res.json(buildCheckinStatus(user, banks.length > 0));
  } catch (err) {
    console.error('[users/me/checkin GET]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// PATCH /api/users/me/checkin — mark lease or maintenance page viewed
router.patch('/me/checkin', Guards.tenantOnly, async (req, res) => {
  const allowed = ['lease_viewed', 'maintenance_viewed'];
  const { step } = req.body ?? {};
  if (!allowed.includes(step)) {
    return res.status(400).json({ error: 'INVALID_STEP', message: 'Invalid check-in step.' });
  }
  const column = step === 'lease_viewed' ? 'lease_viewed_at' : 'maintenance_viewed_at';
  try {
    await pool.query(
      `UPDATE users SET ${column} = COALESCE(${column}, NOW()) WHERE id = $1`,
      [req.user.id]
    );
    res.json({ ok: true });
    const { maybeAlertCheckinComplete } = require('../services/ops-alert.service');
    maybeAlertCheckinComplete(req.user.id).catch((err) => {
      console.warn('[users/me/checkin] check-in alert:', err.message);
    });
  } catch (err) {
    console.error('[users/me/checkin PATCH]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

async function tenantOffboardLease(tenantId) {
  const { rows } = await pool.query(
    `SELECT l.*
       FROM leases l
      WHERE l.tenant_id = $1
      ORDER BY
        CASE WHEN l.offboarding_started_at IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN l.status IN ('expired', 'terminated') THEN 0 ELSE 1 END,
        l.end_date DESC NULLS LAST
      LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

// GET /api/users/me/offboarding — tenant move-out checklist
router.get('/me/offboarding', Guards.tenantOnly, async (req, res) => {
  try {
    const lease = await tenantOffboardLease(req.user.id);
    if (!lease || !isOffboardingActive(lease)) {
      return res.json({ active: false });
    }
    res.json(
      buildTenantOffboardingStatus({
        id: lease.id,
        lease_status: lease.status,
        offboarding_started_at: lease.offboarding_started_at,
        offboard_forwarding_confirmed_at: lease.offboard_forwarding_confirmed_at,
        offboard_keys_returned_at: lease.offboard_keys_returned_at,
        offboard_final_charges_ack_at: lease.offboard_final_charges_ack_at,
        offboard_moveout_confirmed_at: lease.offboard_moveout_confirmed_at,
      })
    );
  } catch (err) {
    console.error('[users/me/offboarding GET]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// PATCH /api/users/me/offboarding — tenant marks move-out steps
router.patch('/me/offboarding', Guards.tenantOnly, async (req, res) => {
  const step = req.body?.step;
  const meta = resolveStepMeta(step);
  if (!meta || !TENANT_STEP_KEYS.has(step)) {
    return res.status(400).json({ error: 'INVALID_STEP', message: 'Invalid offboarding step.' });
  }

  try {
    const lease = await tenantOffboardLease(req.user.id);
    if (!lease || !isOffboardingActive(lease)) {
      return res.status(400).json({ error: 'NOT_ACTIVE', message: 'Move-out checklist is not active.' });
    }

    const { rows } = await pool.query(
      `UPDATE leases
          SET ${meta.column} = COALESCE(${meta.column}, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [lease.id]
    );

    const updated = rows[0];
    res.json(
      buildTenantOffboardingStatus({
        id: updated.id,
        lease_status: updated.status,
        offboarding_started_at: updated.offboarding_started_at,
        offboard_forwarding_confirmed_at: updated.offboard_forwarding_confirmed_at,
        offboard_keys_returned_at: updated.offboard_keys_returned_at,
        offboard_final_charges_ack_at: updated.offboard_final_charges_ack_at,
        offboard_moveout_confirmed_at: updated.offboard_moveout_confirmed_at,
      })
    );
  } catch (err) {
    console.error('[users/me/offboarding PATCH]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// POST /api/users/:id/impersonate — preview portal as tenant or staff (1h token, no refresh)
router.post('/:id/impersonate', authorizeMin('property_manager'), async (req, res) => {
  const targetId = req.params.id;

  if (req.user.impersonatedBy) {
    return res.status(403).json({
      error:   'NESTED_IMPERSONATION',
      message: 'Exit the current preview first.',
    });
  }

  if (targetId === req.user.id) {
    return res.status(403).json({
      error:   'FORBIDDEN',
      message: 'You cannot preview your own account.',
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, email, role, first_name, last_name, is_active, org_id
         FROM users WHERE id = $1`,
      [targetId]
    );
    const target = rows[0];
    if (!target) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    }
    if (!target.is_active) {
      return res.status(403).json({ error: 'INACTIVE', message: 'That account is inactive.' });
    }

    const actorOrg = await resolveOrgId(req.user.id);
    const targetOrg = target.org_id || (await resolveOrgId(target.id));
    if (!actorOrg || !targetOrg || actorOrg !== targetOrg) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'User is not in your organization.' });
    }

    if (target.role === 'tenant') {
      const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
      if (!propIds.length || !(await tenantInProperties(targetId, propIds))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Tenant is not in your properties.' });
      }
    } else if (['owner', 'property_manager'].includes(target.role)) {
      if (!['owner', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({
          error:   'FORBIDDEN',
          message: 'Only an owner can preview staff portals.',
        });
      }
      const primaryOwnerId = await getPrimaryOwnerId(actorOrg);
      if (primaryOwnerId && target.id === primaryOwnerId && req.user.id !== primaryOwnerId) {
        return res.status(403).json({
          error:   'FORBIDDEN',
          message: 'You cannot preview the primary owner account.',
        });
      }
    } else {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'This account cannot be previewed.' });
    }

    const accessToken = signImpersonationToken(target, {
      id: req.user.id,
      role: req.user.role,
    });

    console.info('[impersonate]', req.user.id, '→', targetId, `(${target.role})`);

    res.json({
      accessToken,
      user: {
        id:        target.id,
        email:     target.email,
        role:      target.role,
        firstName: target.first_name,
        lastName:  target.last_name,
      },
    });
  } catch (err) {
    console.error('[users/:id/impersonate]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// PATCH /api/users/me
router.patch('/me', async (req, res) => {
  if (impersonationBlocked(req, res)) return;
  const { firstName, lastName, phone } = req.body ?? {};

  if (firstName === undefined && lastName === undefined && phone === undefined) {
    return res.status(400).json({
      error:   'NO_FIELDS',
      message: 'Provide at least one of firstName, lastName, or phone.',
    });
  }

  try {
    const { rows: current } = await pool.query(
      'SELECT first_name, last_name, phone FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!current[0]) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    }

    const row = current[0];
    const nextFirst = firstName !== undefined ? String(firstName).trim() : row.first_name;
    const nextLast  = lastName !== undefined
      ? (lastName ? String(lastName).trim() : null)
      : row.last_name;
    const nextPhone = phone !== undefined
      ? (phone ? String(phone).trim() : null)
      : row.phone;

    if (firstName !== undefined && !nextFirst) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'First name cannot be empty.' });
    }

    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, updated_at = NOW()
        WHERE id = $4`,
      [nextFirst, nextLast, nextPhone, req.user.id]
    );

    const { rows } = await pool.query(ME_SELECT, [req.user.id]);
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('[users/me PATCH]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// POST /api/users/me/password
router.post('/me/password', async (req, res) => {
  if (impersonationBlocked(req, res)) return;
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error:   'MISSING_FIELDS',
      message: 'currentPassword and newPassword are required.',
    });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({
      error:   'WEAK_PASSWORD',
      message: 'Password must be at least 8 characters.',
    });
  }

  try {
    const { rows } = await pool.query(
      'SELECT password_hash, role, password_changed_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    }

    const match = await bcrypt.compare(String(currentPassword), rows[0].password_hash);
    if (!match) {
      return res.status(401).json({
        error:   'WRONG_PASSWORD',
        message: 'Current password is incorrect.',
      });
    }

    const hash = await bcrypt.hash(String(newPassword), 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]
    );
    await pool.query(
      `UPDATE users SET password_changed_at = NOW() WHERE id = $1`,
      [req.user.id]
    );

    if (rows[0].role === 'tenant') {
      const { notifyOwnersTenantPasswordChanged } = require('../services/password-admin.service');
      notifyOwnersTenantPasswordChanged(req.user.id).catch((err) => {
        console.error('[users/me/password] owner notify failed:', err.message);
      });
      const { maybeAlertCheckinComplete } = require('../services/ops-alert.service');
      maybeAlertCheckinComplete(req.user.id).catch((err) => {
        console.warn('[users/me/password] check-in alert:', err.message);
      });
    }

    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('[users/me/password]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

module.exports = router;
