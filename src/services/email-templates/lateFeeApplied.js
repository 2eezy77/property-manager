const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, unitLabel, propertyName, daysOverdue, gracePeriodDays }) {
  const amountStr = formatMoney(amount);
  const grace = gracePeriodDays ?? 5;
  const text = [
    `Hi ${tenantName},`,
    '',
    `A late fee of ${amountStr} has been applied to your account.`,
    `Rent for ${unitLabel} at ${propertyName} was not received within the ${grace}-day grace period (${daysOverdue} days overdue).`,
    '',
    `Pay rent plus fees: ${BRAND.paymentsUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Late fee applied',
    preheader: `Late fee ${amountStr} applied to your account`,
    accent: PALETTE.danger,
    accentBg: PALETTE.dangerBg,
    heroEmoji: '⏱️',
    heroLabel: 'Late fee',
    ctaUrl: BRAND.paymentsUrl,
    ctaLabel: 'View balance & pay',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([`A late fee of <strong>${escapeHtml(amountStr)}</strong> has been applied to your account.`]),
      detailTable([
        ['Late fee', amountStr],
        ['Unit', unitLabel],
        ['Property', propertyName],
        ['Days overdue', String(daysOverdue)],
        ['Grace period', `${grace} days`],
      ]),
      paragraph(['This fee is documented in your lease and payment history.']),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
