const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, sectionHeading } = require('./utils');

const { loginUrl } = require('./loginCredentials');
function render({ recipientName = 'there', resetUrl, loginEmail }) {
  const subject = 'Reset your Montero Rentals password';
  const signInUrl = loginUrl(loginEmail);

  const text = [
    `Hi ${recipientName},`,
    '',
    'We received a request to reset your Montero Rentals portal password.',
    '',
    `Reset link (expires in 1 hour): ${resetUrl}`,
    '',
    'If you did not request this, ignore this email — your password will not change.',
    '',
    `Sign in anytime: ${signInUrl}`,
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: 'Reset your portal password',
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '🔑',
    heroLabel: 'Password reset',
    ctaUrl: resetUrl,
    ctaLabel: 'Choose a new password',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        'Tap the button below to set a new password for ',
        `<strong>${escapeHtml(loginEmail)}</strong>. This link expires in <strong>1 hour</strong>.`,
      ]),
      sectionHeading('Did not request this?'),
      paragraph([
        'Ignore this email — your current password stays the same.',
        ' If this keeps happening, tell your property manager.',
      ]),
      paragraph([
        `After resetting, sign in at `,
        `<a href="${escapeHtml(signInUrl)}" style="color:${PALETTE.accentDefault};">${escapeHtml(signInUrl)}</a>.`,
      ]),
    ].join(''),
  });

  return { subject, text, html };
}

module.exports = { render, loginUrl };
