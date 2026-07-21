const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph } = require('./utils');
const { renderLoginCredentialsBlock } = require('./loginCredentials');

/** One-time portal login credentials (individual send only). */
function render({
  tenantName,
  email,
  temporaryPassword,
  unitLabel,
  propertyName,
  role = 'tenant',
}) {
  const isManager = role === 'property_manager';
  const creds = renderLoginCredentialsBlock({ loginEmail: email, temporaryPassword });
  const ctaUrl = isManager ? BRAND.managerDashboardUrl : creds.ctaUrl;
  const ctaLabel = isManager ? 'Open manager portal' : creds.ctaLabel;
  const subject = isManager
    ? 'Your Montero Rentals manager sign-in'
    : `Your Montero Rentals sign-in — ${propertyName || BRAND.property}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    creds.text.trim(),
    isManager
      ? `Then open the manager dashboard: ${BRAND.managerDashboardUrl}`
      : 'Then link your bank under Payments.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: `Sign in as ${email}`,
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '🔐',
    heroLabel: 'Your sign-in',
    ctaUrl,
    ctaLabel,
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `Your sign-in for <strong>${escapeHtml(propertyName || BRAND.property)}</strong>`,
        unitLabel ? ` (${escapeHtml(unitLabel)})` : '',
        ` on ${escapeHtml(BRAND.name)}.`,
        ' <strong>Do not forward this email.</strong>',
      ]),
      creds.html,
      paragraph([
        isManager
          ? 'After sign-in, open Utilities or Payments from the manager menu.'
          : 'After sign-in, open <strong>Payments</strong> and link your bank for rent and utilities.',
      ]),
      paragraph([
        `<span style="color:#64748b;font-size:14px;">Did not expect this? Contact property management immediately.</span>`,
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
