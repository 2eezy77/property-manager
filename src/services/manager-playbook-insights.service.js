/**
 * Live tracking data for manager playbook checklist steps (org-scoped).
 */

const pool = require('../db/client');
const { accessiblePropertyIds } = require('../utils/property-access');
const { getRentStatusRoster } = require('./rent-status.service');
const { buildManagerOnboardingStatus } = require('./tenant-checkin.service');
const { buildManagerOffboardingStatus } = require('./tenant-offboarding.service');
const {
  insight,
  row,
  onboardingRows,
  buildRentInsight,
  buildUtilitiesInsight,
} = require('./manager-playbook-insights-pure');

const OPEN_MAINT_STATUSES = ['submitted', 'triaged', 'assigned', 'in_progress', 'pending_tenant'];
const PENDING_UTILITY_BILL_STATUSES = ['draft', 'notified', 'charging'];
const OWED_SPLIT_STATUSES = ['notified', 'charging'];

const TENANT_ROSTER_SELECT = `
  u.id, u.first_name, u.last_name, u.email,
  un.unit_number, p.name AS property_name,
  l.id AS lease_id, l.monthly_rent,
  u.password_changed_at,
  u.lease_viewed_at,
  u.maintenance_viewed_at,
  u.vivint_access_configured_at,
  EXISTS (
    SELECT 1 FROM bank_accounts ba
     WHERE ba.user_id = u.id AND ba.status = 'verified'
  ) AS has_verified_bank,
  l.offboarding_started_at,
  l.offboard_forwarding_confirmed_at,
  l.offboard_keys_returned_at,
  l.offboard_final_charges_ack_at,
  l.offboard_moveout_confirmed_at,
  l.offboard_vivint_revoked_at,
  l.offboard_bank_unlinked_at,
  l.offboard_utilities_settled_at,
  l.offboard_portal_disabled_at,
  l.status AS lease_status`;

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return {
    monthStart: start.toISOString().slice(0, 10),
    monthEnd: end.toISOString().slice(0, 10),
    monthLabel: label,
  };
}

function tenantName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
}

function unitLine(row) {
  const parts = [];
  if (row.property_name) parts.push(row.property_name);
  if (row.unit_number) parts.push(`Unit ${row.unit_number}`);
  return parts.join(' · ') || '743 A Ave';
}

async function loadTenantRoster(propIds) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT ${TENANT_ROSTER_SELECT}
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE un.property_id = ANY($1)
        AND u.role = 'tenant'
      ORDER BY u.last_name, u.first_name`,
    [propIds]
  );
  return rows.map((r) => ({
    ...r,
    name: tenantName(r),
    unitLine: unitLine(r),
    checkin: buildManagerOnboardingStatus(
      {
        password_changed_at: r.password_changed_at,
        lease_viewed_at: r.lease_viewed_at,
        maintenance_viewed_at: r.maintenance_viewed_at,
        vivint_access_configured_at: r.vivint_access_configured_at,
      },
      r.has_verified_bank
    ),
  }));
}

async function utilityTenantOwed(propIds) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT u.id AS tenant_id, u.email,
            (u.first_name || ' ' || u.last_name) AS name,
            un.unit_number,
            COALESCE(SUM(s.amount) FILTER (
              WHERE s.status::text = ANY($2)
            ), 0)::numeric AS owed,
            COUNT(*) FILTER (WHERE s.status = 'disputed')::int AS disputed_count
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN users u ON u.id = s.tenant_id
       LEFT JOIN leases l ON l.id = s.lease_id
       LEFT JOIN units un ON un.id = l.unit_id
      WHERE ub.property_id = ANY($1)
      GROUP BY u.id, u.email, u.first_name, u.last_name, un.unit_number
     HAVING COALESCE(SUM(s.amount) FILTER (WHERE s.status::text = ANY($2)), 0) > 0
         OR COUNT(*) FILTER (WHERE s.status = 'disputed') > 0
      ORDER BY owed DESC, name`,
    [propIds, OWED_SPLIT_STATUSES]
  );
  return rows;
}

async function utilityBillsQueue(propIds) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT ub.id, ub.service_type, ub.status, ub.total_amount::numeric AS total_amount,
            ub.period_start, p.name AS property_name
       FROM utility_bills ub
       JOIN properties p ON p.id = ub.property_id
      WHERE ub.property_id = ANY($1)
        AND ub.status::text = ANY($2)
      ORDER BY
        CASE ub.status::text WHEN 'draft' THEN 0 WHEN 'notified' THEN 1 ELSE 2 END,
        ub.created_at DESC
      LIMIT 6`,
    [propIds, PENDING_UTILITY_BILL_STATUSES]
  );
  return rows;
}

async function inboxPending(propIds, limit = 6) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT mt.id, mt.subject, mt.urgency, mt.updated_at,
            (u.first_name || ' ' || u.last_name) AS tenant_name,
            u.email AS tenant_email,
            un.unit_number
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
        mt.updated_at ASC
      LIMIT $2`,
    [propIds, limit]
  );
  return rows;
}

async function maintenanceOpen(propIds, limit = 5) {
  if (!propIds.length) return { total: 0, items: [] };
  const [countR, listR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
         FROM maintenance_requests mr
         JOIN units un ON un.id = mr.unit_id
        WHERE un.property_id = ANY($1)
          AND mr.status = ANY($2)`,
      [propIds, OPEN_MAINT_STATUSES]
    ),
    pool.query(
      `SELECT mr.id, mr.title, mr.status, mr.priority, mr.updated_at,
              un.unit_number
         FROM maintenance_requests mr
         JOIN units un ON un.id = mr.unit_id
        WHERE un.property_id = ANY($1)
          AND mr.status = ANY($2)
        ORDER BY
          CASE mr.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1
            WHEN 'medium' THEN 2 ELSE 3 END,
          mr.updated_at DESC
        LIMIT $3`,
      [propIds, OPEN_MAINT_STATUSES, limit]
    ),
  ]);
  return { total: countR.rows[0]?.total ?? 0, items: listR.rows };
}

async function lastAnnouncement(orgId) {
  if (!orgId) return null;
  const { rows } = await pool.query(
    `SELECT title, created_at FROM announcements WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orgId]
  );
  return rows[0] ?? null;
}

