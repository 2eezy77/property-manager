const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, title, unitNumber, propertyName, priority }) {
  const text = [
    `Hi ${tenantName},`,
    '',
    `We received your maintenance request for Unit ${unitNumber} at ${propertyName}.`,
    `Title: ${title}`,
    priority ? `Priority: ${priority}` : '',
    '',
    `Track status: ${BRAND.maintenanceUrl}`,
    '',
    BRAND.name,
  ].filter(Boolean).join('\n');

  const html = wrapEmail({
    title: 'Maintenance request received',
    preheader: `Request received — ${title}`,
    accent: PALETTE.info,
    accentBg: PALETTE.infoBg,
    heroEmoji: '🔧',
    heroLabel: 'Request received',
    ctaUrl: BRAND.maintenanceUrl,
    ctaLabel: 'Track your request',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `We received your maintenance request for <strong>Unit ${escapeHtml(unitNumber)}</strong> at ${escapeHtml(propertyName)}.`,
      ]),
      detailTable([
        ['Title', title],
        ['Priority', priority || 'medium'],
        ['Unit', `Unit ${unitNumber}`],
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
