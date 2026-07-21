/**
 * Montero Rentals — shared email brand tokens (inline CSS values).
 */

/** Prefer CLIENT_ORIGIN, but never put localhost links in outbound email. */
function resolvePortalOrigin() {
  const raw = process.env.CLIENT_ORIGIN || 'https://www.monterorentals.com';
  if (/localhost|127\.0\.0\.1/i.test(raw)) {
    return 'https://www.monterorentals.com';
  }
  return String(raw).replace(/\/$/, '');
}

const PORTAL_ORIGIN = resolvePortalOrigin();

const BRAND = {
  name: 'Montero Rentals',
  property: '743 A Ave',
  location: 'Norfolk, VA',
  portalUrl: PORTAL_ORIGIN,
  adminUrl: `${PORTAL_ORIGIN}/admin`,
  tenantDashboardUrl: `${PORTAL_ORIGIN}/tenant`,
  paymentsUrl: `${PORTAL_ORIGIN}/tenant/payments`,
  maintenanceUrl: `${PORTAL_ORIGIN}/tenant/maintenance`,
  managerDashboardUrl: `${PORTAL_ORIGIN}/manager`,
  managerPaymentsUrl: `${PORTAL_ORIGIN}/manager/payments`,
  managerUtilitiesUrl: `${PORTAL_ORIGIN}/manager/utilities`,
  managerPlaybookUrl: `${PORTAL_ORIGIN}/manager/playbook`,
  managerMaintenanceUrl: `${PORTAL_ORIGIN}/manager/maintenance`,
  utilitiesUrl: `${PORTAL_ORIGIN}/tenant/payments`,
  messagesUrl: `${PORTAL_ORIGIN}/manager/messages`,
  supportLine: 'Property management portal',
};

const PALETTE = {
  ink: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  card: '#ffffff',
  shell: '#f1f5f9',
  headerFrom: '#312e81',
  headerTo: '#1e293b',
  accentDefault: '#4f46e5',
  success: '#059669',
  successBg: '#ecfdf5',
  warning: '#d97706',
  warningBg: '#fffbeb',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  info: '#2563eb',
  infoBg: '#eff6ff',
  staff: '#7c3aed',
  staffBg: '#f5f3ff',
};

module.exports = { BRAND, PALETTE, PORTAL_ORIGIN };
