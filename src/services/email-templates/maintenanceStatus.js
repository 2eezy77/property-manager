const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, title, statusLabel, scheduledAt, note }) {
  const scheduledLine =
    scheduledAt && statusLabel !== 'resolved'
      ? `Scheduled: ${new Date(scheduledAt).toLocaleDateString('en-US')}`
      : null;
  const text = [
    `Hi ${tenantName},`,
    '',
    `Your maintenance request "${title}" is now: ${statusLabel}.`,
    scheduledLine,
    note ? `Note from property manager: ${note}` : '',
    '',
    `View details: ${BRAND.maintenanceUrl}`,
    '',
    BRAND.name,
  ].filter(Boolean).join('\n');

  const rows = [['Request', title], ['Status', statusLabel]];
  if (scheduledLine) rows.push(['Scheduled', scheduledLine.replace('Scheduled: ', '')]);
  if (note) rows.push(['Note', note]);

  const html = wrapEmail({
    title: 'Maintenance update',
    preheader: `${title} — ${statusLabel}`,
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '📬',
    heroLabel: 'Status update',
    ctaUrl: BRAND.maintenanceUrl,
    ctaLabel: 'View details',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([`Your maintenance request <strong>${escapeHtml(title)}</strong> has been updated.`]),
      detailTable(rows),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
