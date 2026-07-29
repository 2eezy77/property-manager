/**
 * Utility bill tenant emails + staff ops alerts (notify / remind / dispute).
 * Workers never ACH — bill and remind only.
 */
const pool = require('../db/client');
const { sendEmail, sendOperationalStaffEmail, getOperationalStaff } = require('./email.service');
const templates = require('./email-templates');
const { BRAND } = require('./email-templates/brand');

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
 * Email + in-app for each split on a newly notified bill.
 * related_entity_id = split id for reminder dedupe later.
 */
async function sendUtilityBillNotifyEmails(billId) {
  const { rows: splits } = await pool.query(
    `SELECT s.id AS split_id, s.tenant_id, s.amount,
            ub.id AS bill_id, ub.service_type, ub.period_start, ub.period_end, ub.org_id,
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

  let emailed = 0;
  for (const s of splits) {
    if (await alreadyNotified(pool, {
      userId: s.tenant_id,
      type: 'utility_bill',
      relatedEntityId: s.split_id,
      channel: 'email',
    })) {
      continue;
    }

    const tenantName = tenantDisplayName(s);
    const { html, text } = templates.utilityBillNotify.render({
      tenantName,
      amount: s.amount,
      serviceType: s.service_type,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      disputeHours: 48,
    });
    // Prefer tenant utilities page in CTA (template uses BRAND.utilitiesUrl)
    const subject = `Utility bill — your ${s.service_type} share`;
    const orgId = s.org_id || s.property_org_id;

    const result = await sendEmail({
      orgId,
      to: s.email,
      subject,
      text: text.replace(BRAND.utilitiesUrl, REVIEW_URL),
      html: html.replaceAll(String(BRAND.utilitiesUrl), REVIEW_URL),
    });

    await recordNotification(pool, {
      userId: s.tenant_id,
      type: 'utility_bill',
      title: subject,
      body: text,
      channel: result.sent ? 'email' : 'in_app',
      relatedEntityType: 'utility_bill_split',
      relatedEntityId: s.split_id,
      externalId: result.id,
    });

    if (result.sent) emailed += 1;
  }

  return { emailed, tenants: splits.length };
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

    if (relatedEntityId && await alreadyNotified(pool, {
      userId: staff[0].id,
      type,
      relatedEntityId,
    })) {
      return { sent: false, skipped: 'already_sent' };
    }

    const result = await sendOperationalStaffEmail(pool, { orgId, subject, text });
    if (result.sent) {
      for (const person of staff) {
        await recordNotification(pool, {
          userId: person.id,
          type,
          title: subject,
          body: text,
          channel: 'email',
          relatedEntityType,
          relatedEntityId,
          externalId: result.id,
        });
      }
    }
    return result;
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
 * Day-3 and day-7 unpaid reminders. Never charges.
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
    const tenantName = tenantDisplayName(s);
    const amountStr = `$${Number(s.amount).toFixed(2)}`;
    const period = `${s.period_start} – ${s.period_end}`;

    if (ageMs >= day7) {
      if (!(await alreadyNotified(pool, {
        userId: s.tenant_id,
        type: 'utility_reminder_7d',
        relatedEntityId: s.split_id,
      }))) {
        const subject = `Reminder: ${s.service_type} share still unpaid (${amountStr})`;
        const text = [
          `Hi ${tenantName},`,
          '',
          `Your ${s.service_type} share of ${amountStr} for ${period} is still open.`,
          `Please pay in the portal when you can: ${REVIEW_URL}`,
          '',
          '— Montero Rentals',
        ].join('\n');
        const result = await sendEmail({
          orgId: s.org_id,
          to: s.email,
          subject,
          text,
        });
        await recordNotification(pool, {
          userId: s.tenant_id,
          type: 'utility_reminder_7d',
          title: subject,
          body: text,
          channel: result.sent ? 'email' : 'in_app',
          relatedEntityType: 'utility_bill_split',
          relatedEntityId: s.split_id,
          externalId: result.id,
        });
        reminded7 += 1;
        overdueForStaff.push(s);
      }
    } else if (ageMs >= day3) {
      if (!(await alreadyNotified(pool, {
        userId: s.tenant_id,
        type: 'utility_reminder_3d',
        relatedEntityId: s.split_id,
      }))) {
        const subject = `Reminder: ${s.service_type} share due (${amountStr})`;
        const text = [
          `Hi ${tenantName},`,
          '',
          `Friendly reminder — your ${s.service_type} share is ${amountStr} for ${period}.`,
          `Review and pay: ${REVIEW_URL}`,
          '',
          '— Montero Rentals',
        ].join('\n');
        const result = await sendEmail({
          orgId: s.org_id,
          to: s.email,
          subject,
          text,
        });
        await recordNotification(pool, {
          userId: s.tenant_id,
          type: 'utility_reminder_3d',
          title: subject,
          body: text,
          channel: result.sent ? 'email' : 'in_app',
          relatedEntityType: 'utility_bill_split',
          relatedEntityId: s.split_id,
          externalId: result.id,
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
 */
async function autoNotifyEligibleDrafts({ userId, role }) {
  const { isElectricBillChargeable } = require('./dominion-billing.service');
  const { executeNotifyTenants } = require('../use-cases/utilities/uc03-notify-tenants');
  const { accessiblePropertyIds } = require('../use-cases/utilities/access');

  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) return { notified: 0, skipped: 0 };

  const { rows: drafts } = await pool.query(
    `SELECT id, service_type, chargeable_after, period_end, status
       FROM utility_bills
      WHERE property_id = ANY($1)
        AND status = 'draft'`,
    [propIds]
  );

  let notified = 0;
  let skipped = 0;
  for (const bill of drafts) {
    if (bill.service_type === 'electric' && !isElectricBillChargeable(bill)) {
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
  REVIEW_URL,
};