async function offboardingTenants(propIds) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT ${TENANT_ROSTER_SELECT}
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
      ORDER BY u.last_name`,
    [propIds]
  );
  return rows
    .map((r) => {
      const offboarding = buildManagerOffboardingStatus({
        ...r,
        lease_status: r.lease_status,
      });
      return {
        id: r.id,
        name: tenantName(r),
        email: r.email,
        unitLine: unitLine(r),
        offboarding,
      };
    })
    .filter((t) => t.offboarding.active && !t.offboarding.allComplete);
}

async function buildPlaybookInsights(userId, role) {
  const propIds = await accessiblePropertyIds(userId, role);
  const { monthLabel } = monthBounds();

  const orgR = await pool.query(`SELECT org_id FROM users WHERE id = $1`, [userId]);
  const orgId = orgR.rows[0]?.org_id ?? null;

  const [roster, rentRoster, utilBills, utilOwed, inbox, maint, lastAnn, offboarding] =
    await Promise.all([
      loadTenantRoster(propIds),
      getRentStatusRoster(userId, role),
      utilityBillsQueue(propIds),
      utilityTenantOwed(propIds),
      inboxPending(propIds),
      maintenanceOpen(propIds),
      lastAnnouncement(orgId),
      offboardingTenants(propIds),
    ]);

  const byCategory = {
    tenant_passwords: onboardingRows(
      roster,
      'passwordChanged',
      'change login password',
      'Set your Montero Rentals portal password'
    ),
    bank_links: onboardingRows(
      roster,
      'bankLinked',
      'link a bank for rent',
      'Link your bank for rent payments — Montero Rentals'
    ),
    vivint_access: onboardingRows(
      roster,
      'vivintAccessConfigured',
      'Vivint / door access',
      'Smart home access at 743 A Ave'
    ),
    lease_review: onboardingRows(
      roster,
      'leaseViewed',
      'review lease in portal',
      'Please review your lease in the tenant portal'
    ),
    maintenance_intro:
      roster.filter((t) => !t.checkin.maintenanceViewed).length > 0
        ? onboardingRows(
            roster,
            'maintenanceViewed',
            'open Maintenance in the app',
            'How to submit maintenance requests — 743 A Ave'
          )
        : maint.total > 0
          ? insight(
              'watch',
              `${maint.total} open maintenance request${maint.total === 1 ? '' : 's'}.`,
              maint.items.map((m) =>
                row(
                  m.title,
                  `Unit ${m.unit_number || '?'} · ${m.priority} · ${m.status}`,
                  m.priority === 'emergency' ? 'danger' : 'warn'
                )
              )
            )
          : insight('ok', 'Tenants know how to submit repairs; queue is clear.'),
    rent_collection: buildRentInsight(rentRoster),
    utilities: buildUtilitiesInsight(utilBills, utilOwed),
    announcements: (() => {
      if (!lastAnn) {
        return insight('action', 'No announcements posted yet — send house rules and contacts.', [
          row('Suggested', 'Trash day, quiet hours, Wi‑Fi, emergency numbers', 'warn'),
        ]);
      }
      const days = Math.floor(
        (Date.now() - new Date(lastAnn.created_at).getTime()) / (86400 * 1000)
      );
      const title = lastAnn.title || 'Latest announcement';
      if (days > 45) {
        return insight('watch', `Last post was ${days} days ago: “${title}”.`, [
          row('Consider', 'Post a seasonal or rent reminder', 'info'),
        ]);
      }
      return insight('ok', `Latest: “${title}” (${days} day${days === 1 ? '' : 's'} ago).`);
    })(),
    inbox_sla: (() => {
      if (!inbox.length) {
        return insight('ok', 'Inbox clear — no pending tenant threads.');
      }
      return insight(
        'action',
        `${inbox.length} thread${inbox.length === 1 ? '' : 's'} waiting for a reply.`,
        inbox.map((t) =>
          row(
            t.tenant_name || 'Tenant',
            (t.subject || '(no subject)') +
              (t.unit_number ? ` · Unit ${t.unit_number}` : ''),
            t.urgency === 'emergency' || t.urgency === 'high' ? 'danger' : 'warn',
            {
              email: t.tenant_email,
              emailSubject: `Re: ${t.subject || 'your message'}`,
              emailHint: 'Reply by email',
            }
          )
        )
      );
    })(),
    tenant_offboarding: (() => {
      if (!offboarding.length) {
        return insight('ok', 'No active move-out checklists.');
      }
      return insight(
        'action',
        `${offboarding.length} move-out${offboarding.length === 1 ? '' : 's'} in progress.`,
        offboarding.map((t) =>
          row(
            t.name,
            `${t.unitLine} · ${t.offboarding.completedCount}/${t.offboarding.totalSteps} steps done`,
            'warn',
            {
              email: t.email,
              emailSubject: 'Move-out checklist — 743 A Ave',
              emailHint: 'Email tenant',
            }
          )
        )
      );
    })(),
  };

  return {
    monthLabel,
    generated_at: new Date().toISOString(),
    rentStatus: rentRoster,
    byCategory,
  };
}

module.exports = {
  buildPlaybookInsights,
  onboardingRows,
  buildRentInsight,
  buildUtilitiesInsight,
};
