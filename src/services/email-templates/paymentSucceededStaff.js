const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, tenantEmail, amount, paymentType = 'rent', propertyName, unitLabel }) {
  const amountStr = formatMoney(amount);
  const label = paymentType === 'utility' ? 'utility' : 'rent';
  const text = [
    `${tenantName} (${tenantEmail || 'tenant'}) paid ${amountStr} for ${label}.`,
    propertyName,
    unitLabel,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Payment received (staff)',
    preheader: `${tenantName} paid ${amountStr}`,
    accent: PALETTE.staff,
    accentBg: PALETTE.staffBg,
    heroEmoji: '💳',
    heroLabel: 'Payment received',
    ctaUrl: BRAND.paymentsUrl.replace('/tenant/', '/manager/'),
    ctaLabel: 'Manager portal',
    bodyHtml: [
      paragraph([
        `<strong>${escapeHtml(tenantName)}</strong> (${escapeHtml(tenantEmail || 'tenant')}) paid <strong>${escapeHtml(amountStr)}</strong> for ${escapeHtml(label)}.`,
      ]),
      detailTable([
        ['Amount', amountStr],
        ['Property', propertyName],
        ['Unit', unitLabel],
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
