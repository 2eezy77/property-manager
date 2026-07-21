/**
 * Owner / manager ops alerts for portal events (email + in-app notification rows).
 * Fire-and-forget from routes — never throw to callers.
 */
const pool = require('../db/client');
const {
  getOperationalStaff,
  sendOperationalStaffEmail,
  sendOwnerActionEmail,
} = require('./email.service');
const { BRAND } = require('./email-templates/brand');

const ADMIN_SITE_VISITS = `${String(BRAND.adminUrl).replace(/\/$/, '')}/site-visits`;
const MANAGER_TENANTS = `${String(BRAND.managerDashboardUrl).replace(/\/$/, '')}/tenants`;
const MANAGER_PAYMENTS = String(BRAND.managerPaymentsUrl);

async function alreadyNotified(db, { type, relatedEntityId, channel = 'email' }) {
  if (!relatedEntityId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM notifications
      WHERE type = $1 AND channel = $2 AND related_entity_id = $3
      LIMIT 1`,
    [type, channel, relatedEntityId]
  );
  return rows.length > 0;
}

async function recordStaffNotifications(db, {
  staff,
  type,
  title,
  body,
  relatedEntityType,
  relatedEntityId,
  externalId,
  channel = 'email',
}) {
  for (const person of staff) {
    await db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        person.id,
        type,
        title,
        body,
        channel,
        relatedEntityType || null,
        relatedEntityId || null,
        externalId || null,
      ]
    );
  }
}

async function resolveTenantOrgId(tenantId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1 AND org_id IS NOT NULL),
       (SELECT p.org_id FROM leases l
          JOIN units u ON u.id = l.unit_id
          JOIN properties p ON p.id = u.property_id
         WHERE l.tenant_id = $1
         ORDER BY CASE WHEN l.status = 'active' THEN 0 ELSE 1 END
         LIMIT 1)
     ) AS org_id`,
    [tenantId]
  );
  return rows[0]?.org_id || null;
}

async function loadTenantLabel(tenantId) {
  const { rows: [u] } = await pool.query(
    `SELECT first_name, last_name, email FROM users WHERE id = $1`,
    [tenantId]
  );
  if (!u) return { name: 'Tenant', email: '' };
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email;
  return { name, email: u.email };
}

/**
 * Manager requested a boots-on-site visit — owners must approve.
 */
