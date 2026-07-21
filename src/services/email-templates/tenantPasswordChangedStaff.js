const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

/** Alert owner/manager when a tenant updates their own password. */
function render({ tenantName, tenantEmail, unitLabel, propertyName, changedAt }) {
  const when = changedAt
    ? new Date(changedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'just now';

  const subject = `Tenant updated portal password — ${tenantName}`;
  const text = [
    `${tenantName} (${tenantEmail}) changed their Montero Rentals password.`,
    unitLabel ? `Unit: ${unitLabel}` : '',
    propertyName ? `Property: ${propertyName}` : '',
    `Time: ${when}`,
    '',
    `Users: ${BRAND.adminUrl}/users`,
    '',
    BRAND.name,
  ]
    .filter(Boolean)
    .join('\n');

  const rows = [
    ['Tenant', tenantName],
    ['Email', tenantEmail],
    ['Updated', when],
  ];
  if (unitLabel) rows.push(['Unit', unitLabel]);
  if (propertyName) rows.push(['Property', propertyName]);

  const html = wrapEmail({
    title: 'Tenant password updated',
    preheader: `${tenantName} changed their portal password`,
    accent: PALETTE.staff,
    accentBg: PALETTE.staffBg,
    heroEmoji: '✅',
    heroLabel: 'Security notice',
    ctaUrl: `${BRAND.adminUrl}/users`,
    ctaLabel: 'Open Users',
    bodyHtml: [
      paragraph([
        `<strong>${escapeHtml(tenantName)}</strong> updated the password on their tenant portal account.`,
      ]),
      detailTable(rows),
      paragraph([
        'No action is required unless you did not expect this change. Tenant onboarding will show password as complete.',
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
