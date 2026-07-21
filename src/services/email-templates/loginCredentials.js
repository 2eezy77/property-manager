/**
 * Shared sign-in block for launch and credential emails.
 */

const { BRAND } = require('./brand');
const { escapeHtml, paragraph, detailTable, sectionHeading } = require('./utils');

function loginUrl(email) {
  const base = `${String(BRAND.portalUrl).replace(/\/$/, '')}/login`;
  if (!email) return base;
  return `${base}?email=${encodeURIComponent(email)}`;
}

function renderLoginCredentialsBlock({ loginEmail, temporaryPassword }) {
  const signInUrl = loginUrl(loginEmail);
  const empty = { html: '', text: '', signInUrl, ctaUrl: signInUrl, ctaLabel: 'Sign in to portal' };

  if (!temporaryPassword || !loginEmail) return empty;

  const text = [
    '',
    'Your sign-in (keep this email private):',
    `Sign-in: ${signInUrl}`,
    `Email: ${loginEmail}`,
    `Temporary password: ${temporaryPassword}`,
    'After signing in, set your own password under Account settings, or use Forgot password anytime.',
    '',
  ].join('\n');

  const html = [
    sectionHeading('Your sign-in'),
    detailTable([
      ['Sign-in page', signInUrl],
      ['Email', loginEmail],
      ['Temporary password', temporaryPassword],
    ]),
    paragraph([
      '<strong>Only you received this password.</strong> ',
      'Set a personal password under <strong>Account settings</strong> after your first sign-in, ',
      'or use <strong>Forgot password</strong> on the sign-in page anytime.',
    ]),
  ].join('');

  return { html, text, signInUrl, ctaUrl: signInUrl, ctaLabel: 'Sign in to portal' };
}

module.exports = { loginUrl, renderLoginCredentialsBlock };
