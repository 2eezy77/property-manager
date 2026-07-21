/**
 * Payment-related email notifications (rent due, received, failed).
 */

const pool = require('../db/client');
const { sendEmail, resolveOrgIdForLease, getOperationalStaff, sendOperationalStaffEmail } = require('./email.service');
const templates = require('./email-templates');

function formatMoney(amount) {
  return `$${parseFloat(amount).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'this month';
  const raw = dateStr instanceof Date ? dateStr.toISOString().slice(0, 10) : String(dateStr).slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function getLeaseContext(db, leaseId) {
  const { rows } = await db.query(
    `SELECT l.id, l.monthly_rent, l.grace_period_days,
            u.email AS tenant_email,
            COALESCE(u.first_name, '') AS tenant_first,
            COALESCE(u.last_name, '') AS tenant_last,
            un.unit_number,
            p.name AS property_name,
            p.org_id
       FROM leases l
       JOIN users u ON u.id = l.tenant_id
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE l.id = $1`,
    [leaseId]
  );
  return rows[0] || null;
}

async function getTenantContext(db, tenantId, leaseId) {
  if (leaseId) {
    const ctx = await getLeaseContext(db, leaseId);
    if (ctx) return ctx;
  }
  const { rows } = await db.query(
    `SELECT u.email AS tenant_email,
            COALESCE(u.first_name, '') AS tenant_first,
            COALESCE(u.last_name, '') AS tenant_last,
            u.org_id
       FROM users u
      WHERE u.id = $1`,
    [tenantId]
  );
  return rows[0] || null;
}

function tenantName(ctx) {
  const name = [ctx?.tenant_first, ctx?.tenant_last].filter(Boolean).join(' ').trim();
  return name || 'Tenant';
}

async function recordEmailNotification(db, { userId, type, title, body, relatedEntityType, relatedEntityId, externalId }) {
  await db.query(
    `INSERT INTO notifications
       (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at, external_id)
     VALUES ($1, $2, $3, $4, 'email', $5, $6, NOW(), $7)`,
    [userId, type, title, body, relatedEntityType || null, relatedEntityId || null, externalId || null]
  );
}

async function alreadyEmailed(db, { userId, type, relatedEntityId }) {
  const { rows } = await db.query(
    `SELECT 1 FROM notifications
      WHERE user_id = $1 AND type = $2 AND channel = 'email'
        AND related_entity_id = $3
      LIMIT 1`,
    [userId, type, relatedEntityId]
  );
  return rows.length > 0;
}

async function notifyStaff(db, { orgId, subject, text, html, type, relatedEntityId }) {
  const { all: staff } = await getOperationalStaff(db, orgId);
  if (!staff.length) return { sent: false, skipped: 'no_staff' };

  const result = await sendOperationalStaffEmail(db, { orgId, subject, text, html });

  if (result.sent) {
    for (const person of staff) {
      await recordEmailNotification(db, {
        userId: person.id,
        type,
        title: subject,
        body: text,
        relatedEntityType: 'payment',
        relatedEntityId,
        externalId: result.id,
      });
    }
  }

  return result;
}

async function notifyPaymentReceived({ paymentId, tenantId, leaseId, amount, paymentType = 'rent' }) {
  const db = pool;
  const orgId = leaseId ? await resolveOrgIdForLease(db, leaseId) : null;
  const ctx = await getTenantContext(db, tenantId, leaseId);
  const effectiveOrgId = orgId || ctx?.org_id;
  if (!effectiveOrgId) return { sent: false, skipped: 'no_org' };

  const unitLabel = ctx?.unit_number ? `Unit ${ctx.unit_number}` : 'your unit';
  const propertyLabel = ctx?.property_name || '743 A Ave';
  const amountStr = formatMoney(amount);
  const tenant = tenantName(ctx);

  const subject = paymentType === 'utility'
    ? `Utility payment confirmed - ${amountStr}`
    : `Rent payment confirmed - ${amountStr}`;

  const { html, text } = templates.paymentSucceeded.render({
    tenantName: tenant,
    amount,
    paymentType,
    unitLabel,
    propertyName: propertyLabel,
  });

  if (!(await alreadyEmailed(db, { userId: tenantId, type: 'payment_received', relatedEntityId: paymentId }))) {
    const tenantResult = await sendEmail({
      orgId: effectiveOrgId,
      to: ctx?.tenant_email,
      subject,
      text,
      html,
    });
    if (tenantResult.sent) {
      await recordEmailNotification(db, {
        userId: tenantId,
        type: 'payment_received',
        title: subject,
        body: text,
        relatedEntityType: 'payment',
        relatedEntityId: paymentId,
        externalId: tenantResult.id,
      });
    }
  }

  const staffSubject = `${tenant} - ${paymentType === 'utility' ? 'utility' : 'rent'} payment received (${amountStr})`;
  const staffRendered = templates.paymentSucceededStaff.render({
    tenantName: tenant,
    tenantEmail: ctx?.tenant_email,
    amount,
    paymentType,
    propertyName: propertyLabel,
    unitLabel,
  });

  await notifyStaff(db, {
    orgId: effectiveOrgId,
    subject: staffSubject,
    text: staffRendered.text,
    html: staffRendered.html,
    type: 'payment_received_staff',
    relatedEntityId: paymentId,
  });

  return { sent: true };
}

async function notifyPaymentFailed({ paymentId, tenantId, leaseId, amount, paymentType = 'rent', failureReason }) {
  const db = pool;
  const orgId = leaseId ? await resolveOrgIdForLease(db, leaseId) : null;
  const ctx = await getTenantContext(db, tenantId, leaseId);
  const effectiveOrgId = orgId || ctx?.org_id;
  if (!effectiveOrgId) return { sent: false, skipped: 'no_org' };

  const amountStr = formatMoney(amount);
  const tenant = tenantName(ctx);
  const reason = failureReason || 'The bank returned the ACH debit.';

  const subject = `${paymentType === 'utility' ? 'Utility' : 'Rent'} payment failed - ${amountStr}`;
  const { html, text } = templates.paymentFailed.render({
    tenantName: tenant,
    amount,
    paymentType,
    failureReason: reason,
  });

  if (!(await alreadyEmailed(db, { userId: tenantId, type: 'payment_failed', relatedEntityId: paymentId }))) {
    const tenantResult = await sendEmail({
      orgId: effectiveOrgId,
      to: ctx?.tenant_email,
      subject,
      text,
      html,
    });
    if (tenantResult.sent) {
      await recordEmailNotification(db, {
        userId: tenantId,
        type: 'payment_failed',
        title: subject,
        body: text,
        relatedEntityType: 'payment',
        relatedEntityId: paymentId,
        externalId: tenantResult.id,
      });
    }
  }

  const staffRendered = templates.paymentFailedStaff.render({
    tenantName: tenant,
    amount,
    paymentType,
    failureReason: reason,
  });

  await notifyStaff(db, {
    orgId: effectiveOrgId,
    subject: `Payment failed - ${tenant} (${amountStr})`,
    text: staffRendered.text,
    html: staffRendered.html,
    type: 'payment_failed_staff',
    relatedEntityId: paymentId,
  });

  return { sent: true };
}

async function notifyRentDue({ paymentId, tenantId, leaseId, amount, dueDate }) {
  const db = pool;
  const ctx = await getLeaseContext(db, leaseId);
  if (!ctx) return { sent: false, skipped: 'no_lease' };

  if (await alreadyEmailed(db, { userId: tenantId, type: 'rent_due', relatedEntityId: paymentId })) {
    return { sent: false, skipped: 'already_sent' };
  }

  const tenant = tenantName(ctx);
  const amountStr = formatMoney(amount);
  const dueStr = formatDate(dueDate);
  const unitLabel = ctx.unit_number ? `Unit ${ctx.unit_number}` : 'your unit';

  const subject = `Rent due ${dueStr} - ${amountStr}`;
  const { html, text } = templates.rentDue.render({
    tenantName: tenant,
    amount,
    unitLabel,
    propertyName: ctx.property_name || '743 A Ave',
    dueDate,
  });

  const result = await sendEmail({
    orgId: ctx.org_id,
    to: ctx.tenant_email,
    subject,
    text,
    html,
  });

  if (result.sent) {
    await recordEmailNotification(db, {
      userId: tenantId,
      type: 'rent_due',
      title: subject,
      body: text,
      relatedEntityType: 'payment',
      relatedEntityId: paymentId,
      externalId: result.id,
    });
  }

  return result;
}

async function notifyRentOverdue({ paymentId, tenantId, leaseId, amount, dueDate, gracePeriodDays }) {
  const db = pool;
  const ctx = await getLeaseContext(db, leaseId);
  if (!ctx) return { sent: false, skipped: 'no_lease' };

  if (await alreadyEmailed(db, { userId: tenantId, type: 'rent_overdue', relatedEntityId: paymentId })) {
    return { sent: false, skipped: 'already_sent' };
  }

  const tenant = tenantName(ctx);
  const amountStr = formatMoney(amount);
  const grace = gracePeriodDays ?? ctx.grace_period_days ?? 5;

  const subject = `Overdue rent - ${amountStr} (late fees after ${grace}-day grace)`;
  const { html, text } = templates.rentOverdue.render({
    tenantName: tenant,
    amount,
    dueDate,
    gracePeriodDays: grace,
  });

  const result = await sendEmail({
    orgId: ctx.org_id,
    to: ctx.tenant_email,
    subject,
    text,
    html,
  });

  if (result.sent) {
    await recordEmailNotification(db, {
      userId: tenantId,
      type: 'rent_overdue',
      title: subject,
      body: text,
      relatedEntityType: 'payment',
      relatedEntityId: paymentId,
      externalId: result.id,
    });
  }

  return result;
}

async function sendRentDueReminders(db = pool) {
  const { rows: newInvoices } = await db.query(
    `SELECT p.id, p.tenant_id, p.lease_id, p.amount, p.due_date
       FROM payments p
      WHERE p.status = 'pending'
        AND p.payment_type = 'rent'
        AND p.due_date >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = p.tenant_id
             AND n.type = 'rent_due'
             AND n.channel = 'email'
             AND n.related_entity_id = p.id
        )`
  );

  let dueSent = 0;
  for (const row of newInvoices) {
    const r = await notifyRentDue({
      paymentId: row.id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      amount: row.amount,
      dueDate: row.due_date,
    });
    if (r.sent) dueSent++;
  }

  const { rows: overdue } = await db.query(
    `SELECT p.id, p.tenant_id, p.lease_id, p.amount, p.due_date, l.grace_period_days
       FROM payments p
       JOIN leases l ON l.id = p.lease_id
      WHERE p.status = 'pending'
        AND p.payment_type = 'rent'
        AND p.due_date < CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = p.tenant_id
             AND n.type = 'rent_overdue'
             AND n.channel = 'email'
             AND n.related_entity_id = p.id
        )`
  );

  let overdueSent = 0;
  for (const row of overdue) {
    const r = await notifyRentOverdue({
      paymentId: row.id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      amount: row.amount,
      dueDate: row.due_date,
      gracePeriodDays: row.grace_period_days,
    });
    if (r.sent) overdueSent++;
  }

  return { dueSent, overdueSent };
}

async function notifyLateFeeApplied({ lateFeeId, tenantId, leaseId, amount, daysOverdue, paymentId }) {
  const db = pool;
  const ctx = await getLeaseContext(db, leaseId);
  if (!ctx) return { sent: false, skipped: 'no_lease' };

  const dedupeType = 'late_fee_applied';
  if (await alreadyEmailed(db, { userId: tenantId, type: dedupeType, relatedEntityId: lateFeeId })) {
    return { sent: false, skipped: 'already_sent' };
  }

  const tenant = tenantName(ctx);
  const amountStr = formatMoney(amount);
  const unitLabel = ctx.unit_number ? `Unit ${ctx.unit_number}` : 'your unit';
  const grace = ctx.grace_period_days ?? 5;

  const subject = `Late fee applied - ${amountStr}`;
  const { html, text } = templates.lateFeeApplied.render({
    tenantName: tenant,
    amount,
    unitLabel,
    propertyName: ctx.property_name || '743 A Ave',
    daysOverdue,
    gracePeriodDays: grace,
  });

  const result = await sendEmail({
    orgId: ctx.org_id,
    to: ctx.tenant_email,
    subject,
    text,
    html,
  });

  if (result.sent) {
    await recordEmailNotification(db, {
      userId: tenantId,
      type: dedupeType,
      title: subject,
      body: text,
      relatedEntityType: 'late_fee',
      relatedEntityId: lateFeeId,
      externalId: result.id,
    });
  }

  const staffRendered = templates.lateFeeAppliedStaff.render({
    tenantName: tenant,
    tenantEmail: ctx.tenant_email,
    amount,
    unitLabel,
    daysOverdue,
    paymentId,
  });

  await notifyStaff(db, {
    orgId: ctx.org_id,
    subject: `Late fee applied - ${tenant} (${amountStr})`,
    text: staffRendered.text,
    html: staffRendered.html,
    type: 'late_fee_applied_staff',
    relatedEntityId: lateFeeId,
  });

  return result;
}

async function sendLateFeeAppliedNotifications(fees = []) {
  let sent = 0;
  for (const row of fees) {
    const r = await notifyLateFeeApplied({
      lateFeeId: row.late_fee_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      amount: row.amount,
      daysOverdue: row.days_overdue,
      paymentId: row.payment_id,
    });
    if (r.sent) sent++;
  }
  return { sent };
}

module.exports = {
  notifyPaymentReceived,
  notifyPaymentFailed,
  notifyRentDue,
  notifyRentOverdue,
  sendRentDueReminders,
  notifyLateFeeApplied,
  sendLateFeeAppliedNotifications,
};
