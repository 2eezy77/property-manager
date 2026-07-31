const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, sectionHeading } = require('./utils');

function render({ recipientName = 'there', setPasswordUrl, loginEmail, leaseId }) {
  const subject = 'Your Montero Rentals lease is ready';

  const text = [
    `Hi ${recipientName},`,
    '',
    'Your lease has been created in the Montero Rentals tenant portal.',
    '',
    `Set your password and open your lease: ${setPasswordUrl}`,
    '',
    `Sign in email: ${loginEmail}`,
    leaseId ? `Lease ID: ${leaseId}` : '',
    '',
    'This link expires in 1 hour.',
    '',
    BRAND.name,
  ].filter(Boolean).join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: 'Set your password to review your lease',
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: 'M',
    heroLabel: 'Lease invitation',
    ctaUrl: setPasswordUrl,
    ctaLabel: 'Set password and view lease',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        'Your lease has been created in the Montero Rentals tenant portal. ',
        'Set your password to review your lease and continue the move-in process.',
      ]),
      sectionHeading('Your login'),
      paragraph([
        `Use <strong>${escapeHtml(loginEmail)}</strong> when signing in.`,
        leaseId ? ` Lease ID: <strong>${escapeHtml(leaseId)}</strong>.` : '',
      ]),
      paragraph(['This password setup link expires in <strong>1 hour</strong>.']),
    ].join(''),
  });

  return { subject, text, html };
}

module.exports = { render };
