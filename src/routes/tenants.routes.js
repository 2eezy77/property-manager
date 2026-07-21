/**
 * tenants.routes.js - Tenant management for managers.
 *
 * GET  /api/tenants              - list tenants across accessible properties (includes onboarding)
 * GET  /api/tenants/onboarding   - onboarding checklist summary per tenant
 * GET  /api/tenants/:id          - tenant detail + lease + payment summary
 * POST /api/tenants/invite       - create tenant user account
 */

const express      = require('express');
const pool         = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { Guards }   = require('../middleware/authorize');
const { staffOnly } = Guards;
const bcrypt       = require('bcrypt');
const { buildManagerOnboardingStatus } = require('../services/tenant-checkin.service');
const {
  buildManagerOffboardingStatus,
  TENANT_STEP_KEYS,
  STAFF_STEP_KEYS,
  resolveStepMeta,
  isOffboardingActive,
} = require('../services/tenant-offboarding.service');

const router = express.Router();
router.use(authenticate);
router.use(staffOnly);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id) {
  return typeof id === 'string' && UUID_RE.test(id);
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

const LEASE_OFFBOARD_SELECT = `
  l.id AS offboard_lease_id,
  l.offboarding_started_at,
  l.offboard_forwarding_confirmed_at,
  l.offboard_keys_returned_at,
  l.offboard_final_charges_ack_at,
  l.offboard_moveout_confirmed_at,
  l.offboard_vivint_revoked_at,
  l.offboard_bank_unlinked_at,
  l.offboard_utilities_settled_at,
  l.offboard_portal_disabled_at`;

function offboardRowFromLease(lease) {
  if (!lease) return { lease_status: null };
  return {
    offboard_lease_id: lease.id,
    lease_status: lease.status,
    offboarding_started_at: lease.offboarding_started_at,
    offboard_forwarding_confirmed_at: lease.offboard_forwarding_confirmed_at,
    offboard_keys_returned_at: lease.offboard_keys_returned_at,
    offboard_final_charges_ack_at: lease.offboard_final_charges_ack_at,
    offboard_moveout_confirmed_at: lease.offboard_moveout_confirmed_at,
    offboard_vivint_revoked_at: lease.offboard_vivint_revoked_at,
    offboard_bank_unlinked_at: lease.offboard_bank_unlinked_at,
    offboard_utilities_settled_at: lease.offboard_utilities_settled_at,
    offboard_portal_disabled_at: lease.offboard_portal_disabled_at,
  };
}

function attachCheckin(row) {
  const checkin = buildManagerOnboardingStatus(
    {
      password_changed_at: row.password_changed_at,
      lease_viewed_at: row.lease_viewed_at,
      maintenance_viewed_at: row.maintenance_viewed_at,
      vivint_access_configured_at: row.vivint_access_configured_at,
    },
    row.has_verified_bank
  );
  const offboarding = buildManagerOffboardingStatus({
    ...row,
    lease_status: row.lease_status,
  });
  const {
    password_changed_at,
    lease_viewed_at,
    maintenance_viewed_at,
    vivint_access_configured_at,
    has_verified_bank,
    offboard_lease_id,
    offboarding_started_at,
    offboard_forwarding_confirmed_at,
    offboard_keys_returned_at,
    offboard_final_charges_ack_at,
    offboard_moveout_confirmed_at,
    offboard_vivint_revoked_at,
    offboard_bank_unlinked_at,
    offboard_utilities_settled_at,
    offboard_portal_disabled_at,
    ...rest
  } = row;
  return { ...rest, checkin, offboarding };
}

async function resolveOffboardLease(tenantId, propIds, leaseId) {
  const params = [tenantId, propIds];
  let leaseFilter = '';
  if (leaseId) {
    params.push(leaseId);
    leaseFilter = `AND l.id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT l.*
       FROM leases l
       JOIN units un ON un.id = l.unit_id
      WHERE l.tenant_id = $1
        AND un.property_id = ANY($2)
        ${leaseFilter}
      ORDER BY
        CASE WHEN l.offboarding_started_at IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN l.status IN ('expired', 'terminated') THEN 0 ELSE 1 END,
        l.end_date DESC NULLS LAST,
        l.start_date DESC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function assertTenantAccess(tenantId, propIds) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN units un ON un.id = l.unit_id
      WHERE u.id = $1 AND u.role = 'tenant' AND un.property_id = ANY($2)
      LIMIT 1`,
    [tenantId, propIds]
  );
  return rows.length > 0;
}

const TENANT_ONBOARDING_SELECT = `
  u.password_changed_at,
  u.lease_viewed_at,
  u.maintenance_viewed_at,
  u.vivint_access_configured_at,
  EXISTS (
    SELECT 1 FROM bank_accounts ba
     WHERE ba.user_id = u.id AND ba.status = 'verified'
  ) AS has_verified_bank,
  (
    SELECT ba.link_status FROM bank_accounts ba
     WHERE ba.user_id = u.id AND ba.status <> 'revoked'
     ORDER BY ba.is_default DESC, ba.created_at DESC
     LIMIT 1
  ) AS bank_link_status`;

// GET /api/tenants/onboarding — checklist status for accessible tenants
router.get('/onboarding', async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.length) return res.json({ tenants: [] });

    const { status, property_id, complete } = req.query;
    let conditions = ['un.property_id = ANY($1)', "u.role = 'tenant'"];
    const params = [propIds];

    if (status) {
      params.push(status);
      conditions.push(`l.status = $${params.length}`);
    }
    if (property_id) {
      params.push(property_id);
      conditions.push(`un.property_id = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT DISTINCT
              u.id, u.first_name, u.last_name, u.email,
              l.status AS lease_status,
              un.unit_number, p.name AS property_name,
              ${TENANT_ONBOARDING_SELECT},
              ${LEASE_OFFBOARD_SELECT}
         FROM users u
         JOIN leases l ON l.tenant_id = u.id
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.last_name, u.first_name`,
      params
    );

    let tenants = rows.map(attachCheckin);
    if (complete === 'true') tenants = tenants.filter((t) => t.checkin.allComplete);
    if (complete === 'false') tenants = tenants.filter((t) => !t.checkin.allComplete);

    res.json({ tenants });
  } catch (err) {
    console.error('[GET /tenants/onboarding]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tenants
router.get('/', async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.length) return res.json({ tenants: [] });

    const { status, property_id } = req.query;
    let conditions = ['un.property_id = ANY($1)'];
    let params = [propIds];

    if (status)      { params.push(status);      conditions.push(`l.status = $${params.length}`); }
    if (property_id) { params.push(property_id); conditions.push(`un.property_id = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT DISTINCT
              u.id, u.first_name, u.last_name, u.email, u.phone,
              u.is_active, u.created_at,
              l.id AS lease_id, l.status AS lease_status,
              l.start_date, l.end_date, l.monthly_rent,
              ${LEASE_OFFBOARD_SELECT},
              un.unit_number, p.name AS property_name, p.id AS property_id,
              (SELECT SUM(amount) FROM payments
               WHERE tenant_id = u.id AND status IN ('failed','pending')
                 AND payment_type = 'rent') AS outstanding_balance,
              ${TENANT_ONBOARDING_SELECT}
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       WHERE u.role = 'tenant' AND ${conditions.join(' AND ')}
       ORDER BY u.last_name, u.first_name`,
      params
    );
    res.json({ tenants: rows.map(attachCheckin) });
  } catch (err) {
    console.error('[GET /tenants]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tenants/:id
router.get('/:id', async (req, res) => {
  if (!isValidUuid(req.params.id))
    return res.status(400).json({ error: 'Invalid tenant id' });

  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    const { rows: tRows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
              u.is_active, u.created_at, u.last_login_at,
              ${TENANT_ONBOARDING_SELECT}
         FROM users u WHERE u.id = $1 AND u.role = 'tenant'`,
      [req.params.id]
    );
    if (!tRows.length) return res.status(404).json({ error: 'Tenant not found' });

    const [leasesR, paymentsR, maintenanceR, threadsR] = await Promise.all([
      pool.query(
        `SELECT l.*, un.unit_number, p.name AS property_name, p.id AS property_id
         FROM leases l
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
         WHERE l.tenant_id = $1 AND un.property_id = ANY($2)
         ORDER BY l.start_date DESC`,
        [req.params.id, propIds]
      ),
      pool.query(
        `SELECT id, amount, status, payment_type, period_start, paid_at, created_at,
                metadata->>'payment_method' AS payment_method
         FROM payments WHERE tenant_id = $1
         ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 12`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, title, status, priority, category, created_at
         FROM maintenance_requests WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, subject, urgency, triage_status, is_open, updated_at
         FROM message_threads WHERE tenant_id = $1
         ORDER BY updated_at DESC LIMIT 5`,
        [req.params.id]
      ),
    ]);

    if (!leasesR.rows.length)
      return res.status(403).json({ error: 'Tenant not in your properties' });

    const tenantRow = tRows[0];
    const primaryLease =
      leasesR.rows.find((l) => isOffboardingActive(l)) || leasesR.rows[0];
    const merged = {
      ...tenantRow,
      ...offboardRowFromLease(primaryLease),
      lease_status: primaryLease?.status,
    };
    const { checkin, offboarding, ...tenant } = attachCheckin(merged);

    res.json({
      tenant,
      checkin,
      offboarding,
      offboardLeaseId: primaryLease?.id ?? null,
      leases: leasesR.rows,
      payments: paymentsR.rows,
      maintenance: maintenanceR.rows,
      threads: threadsR.rows,
    });
  } catch (err) {
    console.error('[GET /tenants/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tenants/offboarding — move-out checklist for tenants in offboarding
router.get('/offboarding', async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.length) return res.json({ tenants: [] });

    const { complete } = req.query;
    const { rows } = await pool.query(
      `SELECT DISTINCT
              u.id, u.first_name, u.last_name, u.email,
              l.status AS lease_status, un.unit_number, p.name AS property_name,
              ${TENANT_ONBOARDING_SELECT},
              ${LEASE_OFFBOARD_SELECT}
         FROM users u
         JOIN leases l ON l.tenant_id = u.id
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
        WHERE un.property_id = ANY($1)
          AND u.role = 'tenant'
          AND (
            l.offboarding_started_at IS NOT NULL
            OR l.status IN ('expired', 'terminated')
          )
        ORDER BY u.last_name, u.first_name`,
      [propIds]
    );

    let tenants = rows.map(attachCheckin).filter((t) => t.offboarding?.active);
    if (complete === 'true') tenants = tenants.filter((t) => t.offboarding.allComplete);
    if (complete === 'false') tenants = tenants.filter((t) => !t.offboarding.allComplete);

    res.json({ tenants });
  } catch (err) {
    console.error('[GET /tenants/offboarding]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tenants/:id/offboarding/start
router.post('/:id/offboarding/start', async (req, res) => {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tenant id' });
  }
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!(await assertTenantAccess(req.params.id, propIds))) {
      return res.status(403).json({ error: 'Tenant not in your properties' });
    }

    const leaseId = req.body?.lease_id;
    let lease = await resolveOffboardLease(req.params.id, propIds, leaseId);
    if (!lease) {
      return res.status(404).json({ error: 'No lease found for this tenant' });
    }

    if (!lease.offboarding_started_at) {
      const { rows } = await pool.query(
        `UPDATE leases
            SET offboarding_started_at = NOW(),
                offboarding_started_by = $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [lease.id, req.user.id]
      );
      lease = rows[0];
    }

    res.json({
      leaseId: lease.id,
      offboarding: buildManagerOffboardingStatus(offboardRowFromLease(lease)),
    });
  } catch (err) {
    console.error('[POST /tenants/:id/offboarding/start]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tenants/:id/offboarding — staff marks move-out steps
router.patch('/:id/offboarding', async (req, res) => {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tenant id' });
  }

  const step = req.body?.step;
  const done = req.body?.done !== false;
  const meta = resolveStepMeta(step);
  if (!meta || !STAFF_STEP_KEYS.has(step)) {
    return res.status(400).json({ error: 'Invalid staff offboarding step' });
  }

  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!(await assertTenantAccess(req.params.id, propIds))) {
      return res.status(403).json({ error: 'Tenant not in your properties' });
    }

    const lease = await resolveOffboardLease(req.params.id, propIds, req.body?.lease_id);
    if (!lease || !isOffboardingActive(lease)) {
      return res.status(400).json({ error: 'Offboarding is not active for this tenant' });
    }

    const sets = [`${meta.column} = ${done ? 'NOW()' : 'NULL'}`];
    if (meta.byColumn) {
      sets.push(`${meta.byColumn} = ${done ? '$2::uuid' : 'NULL'}`);
    }
    sets.push('updated_at = NOW()');

    const params = done ? [lease.id, req.user.id] : [lease.id];
    const { rows } = await pool.query(
      `UPDATE leases SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    res.json({
      leaseId: rows[0].id,
      offboarding: buildManagerOffboardingStatus(offboardRowFromLease(rows[0])),
    });
  } catch (err) {
    console.error('[PATCH /tenants/:id/offboarding]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tenants/:id/reset-onboarding — clear move-in checklist for one tenant
router.post('/:id/reset-onboarding', async (req, res) => {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tenant id' });
  }

  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!(await assertTenantAccess(req.params.id, propIds))) {
      return res.status(403).json({ error: 'Tenant not in your properties' });
    }

    const { rows } = await pool.query(
      `UPDATE users
          SET password_changed_at = NULL,
              lease_viewed_at = NULL,
              maintenance_viewed_at = NULL,
              vivint_access_configured_at = NULL,
              vivint_access_configured_by = NULL,
              updated_at = NOW()
        WHERE id = $1 AND role = 'tenant'
        RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { rows: [bank] } = await pool.query(
      `SELECT 1 FROM bank_accounts WHERE user_id = $1 AND status = 'verified' LIMIT 1`,
      [req.params.id]
    );

    const { rows: [userRow] } = await pool.query(
      `SELECT password_changed_at, lease_viewed_at, maintenance_viewed_at,
              vivint_access_configured_at
         FROM users WHERE id = $1`,
      [req.params.id]
    );

    const checkin = buildManagerOnboardingStatus(
      { ...userRow, vivint_access_configured_at: null },
      !!bank
    );

    res.json({ ok: true, checkin });
  } catch (err) {
    console.error('[POST /tenants/:id/reset-onboarding]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tenants/:id/vivint-access — manager marks Vivint door code / key setup
router.patch('/:id/vivint-access', async (req, res) => {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tenant id' });
  }

  const configured = req.body?.configured !== false;
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    const { rows: access } = await pool.query(
      `SELECT 1
         FROM users u
         JOIN leases l ON l.tenant_id = u.id
         JOIN units un ON un.id = l.unit_id
        WHERE u.id = $1
          AND u.role = 'tenant'
          AND un.property_id = ANY($2)
        LIMIT 1`,
      [req.params.id, propIds]
    );
    if (!access.length) {
      return res.status(403).json({ error: 'Tenant not in your properties' });
    }

    const { rows } = await pool.query(
      `UPDATE users
          SET vivint_access_configured_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              vivint_access_configured_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 AND role = 'tenant'
        RETURNING id, vivint_access_configured_at`,
      [req.params.id, configured, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });

    res.json({
      tenantId: rows[0].id,
      vivint_access_configured_at: rows[0].vivint_access_configured_at,
      configured: !!rows[0].vivint_access_configured_at,
    });
  } catch (err) {
    console.error('[PATCH /tenants/:id/vivint-access]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tenants/invite  - create a tenant account (auto-generates temp password)
router.post('/invite', async (req, res) => {
  const { email, first_name, last_name, phone } = req.body;
  if (!email?.trim() || !first_name?.trim())
    return res.status(400).json({ error: 'email and first_name are required' });
  try {
    const existing = await pool.query(`SELECT id FROM users WHERE email=$1`, [email.toLowerCase().trim()]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'A user with this email already exists' });

    const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
    const hash = await bcrypt.hash(tempPassword, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, phone)
       VALUES ($1,$2,'tenant',$3,$4,$5) RETURNING id, email, first_name, last_name`,
      [email.toLowerCase().trim(), hash,
       first_name.trim(), last_name?.trim() ?? null, phone?.trim() ?? null]
    );
    res.status(201).json({ tenant: rows[0], tempPassword });
  } catch (err) {
    console.error('[POST /tenants/invite]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
