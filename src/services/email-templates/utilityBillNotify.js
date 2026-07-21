const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, formatDate, paragraph, detailTable } = require('./utils');

/** UC03-style utility split notification (in_app today; template ready for email channel). */
function render({ tenantName, amount, serviceType, periodStart, periodEnd, disputeHours = 48 }) {
  const amountStr = formatMoney(amount);
  const period = `${formatDate(periodStart)} – ${formatDate(periodEnd)}`;
  const text = [
    `Hi ${tenantName},`,
    '',
    `Your share of the ${serviceType} bill is ${amountStr} for ${period}.`,
    `You have ${disputeHours} hours to dispute if anything looks wrong.`,
    '',
    `Review: ${BRAND.utilitiesUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Utility bill — your share',
    preheader: `${serviceType} share ${amountStr}`,
    accent: '#0d9488',
    accentBg: '#f0fdfa',
    heroEmoji: '💡',
    heroLabel: 'Utility bill',
    ctaUrl: BRAND.utilitiesUrl,
    ctaLabel: 'Review & pay share',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([`Your share of the <strong>${escapeHtml(serviceType)}</strong> bill is ready.`]),
      detailTable([
        ['Your share', amountStr],
        ['Service', serviceType],
        ['Billing period', period],
        ['Dispute window', `${disputeHours} hours`],
      ]),
      paragraph([`If anything looks wrong, dispute within <strong>${disputeHours} hours</strong> from the portal.`]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
