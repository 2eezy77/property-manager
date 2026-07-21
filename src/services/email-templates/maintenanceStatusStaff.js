const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ title, propertyName, unitNumber, oldStatus, newStatus, note, statusLabel }) {
  const text = [
    `Maintenance "${title}" (${propertyName} / Unit ${unitNumber})`,
    `Status: ${oldStatus} → ${newStatus}`,
    note ? `Note: ${note}` : '',
    '',
    BRAND.name,
  ].filter(Boolean).join('\n');

  const rows = [
    ['Request', title],
    ['Property', propertyName],
    ['Unit', `Unit ${unitNumber}`],
    ['Status', `${oldStatus} → ${newStatus}`],
  ];
  if (note) rows.push(['Note', note]);

  const html = wrapEmail({
    title: `Maintenance ${statusLabel}`,
    preheader: `${title} — ${newStatus}`,
    accent: PALETTE.staff,
    accentBg: PALETTE.staffBg,
    heroEmoji: '🔄',
    heroLabel: 'Status change',
    ctaUrl: BRAND.managerMaintenanceUrl,
    ctaLabel: 'Open queue',
    bodyHtml: [
      paragraph([`Maintenance <strong>${escapeHtml(title)}</strong> was updated.`]),
      detailTable(rows),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
