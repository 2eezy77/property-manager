const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, tenantEmail, title, unitNumber, propertyName, priority, isEmergency }) {
  const text = [
    `New maintenance request from ${tenantName} (${tenantEmail}).`,
    `Property: ${propertyName}, Unit ${unitNumber}`,
    `Title: ${title}`,
    `Priority: ${priority || 'medium'}`,
    '',
    `Open queue: ${BRAND.managerMaintenanceUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: isEmergency ? 'EMERGENCY maintenance' : 'New maintenance request',
    preheader: `${isEmergency ? 'EMERGENCY — ' : ''}${title}`,
    accent: isEmergency ? PALETTE.danger : PALETTE.staff,
    accentBg: isEmergency ? PALETTE.dangerBg : PALETTE.staffBg,
    heroEmoji: isEmergency ? '🚨' : '🔧',
    heroLabel: isEmergency ? 'Emergency' : 'New request',
    ctaUrl: BRAND.managerMaintenanceUrl,
    ctaLabel: 'Open maintenance queue',
    bodyHtml: [
      paragraph([`New request from <strong>${escapeHtml(tenantName)}</strong> (${escapeHtml(tenantEmail)}).`]),
      detailTable([
        ['Title', title],
        ['Priority', priority || 'medium'],
        ['Property', propertyName],
        ['Unit', `Unit ${unitNumber}`],
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
