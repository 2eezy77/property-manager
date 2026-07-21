const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, formatDate, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, dueDate, gracePeriodDays }) {
  const amountStr = formatMoney(amount);
  const dueStr = formatDate(dueDate);
  const grace = gracePeriodDays ?? 5;
  const text = [
    `Hi ${tenantName},`,
    '',
    `Rent of ${amountStr} was due on ${dueStr} and has not been received.`,
    `A late fee may be applied after the ${grace}-day grace period.`,
    '',
    `Pay now: ${BRAND.paymentsUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Overdue rent',
    preheader: `Overdue rent ${amountStr} — late fees after ${grace}-day grace`,
    accent: PALETTE.warning,
    accentBg: PALETTE.warningBg,
    heroEmoji: '⚠️',
    heroLabel: 'Payment overdue',
    ctaUrl: BRAND.paymentsUrl,
    ctaLabel: 'Pay now',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `Rent of <strong>${escapeHtml(amountStr)}</strong> was due on <strong>${escapeHtml(dueStr)}</strong> and has not been received.`,
      ]),
      detailTable([
        ['Amount', amountStr],
        ['Was due', dueStr],
        ['Grace period', `${grace} days`],
      ]),
      paragraph([`A late fee may be applied after the <strong>${grace}-day</strong> grace period in your lease.`]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
