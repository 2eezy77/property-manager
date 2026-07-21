const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, title }) {
  const amt = formatMoney(amount);
  const text = [`${amt} billed to ${tenantName} for request "${title}".`, '', BRAND.name].join('\n');

  const html = wrapEmail({
    title: 'Maintenance charge (staff)',
    preheader: `${amt} — ${title}`,
    accent: PALETTE.staff,
    accentBg: PALETTE.staffBg,
    heroEmoji: '📝',
    heroLabel: 'Charge recorded',
    ctaUrl: BRAND.managerMaintenanceUrl,
    ctaLabel: 'View maintenance',
    bodyHtml: [
      paragraph([`<strong>${escapeHtml(amt)}</strong> billed to <strong>${escapeHtml(tenantName)}</strong> for request <strong>${escapeHtml(title)}</strong>.`]),
      detailTable([
        ['Amount', amt],
        ['Tenant', tenantName],
        ['Request', title],
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
