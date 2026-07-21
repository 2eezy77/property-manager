/**
 * Owner snapshot of property manager operational workload (org-scoped).
 */

const pool = require('../db/client');
const { buildManagerOnboardingStatus } = require('./tenant-checkin.service');
const { buildManagerOffboardingStatus } = require('./tenant-offboarding.service');
const playbook = require('./manager-playbook.service');

const MANAGER_EMAIL = 'konstantinhazlett@yahoo.com';
const OPEN_MAINT_STATUSES = ['submitted', 'triaged', 'assigned', 'in_progress', 'pending_tenant'];
const PENDING_UTILITY_STATUSES = ['draft', 'notified', 'charging'];

const TENANT_ONBOARDING_SELECT = `
  u.password_changed_at,
  u.lease_viewed_at,
  u.maintenance_viewed_at,
  u.vivint_access_configured_at,
  l.id AS offboard_lease_id,
  l.offboarding_started_at,
  l.offboard_forwarding_confirmed_at,
  l.offboard_keys_returned_at,
  l.offboard_final_charges_ack_at,
  l.offboard_moveout_confirmed_at,
  l.offboard_vivint_revoked_at,
  l.offboard_bank_unlinked_at,
  l.offboard_utilities_settled_at,
  l.offboard_portal_disabled_at,
  EXISTS (
    SELECT 1 FROM bank_accounts ba
     WHERE ba.user_id = u.id AND ba.status = 'verified'
  ) AS has_verified_bank`;

async function resolveOrgId(ownerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1 AND org_id IS NOT NULL),
       (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1)
     ) AS org_id`,
    [ownerId]
  );
  return rows[0]?.org_id ?? null;
}

async function resolveManager(orgId) {
  if (!orgId) return null;

  const { rows: byEmail } = await pool.query(
    `SELECT id, first_name, last_name, email, last_login_at, role
       FROM users
      WHERE org_id = $1 AND LOWER(email) = LOWER($2) AND role = 'property_manager'
      LIMIT 1`,
    [orgId, MANAGER_EMAIL]
  );
  if (byEmail.length) return byEmail[0];

  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, email, last_login_at, role
       FROM users
      WHERE org_id = $1 AND role = 'property_manager'
      ORDER BY created_at ASC
      LIMIT 1`,
    [orgId]
  );
  return rows[0] ?? null;
}

async function propertyIdsForOrg(orgId) {
  const { rows } = await pool.query(
    `SELECT id, name, city, state FROM properties WHERE org_id = $1 ORDER BY name`,
    [orgId]
  );
  return rows;
}

function managerDisplayName(row) {
  if (!row) return 'Property manager';
  const parts = [row.first_name, row.last_name].filter(Boolean);
  return parts.length ? parts.join(' ') : row.email;
}

async function maintenanceCounts(propIds) {
  if (!propIds.length) {
    return { by_status: {}, open_total: 0 };
  }
  const { rows } = await pool.query(
    `SELECT mr.status, COUNT(*)::int AS count
       FROM maintenance_requests mr
       JOIN units un ON un.id = mr.unit_id
      WHERE un.property_id = ANY($1)
        AND mr.status = ANY($2)
      GROUP BY mr.status`,
    [propIds, OPEN_MAINT_STATUSES]
  );
  const by_status = {};
  let open_total = 0;
  for (const s of OPEN_MAINT_STATUSES) by_status[s] = 0;
  for (const r of rows) {
    by_status[r.status] = r.count;
    open_total += r.count;
  }
  return { by_status, open_total };
}

