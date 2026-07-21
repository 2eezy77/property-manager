const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, formatMoney, paragraph, detailTable } = require('./utils');

function render({ tenantName, amount, title, unitNumber, propertyName, paymentId }) {
  const amt = formatMoney(amount);
  const text = [
    `Hi ${tenantName},`,
    '',
    `A charge of ${amt} has been recorded for maintenance or property damages related to:`,
    `"${title}" (Unit ${unitNumber}, ${propertyName}).`,
    '',
    `Payment reference: ${paymentId}`,
    `Pay or review: ${BRAND.paymentsUrl}`,
    '',
    'This charge is documented in your payment history. Late fees on rent are separate and apply per your lease grace period.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Maintenance charge',
    preheader: `Charge ${amt} — ${title}`,
    accent: PALETTE.warning,
    accentBg: PALETTE.warningBg,
    heroEmoji: '💰',
    heroLabel: 'Charge recorded',
    ctaUrl: BRAND.paymentsUrl,
    ctaLabel: 'Pay or review',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `A charge of <strong>${escapeHtml(amt)}</strong> has been recorded for maintenance or damages related to your request.`,
      ]),
      detailTable([
        ['Amount', amt],
        ['Request', title],
        ['Unit', `Unit ${unitNumber}`],
        ['Property', propertyName],
        ['Reference', String(paymentId || '—')],
      ]),
      paragraph([
        'This charge appears in your payment history. Rent late fees are separate and follow your lease grace period.',
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
