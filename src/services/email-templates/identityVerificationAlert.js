const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function humanStatus(status) {
  return String(status || 'requires_input').replace(/_/g, ' ');
}

function redactSensitive(value) {
  if (!value) return value;
  return String(value).replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[redacted]');
}

function render({
  tenantName,
  tenantEmail,
  status,
  reason,
  unitLabel,
  propertyName,
}) {
  const statusLabel = humanStatus(status);
  const tenantLabel = tenantEmail ? `${tenantName} (${tenantEmail})` : tenantName;
  const safeReason = redactSensitive(reason) || 'Stripe Identity requires staff review or tenant follow-up.';
  const text = [
    `Identity verification ${statusLabel} for ${tenantLabel}.`,
    `Property: ${propertyName || BRAND.property}`,
    `Unit: ${unitLabel || 'assigned unit'}`,
    `Reason: ${safeReason}`,
    '',
    'No sensitive identity number is included in this alert.',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Identity verification alert',
    preheader: `Identity verification ${statusLabel} - ${tenantName}`,
    accent: PALETTE.warning,
    accentBg: PALETTE.warningBg,
    heroEmoji: '!',
    heroLabel: 'Staff alert',
    ctaUrl: BRAND.managerDashboardUrl,
    ctaLabel: 'Review tenant',
    bodyHtml: [
      paragraph([
        `<strong>${escapeHtml(tenantName)}</strong>'s identity verification is <strong>${escapeHtml(statusLabel)}</strong>.`,
        'Follow up with the tenant or review the Stripe Identity result before activating the lease.',
      ]),
      detailTable([
        ['Tenant', tenantLabel],
        ['Property', propertyName || BRAND.property],
        ['Unit', unitLabel || 'assigned unit'],
        ['Status', statusLabel],
        ['Reason', safeReason],
      ]),
      paragraph(['This alert intentionally excludes sensitive identity numbers.']),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