async function recentMaintenance(propIds, limit = 5) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT mr.id, mr.title, mr.status, mr.priority, mr.created_at, mr.updated_at,
            un.unit_number, p.name AS property_name
       FROM maintenance_requests mr
       JOIN units un ON un.id = mr.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE un.property_id = ANY($1)
        AND mr.status = ANY($2)
      ORDER BY
        CASE mr.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 ELSE 3 END,
        mr.updated_at DESC
      LIMIT $3`,
    [propIds, OPEN_MAINT_STATUSES, limit]
  );
  return rows;
}

async function inboxCountsAndRecent(propIds, limit = 5) {
  if (!propIds.length) {
    return { pending_threads: 0, recent_threads: [] };
  }
  const [countR, listR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS pending
         FROM message_threads mt
         LEFT JOIN units un ON un.id = mt.unit_id
         LEFT JOIN properties p ON p.id = un.property_id
        WHERE mt.is_open = TRUE
          AND mt.triage_status = 'pending'
          AND p.id = ANY($1)`,
      [propIds]
    ),
    pool.query(
      `SELECT mt.id, mt.subject, mt.urgency, mt.triage_status, mt.updated_at,
              (u.first_name || ' ' || u.last_name) AS tenant_name,
              un.unit_number, p.name AS property_name
         FROM message_threads mt
         JOIN users u ON u.id = mt.tenant_id
         LEFT JOIN units un ON un.id = mt.unit_id
         LEFT JOIN properties p ON p.id = un.property_id
        WHERE mt.is_open = TRUE
          AND mt.triage_status = 'pending'
          AND p.id = ANY($1)
        ORDER BY
          CASE mt.urgency WHEN 'emergency' THEN 0 WHEN 'high' THEN 1
            WHEN 'medium' THEN 2 ELSE 3 END,
          mt.updated_at DESC
        LIMIT $2`,
      [propIds, limit]
    ),
  ]);
  return {
    pending_threads: countR.rows[0]?.pending ?? 0,
    recent_threads: listR.rows,
  };
}

async function rentPaymentCounts(propIds) {
  if (!propIds.length) {
    return { failed_count: 0, pending_count: 0, outstanding_amount: 0 };
  }
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE p.status = 'failed')::int AS failed_count,
       COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending_count,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('failed','pending')), 0) AS outstanding_amount
     FROM payments p
     JOIN leases l ON l.id = p.lease_id
     JOIN units un ON un.id = l.unit_id
    WHERE un.property_id = ANY($1)
      AND p.payment_type = 'rent'
      AND p.status IN ('failed','pending')`,
    [propIds]
  );
  return rows[0] ?? { failed_count: 0, pending_count: 0, outstanding_amount: 0 };
}

async function incompleteOnboarding(propIds) {
  if (!propIds.length) return { count: 0, tenants: [] };

  const { rows } = await pool.query(
    `SELECT DISTINCT
            u.id, u.first_name, u.last_name, u.email,
            un.unit_number, p.name AS property_name,
            ${TENANT_ONBOARDING_SELECT}
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE un.property_id = ANY($1)
        AND u.role = 'tenant'
      ORDER BY u.last_name, u.first_name`,
    [propIds]
  );

  const tenants = rows
    .map((row) => {
      const checkin = buildManagerOnboardingStatus(
        {
          password_changed_at: row.password_changed_at,
          lease_viewed_at: row.lease_viewed_at,
          maintenance_viewed_at: row.maintenance_viewed_at,
          vivint_access_configured_at: row.vivint_access_configured_at,
        },
        row.has_verified_bank
      );
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        unit_number: row.unit_number,
        property_name: row.property_name,
        checkin,
      };
    })
    .filter((t) => !t.checkin.allComplete);

  return { count: tenants.length, tenants: tenants.slice(0, 5) };
}

async function incompleteOffboarding(propIds) {
  if (!propIds.length) return { count: 0, tenants: [] };

  const { rows } = await pool.query(
    `SELECT DISTINCT
            u.id, u.first_name, u.last_name, u.email,
            l.status AS lease_status,
            un.unit_number, p.name AS property_name,
            ${TENANT_ONBOARDING_SELECT}
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status IN ('active', 'expired', 'terminated')
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

  const tenants = rows
    .map((row) => {
      const offboarding = buildManagerOffboardingStatus({
        ...row,
        lease_status: row.lease_status,
      });
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        unit_number: row.unit_number,
        property_name: row.property_name,
        offboarding,
      };
    })
    .filter((t) => t.offboarding.active && !t.offboarding.allComplete);

  return { count: tenants.length, tenants: tenants.slice(0, 5) };
}

