/**
 * Utility bill tenant in-app notify + staff ops alerts.
 * Tenant channel is in-app only (no utility emails to tenants).
 * Workers never ACH — bill and remind only.
 */
const pool = require('../db/client');
const { getOperationalStaff } = require('./email.service');
const { BRAND } = require('./email-templates/brand');
const { isElectricBillChargeable } = require('./dominion-billing.service');
const { isCalendarMonthPeriod } = require('../use-cases/utilities/period-utils');

const REVIEW_URL = `${String(BRAND.portalUrl).replace(/\/$/, '')}/tenant/utilities`;

async function alreadyNotified(db, { userId, type, relatedEntityId, channel = null }) {
  const params = [userId, type, relatedEntityId];
  let channelSql = `AND channel IN ('email', 'in_app')`;
  if (channel) {
    params.push(channel);
    channelSql = `AND channel = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT 1 FROM notifications
      WHERE user_id = $1 AND type = $2
        AND related_entity_id = $3
        ${channelSql}
      LIMIT 1`,
    params
  );
  return rows.length > 0;
}

async function recordNotification(db, {
  userId,
  type,
  title,
  body,
  channel = 'email',
  relatedEntityType,
  relatedEntityId,
  externalId,
}) {
  await db.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
    [
      userId,
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

function tenantDisplayName(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return name || row.email || 'Tenant';
}

/**
 * In-app notify for each split on a newly notified bill (no tenant email).
 * related_entity_id = split id for reminder dedupe later.
 * UC03 usually already inserts in_app rows; this backfills any missing ones.
 */
async function sendUtilityBillNotifyEmails(billId) {
  const { rows: splits } = await pool.query(
    `SELECT s.id AS split_id, s.tenant_id, s.amount,
            ub.id AS bill_id, ub.service_type, ub.period_start, ub.period_end,
            p.org_id AS property_org_id,
            u.email, u.first_name, u.last_name
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN properties p ON p.id = ub.property_id
       JOIN users u ON u.id = s.tenant_id
      WHERE s.bill_id = $1
        AND s.status IN ('notified', 'pending')`,
    [billId]
  );

  let inApp = 0;
  for (const s of splits) {
    if (await alreadyNotified(pool, {
      userId: s.tenant_id,
      type: 'utility_bill',
      relatedEntityId: s.split_id,
      channel: 'in_app',
    })) {
      continue;
    }

    const subject = `Utility bill — your ${s.service_type} share`;
    const body = `Your share is $${Number(s.amount).toFixed(2)} for ${s.period_start} to ${s.period_end}. Dispute within 48 hours if anything looks wrong. Pay in the portal when ready.`;

    await recordNotification(pool, {
      userId: s.tenant_id,
      type: 'utility_bill',
      title: subject,
      body,
      channel: 'in_app',
      relatedEntityType: 'utility_bill_split',
      relatedEntityId: s.split_id,
    });
    inApp += 1;
  }

  return { emailed: 0, inApp, tenants: splits.length };
}

async function alertStaffUtilityEvent({
  orgId,
  type,
  subject,
  text,
  relatedEntityType,
  relatedEntityId,
}) {
  if (!orgId) return { sent: false, skipped: 'no_org' };
  try {
    const { all: staff } = await getOperationalStaff(pool, orgId);
    if (!staff.length) return { sent: false, skipped: 'no_staff' };

    let recorded = 0;
    for (const person of staff) {
      if (relatedEntityId && await alreadyNotified(pool, {
        userId: person.id,
        type,
        relatedEntityId,
        channel: 'in_app',
      })) {
        continue;
      }
      await recordNotification(pool, {
        userId: person.id,
        type,
        title: subject,
        body: text,
        channel: 'in_app',
        relatedEntityType,
        relatedEntityId,
      });
      recorded += 1;
    }
    return { sent: recorded > 0, emailed: false, inApp: recorded };
  } catch (err) {
    console.warn('[utility-comms] staff alert:', err.message);
    return { sent: false, error: err.message };
  }
}

async function alertStaffNewUtilityBill(billId) {
  const { rows: [bill] } = await pool.query(
    `SELECT ub.id, ub.service_type, ub.period_start, ub.period_end,
            ub.tenant_charge_amount, ub.total_amount, p.org_id, p.name AS property_name,
            (SELECT COUNT(*)::int FROM utility_bill_splits s WHERE s.bill_id = ub.id) AS split_count
       FROM utility_bills ub
       JOIN properties p ON p.id = ub.property_id
      WHERE ub.id = $1`,
    [billId]
  );
  if (!bill) return { sent: false };

  const amount = Number(bill.tenant_charge_amount ?? bill.total_amount ?? 0);
  const subject = `[Utilities] ${bill.service_type} shares ready — ${bill.property_name || '743 A Ave'}`;
  const text = [
    `Tenants were notified of their ${bill.service_type} shares.`,
    `Period: ${bill.period_start} – ${bill.period_end}`,
    `Bill total (tenant charge): $${amount.toFixed(2)} · ${bill.split_count} share(s)`,
    '',
    `Balances: ${BRAND.managerUtilitiesUrl}`,
    '',
    'Tenants pay themselves — no landlord ACH from workers.',
    '',
    '— Montero Rentals',
  ].join('\n');

  return alertStaffUtilityEvent({
    orgId: bill.org_id,
    type: 'utility_bill_staff',
    subject,
    text,
    relatedEntityType: 'utility_bill',
    relatedEntityId: billId,
  });
}

async function alertStaffUtilityDispute(splitId) {
  const { rows: [row] } = await pool.query(
    `SELECT s.id, s.amount, s.dispute_reason,
            ub.service_type, ub.period_start, ub.period_end, p.org_id,
            u.email, u.first_name, u.last_name
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN properties p ON p.id = ub.property_id
       JOIN users u ON u.id = s.tenant_id
      WHERE s.id = $1`,
    [splitId]
  );
  if (!row) return { sent: false };

  const name = tenantDisplayName(row);
  const subject = `[Utilities] Dispute — ${name} (${row.service_type})`;
  const text = [
    `${name} (${row.email}) disputed their ${row.service_type} share.`,
    `Amount: $${Number(row.amount).toFixed(2)}`,
    `Period: ${row.period_start} – ${row.period_end}`,
    `Reason: ${row.dispute_reason || '(none)'}`,
    '',
    `Open Utilities: ${BRAND.managerUtilitiesUrl}`,
    '',
    '— Montero Rentals',
  ].join('\n');

  return alertStaffUtilityEvent({
    orgId: row.org_id,
    type: 'utility_dispute_staff',
    subject,
    text,
    relatedEntityType: 'utility_bill_split',
    relatedEntityId: splitId,
  });
}

/**
 * Day-3 and day-7 unpaid reminders — in-app only (no tenant email). Never charges.
 */
async function sendUtilityReminders() {
  const { rows: splits } = await pool.query(
    `SELECT s.id AS split_id, s.tenant_id, s.amount, s.status,
            ub.id AS bill_id, ub.service_type, ub.period_start, ub.period_end,
            ub.notified_at, p.org_id,
            u.email, u.first_name, u.last_name
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN properties p ON p.id = ub.property_id
       JOIN users u ON u.id = s.tenant_id
      WHERE s.status IN ('notified', 'disputed')
        AND ub.notified_at IS NOT NULL
        AND ub.notified_at <= NOW() - INTERVAL '3 days'`
  );

  let reminded3 = 0;
  let reminded7 = 0;
  const overdueForStaff = [];

  for (const s of splits) {
    const notifiedAt = new Date(s.notified_at);
    const ageMs = Date.now() - notifiedAt.getTime();
    const day3 = 3 * 24 * 60 * 60 * 1000;
    const day7 = 7 * 24 * 60 * 60 * 1000;
    const amountStr = `$${Number(s.amount).toFixed(2)}`;
    const period = `${s.period_start} – ${s.period_end}`;

    if (ageMs >= day7) {
      if (!(await alreadyNotified(pool, {
        userId: s.tenant_id,
        type: 'utility_reminder_7d',
        relatedEntityId: s.split_id,
        channel: 'in_app',
      }))) {
        const subject = `Reminder: ${s.service_type} share still unpaid (${amountStr})`;
        const body = `Your ${s.service_type} share of ${amountStr} for ${period} is still open. Pay in the portal when you can.`;
        await recordNotification(pool, {
          userId: s.tenant_id,
          type: 'utility_reminder_7d',
          title: subject,
          body,
          channel: 'in_app',
          relatedEntityType: 'utility_bill_split',
          relatedEntityId: s.split_id,
        });
        reminded7 += 1;
        overdueForStaff.push(s);
      }
    } else if (ageMs >= day3) {
      if (!(await alreadyNotified(pool, {
        userId: s.tenant_id,
        type: 'utility_reminder_3d',
        relatedEntityId: s.split_id,
        channel: 'in_app',
      }))) {
        const subject = `Reminder: ${s.service_type} share due (${amountStr})`;
        const body = `Friendly reminder — your ${s.service_type} share is ${amountStr} for ${period}. Review and pay in the portal.`;
        await recordNotification(pool, {
          userId: s.tenant_id,
          type: 'utility_reminder_3d',
          title: subject,
          body,
          channel: 'in_app',
          relatedEntityType: 'utility_bill_split',
          relatedEntityId: s.split_id,
        });
        reminded3 += 1;
      }
    }
  }

  // One staff digest for newly 7d-overdue (dedupe per split via utility_overdue_staff)
  for (const s of overdueForStaff) {
    const name = tenantDisplayName(s);
    await alertStaffUtilityEvent({
      orgId: s.org_id,
      type: 'utility_overdue_staff',
      subject: `[Utilities] Still unpaid — ${name} ${s.service_type} $${Number(s.amount).toFixed(2)}`,
      text: [
        `${name} still owes $${Number(s.amount).toFixed(2)} for ${s.service_type} (${s.period_start} – ${s.period_end}).`,
        'Remind them — workers do not ACH tenants.',
        '',
        `Balances: ${BRAND.managerUtilitiesUrl}`,
        '',
        '— Montero Rentals',
      ].join('\n'),
      relatedEntityType: 'utility_bill_split',
      relatedEntityId: s.split_id,
    });
  }

  return { reminded3, reminded7, overdueStaff: overdueForStaff.length };
}

/**
 * Notify all chargeable draft bills (worker). Never charges.
 * Gated by UTILITIES_AUTO_NOTIFY_ENABLED — default OFF until owner green-lights.
 */
function autoNotifyEnabled() {
  return process.env.UTILITIES_AUTO_NOTIFY_ENABLED === 'true';
}

/**
 * Pure hold rules for worker auto-notify. Returns a reason string or null to proceed.
 * @param {object} bill
 * @param {{ hasProviderOpenForService: boolean }} ctx
 */
function draftAutoNotifyHoldReason(bill, { hasProviderOpenForService = false } = {}) {
  if (bill.service_type === 'electric' && !isElectricBillChargeable(bill)) {
    return 'not_chargeable';
  }
  if (
    bill.service_type === 'electric' &&
    (bill.amount_source === 'amount_due_fallback' || bill.amount_source === 'parsed_total')
  ) {
    return 'need_current_charges';
  }
  if (
    isCalendarMonthPeriod(bill.period_start, bill.period_end) &&
    hasProviderOpenForService
  ) {
    return 'calendar_phantom_with_provider_open';
  }
  return null;
}

async function autoNotifyEligibleDrafts({ userId, role }) {
  if (!autoNotifyEnabled()) {
    return { notified: 0, skipped: 0, disabled: true };
  }

  // Inline to avoid circular require with uc03-notify-tenants ↔ utility-comms.
  const { executeNotifyTenants } = require('../use-cases/utilities/uc03-notify-tenants');
  const { accessiblePropertyIds } = require('../use-cases/utilities/access');

  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) return { notified: 0, skipped: 0 };

  const { rows: drafts } = await pool.query(
    `SELECT id, property_id, service_type, chargeable_after, period_start, period_end, status,
            amount_source, tenant_charge_amount, statement_balance, total_amount
       FROM utility_bills
      WHERE property_id = ANY($1)
        AND status = 'draft'`,
    [propIds]
  );

  // Preload open provider-period bills so calendar phantoms are not notified beside them
  const { rows: openProvider } = await pool.query(
    `SELECT property_id, service_type::text AS service_type, period_start, period_end
       FROM utility_bills
      WHERE property_id = ANY($1)
        AND status::text IN ('draft', 'notified', 'charging')`,
    [propIds]
  );
  const hasProviderOpen = (propertyId, serviceType) =>
    openProvider.some(
      (b) =>
        b.property_id === propertyId &&
        b.service_type === serviceType &&
        !isCalendarMonthPeriod(b.period_start, b.period_end)
    );

  let notified = 0;
  let skipped = 0;
  for (const bill of drafts) {
    const hold = draftAutoNotifyHoldReason(bill, {
      hasProviderOpenForService: hasProviderOpen(bill.property_id, bill.service_type),
    });
    if (hold === 'need_current_charges') {
      console.warn(
        `[utility-comms] hold notify ${bill.id}: amount_source=${bill.amount_source} (need Current Charges)`
      );
      skipped += 1;
      continue;
    }
    if (hold === 'calendar_phantom_with_provider_open') {
      console.warn(
        `[utility-comms] hold notify ${bill.id}: calendar-month phantom while provider-period bill is open`
      );
      skipped += 1;
      continue;
    }
    if (hold) {
      skipped += 1;
      continue;
    }
    try {
      await executeNotifyTenants({ userId, role, billId: bill.id });
      notified += 1;
    } catch (err) {
      if (err.code === 'INVALID_STATE' || err.code === 'BILLING_PERIOD_OPEN') {
        skipped += 1;
      } else {
        console.warn(`[utility-comms] notify ${bill.id}:`, err.message);
        skipped += 1;
      }
    }
  }

  return { notified, skipped };
}

module.exports = {
  sendUtilityBillNotifyEmails,
  alertStaffNewUtilityBill,
  alertStaffUtilityDispute,
  sendUtilityReminders,
  autoNotifyEligibleDrafts,
  autoNotifyEnabled,
  draftAutoNotifyHoldReason,
  REVIEW_URL,
};