async function alertSiteVisitPendingApproval(visit) {
  try {
    if (!visit?.id || !visit.orgId) return { sent: false };
    const type = 'site_visit_pending_approval';
    if (await alreadyNotified(pool, { type, relatedEntityId: visit.id })) {
      return { sent: false, skipped: 'already_sent' };
    }

    const when = visit.plannedVisitAtFormatted || 'see portal';
    const note = visit.requestedNote || visit.note || '(no note)';
    const manager = visit.managerName || 'Property manager';
    const subject = `[Action needed] Site visit awaiting your approval — ${BRAND.property}`;
    const text = [
      `${manager} requested a boots-on-site visit and is waiting for owner approval.`,
      '',
      `Planned: ${when}`,
      `Note: ${note}`,
      '',
      `Review and approve/reject: ${ADMIN_SITE_VISITS}`,
      '',
      '— Montero Rentals',
    ].join('\n');

    const { all: staff } = await getOperationalStaff(pool, visit.orgId);
    const result = await sendOwnerActionEmail(pool, {
      orgId: visit.orgId,
      subject,
      text,
      html: `<p><strong>${escapeHtml(manager)}</strong> requested a boots-on-site visit and is waiting for owner approval.</p>
<p><strong>Planned:</strong> ${escapeHtml(when)}<br/>
<strong>Note:</strong> ${escapeHtml(note)}</p>
<p><a href="${escapeHtml(ADMIN_SITE_VISITS)}">Open site visits to approve or reject</a></p>`,
    });

    if (result.sent) {
      await recordStaffNotifications(pool, {
        staff,
        type,
        title: subject,
        body: text,
        relatedEntityType: 'site_visit',
        relatedEntityId: visit.id,
        externalId: result.id,
      });
    }
    return result;
  } catch (err) {
    console.warn('[ops-alert] site visit pending:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Tenant linked a verified bank (Plaid → Stripe).
 * @param {{ tenantId: string, bankAccountId: string, institutionName?: string, accountMask?: string }} args
 */
async function alertTenantBankLinked({ tenantId, bankAccountId, institutionName, accountMask }) {
  try {
    if (!bankAccountId) return { sent: false, skipped: 'no_bank_id' };
    const orgId = await resolveTenantOrgId(tenantId);
    if (!orgId) return { sent: false, skipped: 'no_org' };
    const { name, email } = await loadTenantLabel(tenantId);
    const type = 'tenant_bank_linked';
    if (await alreadyNotified(pool, { type, relatedEntityId: bankAccountId })) {
      return { sent: false, skipped: 'already_sent' };
    }

    const bankLabel = [institutionName, accountMask ? `····${accountMask}` : null]
      .filter(Boolean)
      .join(' ');
    const subject = `[Portal] ${name} linked a bank`;
    const text = [
      `${name} (${email}) linked a bank in the tenant portal.`,
      bankLabel ? `Account: ${bankLabel}` : '',
      '',
      'They can now use ACH / Autopay (late-fee waiver when Autopay is on).',
      `Tenants: ${MANAGER_TENANTS}`,
      `Payments: ${MANAGER_PAYMENTS}`,
      '',
      '— Montero Rentals',
    ].filter(Boolean).join('\n');

    const { all: staff } = await getOperationalStaff(pool, orgId);
    const result = await sendOperationalStaffEmail(pool, { orgId, subject, text });
    if (result.sent) {
      await recordStaffNotifications(pool, {
        staff,
        type,
        title: subject,
        body: text,
        relatedEntityType: 'bank_account',
        relatedEntityId: bankAccountId,
        externalId: result.id,
      });
    }
    return result;
  } catch (err) {
    console.warn('[ops-alert] bank linked:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Tenant finished the 4-step move-in check-in (password, bank, lease, maintenance).
 */
async function alertTenantCheckinComplete({ tenantId }) {
  try {
    const orgId = await resolveTenantOrgId(tenantId);
    if (!orgId) return { sent: false, skipped: 'no_org' };
    const { name, email } = await loadTenantLabel(tenantId);
    const type = 'tenant_checkin_complete';
    if (await alreadyNotified(pool, { type, relatedEntityId: tenantId })) {
      return { sent: false, skipped: 'already_sent' };
    }

    const subject = `[Portal] ${name} finished check-in`;
    const text = [
      `${name} (${email}) completed tenant check-in in the portal:`,
      'password changed · bank linked · lease reviewed · maintenance viewed',
      '',
      `Open tenants: ${MANAGER_TENANTS}`,
      '',
      '— Montero Rentals',
    ].join('\n');

    const { all: staff } = await getOperationalStaff(pool, orgId);
    const result = await sendOperationalStaffEmail(pool, { orgId, subject, text });
    if (result.sent) {
      await recordStaffNotifications(pool, {
        staff,
        type,
        title: subject,
        body: text,
        relatedEntityType: 'user',
        relatedEntityId: tenantId,
        externalId: result.id,
      });
    }
    return result;
  } catch (err) {
    console.warn('[ops-alert] check-in complete:', err.message);
    return { sent: false, error: err.message };
  }
}

/** Recompute check-in; alert once when it becomes complete. */
async function maybeAlertCheckinComplete(tenantId) {
  try {
    const { rows: [user] } = await pool.query(
      `SELECT password_changed_at, lease_viewed_at, maintenance_viewed_at
         FROM users WHERE id = $1`,
      [tenantId]
    );
    const { rows: banks } = await pool.query(
      `SELECT id FROM bank_accounts
        WHERE user_id = $1 AND status = 'verified'
        LIMIT 1`,
      [tenantId]
    );
    const { buildCheckinStatus } = require('./tenant-checkin.service');
    const status = buildCheckinStatus(user, banks.length > 0);
    if (!status.allComplete) return { sent: false, skipped: 'incomplete' };
    return alertTenantCheckinComplete({ tenantId });
  } catch (err) {
    console.warn('[ops-alert] maybe check-in:', err.message);
    return { sent: false, error: err.message };
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  alertSiteVisitPendingApproval,
  alertTenantBankLinked,
  alertTenantCheckinComplete,
  maybeAlertCheckinComplete,
};
