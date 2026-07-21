const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, paymentType = 'rent', failureReason }) {
  const amountStr = formatMoney(amount);
  const label = paymentType === 'utility' ? 'utility' : 'rent';
  const reason = failureReason || 'The bank returned the ACH debit.';
  const text = [
    `${tenantName}'s ${label} payment of ${amountStr} failed.`,
    `Reason: ${reason}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Payment failed (staff)',
    preheader: `Failed payment — ${tenantName}`,
    accent: PALETTE.danger,
    accentBg: PALETTE.dangerBg,
    heroEmoji: '⚡',
    heroLabel: 'Staff alert',
    ctaUrl: BRAND.paymentsUrl.replace('/tenant/', '/manager/'),
    ctaLabel: 'Review in portal',
    bodyHtml: [
      paragraph([`<strong>${escapeHtml(tenantName)}</strong>'s ${escapeHtml(label)} payment of <strong>${escapeHtml(amountStr)}</strong> failed.`]),
      detailTable([
        ['Tenant', tenantName],
        ['Amount', amountStr],
        ['Reason', reason],
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
