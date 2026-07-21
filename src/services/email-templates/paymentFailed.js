const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, paymentType = 'rent', failureReason }) {
  const amountStr = formatMoney(amount);
  const isUtility = paymentType === 'utility';
  const label = isUtility ? 'utility' : 'rent';
  const reason = failureReason || 'The bank returned the ACH debit.';
  const text = [
    `Hi ${tenantName},`,
    '',
    `Your ${label} payment of ${amountStr} could not be processed.`,
    `Reason: ${reason}`,
    '',
    `Please update your bank account or try again: ${BRAND.paymentsUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: `${label.charAt(0).toUpperCase() + label.slice(1)} payment failed`,
    preheader: `Payment failed — ${amountStr}`,
    accent: PALETTE.danger,
    accentBg: PALETTE.dangerBg,
    heroEmoji: '✕',
    heroLabel: 'Payment failed',
    ctaUrl: BRAND.paymentsUrl,
    ctaLabel: 'Update bank & retry',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([`Your ${escapeHtml(label)} payment of <strong>${escapeHtml(amountStr)}</strong> could not be processed.`]),
      detailTable([
        ['Amount', amountStr],
        ['Reason', reason],
      ]),
      paragraph(['Please update your linked bank account or try again from the portal.']),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
