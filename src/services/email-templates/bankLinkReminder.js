/**
 * Reminder for tenants to link a bank via Plaid (no password reset).
 */

const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, sectionHeading, bulletList } = require('./utils');
const { loginUrl } = require('./loginCredentials');

function renderBankLinkReminder({
  recipientName = 'there',
  unitLabel = '',
  loginEmail = '',
  signatoryName = 'Montero Rentals',
}) {
  const signInUrl = loginEmail ? loginUrl(loginEmail) : BRAND.portalUrl;
  const subject = `Action needed: link your bank for rent — ${BRAND.property}`;

  const text = [
    `Hi ${recipientName},`,
    '',
    `Please sign in to ${BRAND.portalUrl} and link your checking or savings account under Payments.`,
    'We use Plaid to connect your bank securely for ACH rent and utility charges.',
    'Cash App Pay is also available in the portal if you prefer not to link a bank.',
    '',
    unitLabel ? `Your unit: ${unitLabel}` : '',
    loginEmail ? `Sign in: ${signInUrl}` : '',
    '',
    'Questions? Reply to this email or contact Jose Montero.',
    '',
    signatoryName,
  ].filter(Boolean).join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: 'Link your bank in the tenant portal',
    accent: PALETTE.warning,
    accentBg: PALETTE.warningBg,
    heroEmoji: '🏦',
    heroLabel: 'Link your bank',
    ctaUrl: signInUrl,
    ctaLabel: 'Open Payments',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        'To pay rent and utility shares through the portal, please link your ',
        '<strong>checking or savings account</strong> under ',
        `<strong>Payments</strong> at ${escapeHtml(BRAND.portalUrl)}.`,
        unitLabel ? ` (${escapeHtml(unitLabel)})` : '',
      ]),
      sectionHeading('What to do'),
      bulletList([
        'Sign in to the portal',
        'Open <strong>Payments</strong> → <strong>Connect Bank Account</strong>',
        'Complete Plaid (same flow as linking Navy Federal or your bank app)',
        'Prefer Cash App? Use <strong>Pay with Cash App</strong> on the Payments page — no bank link required for rent',
      ]),
      paragraph([
        '<span style="color:#64748b;">Plaid only verifies your account for ACH debits — Montero Rentals does not store your bank password.</span>',
      ]),
      paragraph([
        `<span style="color:#64748b;">Questions? Reply here or contact Jose Montero.</span>`,
      ]),
      paragraph([`<span style="color:#64748b;">— ${escapeHtml(signatoryName)}</span>`]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { renderBankLinkReminder };
