/**
 * Maintenance request email notifications - sent to users.email (login).
 */
const pool = require('../db/client');
const { sendEmail, getOperationalStaff, sendOperationalStaffEmail } = require('./email.service');
const templates = require('./email-templates');

async function getRequestContext(requestId) {
  const { rows } = await pool.query(
    `SELECT mr.id, mr.title, mr.description, mr.status, mr.priority, mr.category,
            mr.scheduled_at, mr.actual_cost, mr.estimated_cost,
            ten.id AS tenant_id, ten.email AS tenant_email,
            ten.first_name AS tenant_first, ten.last_name AS tenant_last,
            un.unit_number, p.name AS property_name, p.org_id
       FROM maintenance_requests mr
       JOIN users ten ON ten.id = mr.tenant_id
       JOIN units un ON un.id = mr.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE mr.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function notifyStaffMaintenance(db, { orgId, subject, text, html, type, requestId }) {
  const { all: staff } = await getOperationalStaff(db, orgId);
  if (!staff.length) return { sent: false };
  const result = await sendOperationalStaffEmail(db, {
    orgId,
    subject,
    text,
    html,
  });
  if (result.sent) {
    for (const person of staff) {
      await db.query(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, related_entity_type, related_entity_id, sent_at, external_id)
         VALUES ($1, $2, $3, $4, 'email', 'maintenance_request', $5, NOW(), $6)`,
        [person.id, type, subject, text, requestId, result.id || null]
      );
    }
  }
  return result;
}

async function notifyMaintenanceCreated(requestId) {
  const ctx = await getRequestContext(requestId);
  if (!ctx) return { sent: false };

  const tenantName = [ctx.tenant_first, ctx.tenant_last].filter(Boolean).join(' ') || 'Tenant';
  const subject = `Maintenance request received - ${ctx.title}`;
  const { html, text } = templates.maintenanceCreated.render({
    tenantName,
    title: ctx.title,
    unitNumber: ctx.unit_number,
    propertyName: ctx.property_name,
    priority: ctx.priority,
  });

  await sendEmail({
    orgId: ctx.org_id,
    to: ctx.tenant_email,
    subject,
    text,
    html,
  });

  const isEmergency = ctx.priority === 'emergency';
  const staffSubject = `[Maintenance] ${isEmergency ? 'EMERGENCY - ' : ''}${ctx.title}`;
  const staffRendered = templates.maintenanceCreatedStaff.render({
    tenantName,
    tenantEmail: ctx.tenant_email,
    title: ctx.title,
    unitNumber: ctx.unit_number,
    propertyName: ctx.property_name,
    priority: ctx.priority,
    isEmergency,
  });

  await notifyStaffMaintenance(pool, {
    orgId: ctx.org_id,
    subject: staffSubject,
    text: staffRendered.text,
    html: staffRendered.html,
    type: 'maintenance_created_staff',
    requestId,
  });

  return { sent: true };
}

async function notifyMaintenanceStatusChange(requestId, { oldStatus, newStatus, note }) {
  const ctx = await getRequestContext(requestId);
  if (!ctx) return { sent: false };

  const tenantName = [ctx.tenant_first, ctx.tenant_last].filter(Boolean).join(' ') || 'Tenant';
  const statusLabel = newStatus.replace(/_/g, ' ');
  const subject = `Maintenance update - ${ctx.title} (${statusLabel})`;
  const { html, text } = templates.maintenanceStatus.render({
    tenantName,
    title: ctx.title,
    statusLabel,
    scheduledAt: ctx.scheduled_at,
    note,
  });

  await sendEmail({
    orgId: ctx.org_id,
    to: ctx.tenant_email,
    subject,
    text,
    html,
  });

  if (['resolved', 'cancelled', 'assigned', 'in_progress'].includes(newStatus)) {
    const staffRendered = templates.maintenanceStatusStaff.render({
      title: ctx.title,
      propertyName: ctx.property_name,
      unitNumber: ctx.unit_number,
      oldStatus,
      newStatus,
      note,
      statusLabel,
    });
    await notifyStaffMaintenance(pool, {
      orgId: ctx.org_id,
      subject: `Maintenance ${statusLabel} - ${ctx.title}`,
      text: staffRendered.text,
      html: staffRendered.html,
      type: 'maintenance_status_staff',
      requestId,
    });
  }

  return { sent: true };
}

async function notifyMaintenanceBill(requestId, { amount, paymentId }) {
  const ctx = await getRequestContext(requestId);
  if (!ctx) return { sent: false };

  const tenantName = [ctx.tenant_first, ctx.tenant_last].filter(Boolean).join(' ') || 'Tenant';
  const amt = `$${Number(amount).toFixed(2)}`;
  const subject = `Charge for maintenance / damages - ${amt}`;
  const { html, text } = templates.maintenanceBill.render({
    tenantName,
    amount,
    title: ctx.title,
    unitNumber: ctx.unit_number,
    propertyName: ctx.property_name,
    paymentId,
  });

  await sendEmail({
    orgId: ctx.org_id,
    to: ctx.tenant_email,
    subject,
    text,
    html,
  });

  const staffRendered = templates.maintenanceBillStaff.render({
    tenantName,
    amount,
    title: ctx.title,
  });

  await notifyStaffMaintenance(pool, {
    orgId: ctx.org_id,
    subject: `Maintenance charge recorded - ${amt} (${ctx.title})`,
    text: staffRendered.text,
    html: staffRendered.html,
    type: 'maintenance_bill_staff',
    requestId,
  });

  return { sent: true };
}

module.exports = {
  notifyMaintenanceCreated,
  notifyMaintenanceStatusChange,
  notifyMaintenanceBill,
};
