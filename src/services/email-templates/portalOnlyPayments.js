/**
 * Notice: rent/utilities must be paid in the portal — no more off-app Cash App / cashtag.
 * Does not include credentials or password resets.
 */

const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, sectionHeading, bulletList } = require('./utils');
const { loginUrl } = require('./loginCredentials');

function renderPortalOnlyPayments({
  recipientName = 'there',
  unitLabel = '',
  loginEmail = '',
  signatoryName = 'Montero Rentals',
}) {
  const signInUrl = loginEmail ? loginUrl(loginEmail) : BRAND.paymentsUrl;
  const subject = `Important: pay rent & utilities in the portal only — ${BRAND.property}`;

  const text = [
    `Hi ${recipientName},`,
    '',
    'Starting now, please pay rent and utility shares only through the Montero Rentals tenant portal.',
    'We are no longer accepting off-app payments (Cash App to a cashtag, Venmo, Zelle, or other outside transfers) for rent or utilities.',
    '',
    'How to pay in the portal:',
    '• Bank (ACH) — no processing fee. Best for monthly rent; enable Autopay to waive late fees.',
    '• Cash App Pay inside the Payments page — includes a 2.9% + $0.30 processing fee.',
    '',
    unitLabel ? `Your unit: ${unitLabel}` : '',
    `Sign in: ${signInUrl}`,
    '',
    'If you already sent an off-app payment that has not been recorded, reply to this email with the date and amount so we can reconcile it.',
    '',
    'Questions? Reply here or contact Jose Montero / Konstantin.',
    '',
    signatoryName,
  ].filter(Boolean).join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: 'Portal payments only — no more off-app Cash App / cashtag',
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '💳',
    heroLabel: 'Portal payments only',
    ctaUrl: signInUrl,
    ctaLabel: 'Open Payments',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        'Starting now, please pay <strong>rent and utility shares only through the tenant portal</strong>',
        unitLabel ? ` (${escapeHtml(unitLabel)})` : '',
        '. We are <strong>no longer accepting off-app payments</strong> ',
        '(Cash App to a cashtag, Venmo, Zelle, or other outside transfers) for rent or utilities.',
      ]),
      sectionHeading('How to pay'),
      bulletList([
        '<strong>Bank (ACH)</strong> — <strong>no processing fee</strong>. Best for monthly rent; turn on Autopay to waive late fees.',
        '<strong>Cash App Pay</strong> on the Payments page — includes a <strong>2.9% + $0.30</strong> processing fee (paid by you).',
      ]),
      paragraph([
        'If you already sent an off-app payment that has not been recorded, reply with the date and amount so we can reconcile it.',
      ]),
      paragraph([
        `<span style="color:#64748b;">Questions? Reply here or contact Jose Montero / Konstantin.</span>`,
      ]),
      paragraph([`<span style="color:#64748b;">— ${escapeHtml(signatoryName)}</span>`]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { renderPortalOnlyPayments };
