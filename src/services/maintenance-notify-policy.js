/**
 * Pure subject + staff-notify gates for maintenance emails.
 * Keep in sync with maintenance-email.service.js.
 */

'use strict';

const STAFF_STATUS_NOTIFY = Object.freeze([
  'resolved',
  'cancelled',
  'assigned',
  'in_progress',
]);

function tenantDisplayName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Tenant';
}

function formatMoneyAmount(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function maintenanceCreatedSubjects({ title, priority } = {}) {
  const safeTitle = title || 'Maintenance request';
  const isEmergency = priority === 'emergency';
  return {
    tenantSubject: `Maintenance request received - ${safeTitle}`,
    staffSubject: `[Maintenance] ${isEmergency ? 'EMERGENCY - ' : ''}${safeTitle}`,
    isEmergency,
  };
}

function maintenanceStatusSubjects({ title, newStatus } = {}) {
  const safeTitle = title || 'Maintenance request';
  const statusLabel = String(newStatus || '').replace(/_/g, ' ');
  return {
    tenantSubject: `Maintenance update - ${safeTitle} (${statusLabel})`,
    staffSubject: `Maintenance ${statusLabel} - ${safeTitle}`,
    statusLabel,
  };
}

function shouldNotifyStaffOnStatus(newStatus) {
  return STAFF_STATUS_NOTIFY.includes(newStatus);
}

function maintenanceBillSubjects({ amount, title } = {}) {
  const amt = formatMoneyAmount(amount);
  const safeTitle = title || 'Maintenance';
  return {
    tenantSubject: `Charge for maintenance / damages - ${amt}`,
    staffSubject: `Maintenance charge recorded - ${amt} (${safeTitle})`,
    amountLabel: amt,
  };
}

module.exports = {
  STAFF_STATUS_NOTIFY,
  tenantDisplayName,
  formatMoneyAmount,
  maintenanceCreatedSubjects,
  maintenanceStatusSubjects,
  shouldNotifyStaffOnStatus,
  maintenanceBillSubjects,
};
