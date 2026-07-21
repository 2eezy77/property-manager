const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, formatDate, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, unitLabel, propertyName, dueDate }) {
  const amountStr = formatMoney(amount);
  const dueStr = formatDate(dueDate);
  const text = [
    `Hi ${tenantName},`,
    '',
    `Rent of ${amountStr} for ${unitLabel} at ${propertyName} is due on ${dueStr}.`,
    '',
    `Pay online: ${BRAND.paymentsUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: `Rent due ${dueStr}`,
    preheader: `Rent of ${amountStr} is due ${dueStr}`,
    accent: PALETTE.info,
    accentBg: PALETTE.infoBg,
    heroEmoji: '📅',
    heroLabel: 'Rent reminder',
    ctaUrl: BRAND.paymentsUrl,
    ctaLabel: 'Pay rent online',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([`Rent of <strong>${escapeHtml(amountStr)}</strong> for ${escapeHtml(unitLabel)} at ${escapeHtml(propertyName)} is due on <strong>${escapeHtml(dueStr)}</strong>.`]),
      detailTable([
        ['Amount', amountStr],
        ['Due date', dueStr],
        ['Unit', unitLabel],
        ['Property', propertyName],
      ]),
      paragraph(['Pay through the portal to avoid late fees after your grace period.']),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
