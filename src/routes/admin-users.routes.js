/**
 * admin-users.routes.js — Owner console user roster (org-scoped).
 *
 * GET /api/admin/users
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const pool = require('../db/client');
const { buildManagerOnboardingStatus } = require('../services/tenant-checkin.service');
const {
  adminSetPassword,
  adminEmailAllTenantPasswords,
  generatePassword,
} = require('../services/password-admin.service');

const router = express.Router();
router.use(authenticate);
router.use(Guards.ownerAndAbove);

async function resolveOrgId(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1 AND org_id IS NOT NULL),
       (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1)
     ) AS org_id`,
    [userId]
  );
  return rows[0]?.org_id ?? null;
}

const TENANT_ONBOARDING_SELECT = `
  u.password_changed_at,
  u.lease_viewed_at,
  u.maintenance_viewed_at,
  u.vivint_access_configured_at,
  EXISTS (
    SELECT 1 FROM bank_accounts ba
     WHERE ba.user_id = u.id AND ba.status = 'verified'
  ) AS has_verified_bank`;

function attachTenantRow(row) {
  const checkin = buildManagerOnboardingStatus(
    {
      password_changed_at: row.password_changed_at,
      lease_viewed_at: row.lease_viewed_at,
      maintenance_viewed_at: row.maintenance_viewed_at,
      vivint_access_configured_at: row.vivint_access_configured_at,
    },
    row.has_verified_bank
  );
  const {
    password_changed_at,
    lease_viewed_at,
    maintenance_viewed_at,
    vivint_access_configured_at,
    has_verified_bank,
    ...rest
  } = row;
  return { ...rest, checkin };
}

router.get('/', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    if (!orgId) {
      return res.json({ orgId: null, primaryOwnerId: null, users: [] });
    }

    const { rows: orgRows } = await pool.query(
      `SELECT owner_id FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );
    const primaryOwnerId = orgRows[0]?.owner_id ?? null;

    const { rows: staff } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
              u.last_login_at, u.created_at, u.phone
         FROM users u
        WHERE u.org_id = $1
          AND u.role IN ('owner', 'property_manager')
        ORDER BY
          CASE u.role WHEN 'owner' THEN 0 WHEN 'property_manager' THEN 1 ELSE 2 END,
          u.last_name, u.first_name`,
      [orgId]
    );

    const { rows: tenantRows } = await pool.query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
              u.last_login_at, u.created_at, u.phone,
              l.status AS lease_status, l.monthly_rent,
              un.unit_number, p.name AS property_name,
              ${TENANT_ONBOARDING_SELECT}
         FROM users u
         JOIN leases l ON l.tenant_id = u.id
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id AND p.org_id = $1
        WHERE u.role = 'tenant'
          AND (u.org_id = $1 OR u.org_id IS NULL)
        ORDER BY u.id, l.status = 'active' DESC, l.start_date DESC NULLS LAST`,
      [orgId]
    );

    const tenants = tenantRows.map(attachTenantRow);
    const withMeta = (u) => ({
      ...u,
      is_org_primary_owner: primaryOwnerId != null && u.id === primaryOwnerId,
    });
    const users = [
      ...staff.map((u) => withMeta({ ...u, checkin: null })),
      ...tenants.map(withMeta),
    ];

    res.json({ orgId, primaryOwnerId, users, staff, tenants });
  } catch (err) {
    console.error('[GET /admin/users]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/tenants/email-passwords — all active tenants (before :id route)
router.post('/tenants/email-passwords', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const { rows: orgRows } = orgId
      ? await pool.query(`SELECT owner_id FROM organizations WHERE id = $1`, [orgId])
      : { rows: [] };
    const primaryOwnerId = orgRows[0]?.owner_id ?? null;
    const payload = await adminEmailAllTenantPasswords({
      actorUserId: req.user.id,
      primaryOwnerId,
    });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: 'BULK_PASSWORD_FAILED', message: err.message });
  }
});

// GET /api/admin/users/password-generator
router.get('/password-generator', (_req, res) => {
  res.json({ password: generatePassword() });
});

// POST /api/admin/users/:id/password — set password + optional credential email
router.post('/:id/password', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const { rows: orgRows } = orgId
      ? await pool.query(`SELECT owner_id FROM organizations WHERE id = $1`, [orgId])
      : { rows: [] };
    const primaryOwnerId = orgRows[0]?.owner_id ?? null;

    const { password, generate, sendEmail: shouldSend = true } = req.body ?? {};
    const result = await adminSetPassword({
      actorUserId: req.user.id,
      targetUserId: req.params.id,
      password,
      generate: !!generate,
      sendEmail: shouldSend !== false,
      primaryOwnerId,
    });
    res.json(result);
  } catch (err) {
    const status =
      err.code === 'NOT_FOUND' ? 404
        : err.code === 'FORBIDDEN' ? 403
          : err.code === 'WEAK_PASSWORD' ? 400
            : err.code === 'NO_ORG' ? 503
              : 500;
    res.status(status).json({ error: err.code || 'PASSWORD_SET_FAILED', message: err.message });
  }
});

module.exports = router;
