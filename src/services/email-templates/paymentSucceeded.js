const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, paymentType = 'rent', unitLabel, propertyName }) {
  const amountStr = formatMoney(amount);
  const isUtility = paymentType === 'utility';
  const label = isUtility ? 'Utility' : 'Rent';
  const text = [
    `Hi ${tenantName},`,
    '',
    isUtility
      ? `Your utility share payment of ${amountStr} has been confirmed.`
      : `Your rent payment of ${amountStr} for ${unitLabel} at ${propertyName} has been confirmed.`,
    '',
    `View your payment history: ${BRAND.paymentsUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: `${label} payment confirmed`,
    preheader: `${label} payment ${amountStr} confirmed`,
    accent: PALETTE.success,
    accentBg: PALETTE.successBg,
    heroEmoji: '✓',
    heroLabel: 'Payment confirmed',
    ctaUrl: BRAND.paymentsUrl,
    ctaLabel: 'View payment history',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        isUtility
          ? `Your utility share payment of <strong>${escapeHtml(amountStr)}</strong> has been confirmed.`
          : `Your rent payment of <strong>${escapeHtml(amountStr)}</strong> for ${escapeHtml(unitLabel)} at ${escapeHtml(propertyName)} has been confirmed.`,
      ]),
      detailTable(
        isUtility
          ? [['Amount', amountStr], ['Type', 'Utility share']]
          : [
              ['Amount', amountStr],
              ['Unit', unitLabel],
              ['Property', propertyName],
            ]
      ),
      paragraph(['Thank you — your payment has been recorded.']),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