async function lastAnnouncement(orgId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.created_at,
            (u.first_name || ' ' || u.last_name) AS sender_name,
            p.name AS property_name
       FROM announcements a
       JOIN users u ON u.id = a.sender_id
       LEFT JOIN properties p ON p.id = a.property_id
      WHERE a.org_id = $1
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [orgId]
  );
  return rows[0] ?? null;
}

async function utilityBillsPending(propIds) {
  if (!propIds.length) return { count: 0, bills: [] };
  const [countR, listR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
         FROM utility_bills
        WHERE property_id = ANY($1)
          AND status::text = ANY($2)`,
      [propIds, PENDING_UTILITY_STATUSES]
    ),
    pool.query(
      `SELECT ub.id, ub.service_type, ub.status, ub.total_amount, ub.period_start,
              p.name AS property_name
         FROM utility_bills ub
         JOIN properties p ON p.id = ub.property_id
        WHERE ub.property_id = ANY($1)
          AND ub.status::text = ANY($2)
        ORDER BY ub.created_at DESC
        LIMIT 3`,
      [propIds, PENDING_UTILITY_STATUSES]
    ),
  ]);
  return { count: countR.rows[0]?.count ?? 0, bills: listR.rows };
}

async function getManagerOversight(ownerId) {
  const orgId = await resolveOrgId(ownerId);
  if (!orgId) {
    const err = new Error('No organization found for this owner account.');
    err.code = 'NO_ORG';
    throw err;
  }

  const manager = await resolveManager(orgId);
  const properties = await propertyIdsForOrg(orgId);
  const propIds = properties.map((p) => p.id);
  const primaryProperty = properties.find((p) => /743/i.test(p.name)) ?? properties[0] ?? null;

  const [
    maintenance,
    recentMaint,
    inbox,
    payments,
    onboarding,
    offboarding,
    lastAnnouncementRow,
    utilities,
    managerPlaybook,
  ] = await Promise.all([
    maintenanceCounts(propIds),
    recentMaintenance(propIds),
    inboxCountsAndRecent(propIds),
    rentPaymentCounts(propIds),
    incompleteOnboarding(propIds),
    incompleteOffboarding(propIds),
    lastAnnouncement(orgId),
    utilityBillsPending(propIds),
    manager?.id ? playbook.playbookSummary(manager.id) : Promise.resolve(null),
  ]);

  return {
    org_id: orgId,
    property: primaryProperty
      ? { id: primaryProperty.id, name: primaryProperty.name, city: primaryProperty.city, state: primaryProperty.state }
      : null,
    manager: manager
      ? {
          id: manager.id,
          name: managerDisplayName(manager),
          email: manager.email,
          last_login_at: manager.last_login_at,
        }
      : null,
    counts: {
      maintenance_open: maintenance.open_total,
      maintenance_by_status: maintenance.by_status,
      pending_inbox_threads: inbox.pending_threads,
      rent_failed: payments.failed_count,
      rent_pending: payments.pending_count,
      rent_problem_total: payments.failed_count + payments.pending_count,
      onboarding_incomplete: onboarding.count,
      offboarding_incomplete: offboarding.count,
      utility_bills_pending: utilities.count,
    },
    recent: {
      maintenance: recentMaint,
      inbox_threads: inbox.recent_threads,
      onboarding_tenants: onboarding.tenants,
      offboarding_tenants: offboarding.tenants,
    },
    optional: {
      last_announcement: lastAnnouncementRow,
      utility_bills: utilities.bills,
    },
    playbook: managerPlaybook
      ? {
          total: managerPlaybook.total,
          completed: managerPlaybook.completed,
          verified: managerPlaybook.verified,
        }
      : null,
  };
}

module.exports = { getManagerOversight, resolveOrgId, MANAGER_EMAIL };
