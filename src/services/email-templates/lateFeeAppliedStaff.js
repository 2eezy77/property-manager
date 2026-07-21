const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, tenantEmail, amount, unitLabel, daysOverdue, paymentId }) {
  const amountStr = formatMoney(amount);
  const text = [
    `Late fee ${amountStr} applied for ${tenantName} (${tenantEmail}).`,
    `${unitLabel}, ${daysOverdue} days past due.`,
    `Payment invoice: ${paymentId}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Late fee applied (staff)',
    preheader: `Late fee ${amountStr} — ${tenantName}`,
    accent: PALETTE.staff,
    accentBg: PALETTE.staffBg,
    heroEmoji: '📋',
    heroLabel: 'Staff alert',
    ctaUrl: BRAND.paymentsUrl.replace('/tenant/', '/manager/'),
    ctaLabel: 'Open manager portal',
    bodyHtml: [
      paragraph([`Late fee <strong>${escapeHtml(amountStr)}</strong> applied for <strong>${escapeHtml(tenantName)}</strong>.`]),
      detailTable([
        ['Tenant', tenantName],
        ['Email', tenantEmail || '—'],
        ['Unit', unitLabel],
        ['Days past due', String(daysOverdue)],
        ['Invoice', String(paymentId || '—')],
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
