/**
 * Portal launch announcements — owner, manager, tenant (branded HTML).
 */

const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const {
  escapeHtml,
  formatMoney,
  formatDate,
  paragraph,
  detailTable,
  sectionHeading,
  bulletList,
} = require('./utils');
const { loginUrl, renderLoginCredentialsBlock } = require('./loginCredentials');

const DEFAULT_ELECTRIC = {
  periodStart: '2026-05-17',
  periodEnd: '2026-06-15',
  currentCharges: 184.64,
  statementBalance: 744.21,
  chargeableAfter: '2026-06-15',
  tenantShares: [],
};

function formatShareSummary(electric) {
  const shares = electric.tenantShares || [];
  if (!shares.length) return '';
  return shares
    .map((s) => `${escapeHtml(s.firstName || 'Tenant')} <strong>${escapeHtml(formatMoney(s.amount))}</strong>`)
    .join(', ');
}

function electricDetailRows(e) {
  return [
    ['Billing period', `${formatDate(e.periodStart)} – ${formatDate(e.periodEnd)}`],
    ['Tenant collectible total', formatMoney(e.currentCharges)],
    ['Landlord statement balance', formatMoney(e.statementBalance)],
    ['Notify tenants after', formatDate(e.chargeableAfter)],
  ];
}

function renderOwner({
  recipientName = 'Jose',
  electric = DEFAULT_ELECTRIC,
  signatoryName = 'Montero Rentals',
}) {
  const e = { ...DEFAULT_ELECTRIC, ...electric };
  const shareSummary = formatShareSummary(e);
  const subject = 'Montero Rentals portal is live';
  const text = [
    `Hi ${recipientName},`,
    '',
    `${BRAND.name} is live at ${BRAND.portalUrl}`,
    '',
    `Current electric draft: ${formatMoney(e.currentCharges)} (${formatDate(e.periodStart)} – ${formatDate(e.periodEnd)}).`,
    shareSummary
      ? `Tenant shares: ${(e.tenantShares || []).map((s) => `${s.firstName} ${formatMoney(s.amount)}`).join(', ')}.`
      : '',
    `Notify tenants after ${formatDate(e.chargeableAfter)}.`,
    '',
    `Owner dashboard: ${BRAND.adminUrl}`,
    '',
    'Tenants and your manager each get their own sign-in email with a temporary password.',
    '',
    signatoryName,
  ]
    .filter(Boolean)
    .join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: `${BRAND.property} — rent, utilities, and owner dashboard`,
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '🏠',
    heroLabel: 'Portal live',
    ctaUrl: BRAND.adminUrl,
    ctaLabel: 'Open owner dashboard',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        `<strong>${escapeHtml(BRAND.name)}</strong> is live for `,
        `<strong>${escapeHtml(BRAND.property)}</strong>, ${escapeHtml(BRAND.location)}.`,
        ' Sign in with your owner email. Tenants and your manager receive separate sign-in emails with temporary passwords.',
      ]),
      sectionHeading('Ready now'),
      bulletList([
        'Rent, utilities, maintenance, and messaging in one portal',
        'Dominion history imported — only the <strong>current</strong> electric bill is collectible from tenants',
        'Payments and Playbook show who is current, partial, or late on rent',
      ]),
      sectionHeading('Current electric (draft)'),
      detailTable(electricDetailRows(e)),
      ...(shareSummary
        ? [paragraph([`Tenant shares: ${shareSummary}.`])]
        : []),
      paragraph([
        `After <strong>${escapeHtml(formatDate(e.chargeableAfter))}</strong>, notify tenants from Utilities, then charge when banks are linked.`,
      ]),
      paragraph([`<span style="color:#64748b;">— ${escapeHtml(signatoryName)}</span>`]),
    ].join(''),
  });

  return { html, text, subject };
}

function renderManager({
  recipientName = 'Konstantin',
  loginEmail,
  temporaryPassword,
  electric = DEFAULT_ELECTRIC,
  signatoryName = 'Montero Rentals',
}) {
  const e = { ...DEFAULT_ELECTRIC, ...electric };
  const creds = renderLoginCredentialsBlock({ loginEmail, temporaryPassword });
  const subject = loginEmail
    ? 'Your Montero Rentals manager sign-in'
    : 'Montero Rentals manager portal is live';
  const text = [
    `Hi ${recipientName},`,
    '',
    creds.text || `Manager portal: ${BRAND.managerDashboardUrl}`,
    'Payments, Utilities, Maintenance, and Playbook are ready.',
    `Electric draft ${formatMoney(e.currentCharges)} — notify tenants after ${formatDate(e.chargeableAfter)}.`,
    '',
    signatoryName,
  ].join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: 'Sign in, then run utilities and rent collection',
    accent: PALETTE.staff,
    accentBg: PALETTE.staffBg,
    heroEmoji: '🔧',
    heroLabel: 'Manager portal',
    ctaUrl: creds.ctaUrl || BRAND.managerDashboardUrl,
    ctaLabel: creds.ctaLabel || 'Open manager portal',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        `Your manager portal for <strong>${escapeHtml(BRAND.property)}</strong> is ready.`,
      ]),
      creds.html,
      sectionHeading('Start here'),
      bulletList([
        '<strong>Sign in</strong> — then open Payments for rent status',
        '<strong>Utilities</strong> — Gmail import → combine drafts → calculate shares → notify → charge',
        '<strong>Maintenance</strong> — tenant request queue',
      ]),
      sectionHeading('Current electric'),
      detailTable([
        ['Period', `${formatDate(e.periodStart)} – ${formatDate(e.periodEnd)}`],
        ['Tenant collectible', formatMoney(e.currentCharges)],
        ['Notify after', formatDate(e.chargeableAfter)],
      ]),
      paragraph([
        `Wait until after <strong>${escapeHtml(formatDate(e.chargeableAfter))}</strong> to notify tenants. `,
        'They need a linked bank before ACH can run.',
      ]),
      paragraph([`<span style="color:#64748b;">— ${escapeHtml(signatoryName)}</span>`]),
    ].join(''),
  });

  return { html, text, subject };
}

function renderTenant({
  recipientName,
  unitLabel,
  loginEmail,
  temporaryPassword,
  electric = DEFAULT_ELECTRIC,
  proratedElectric = false,
  signatoryName = 'Montero Rentals',
}) {
  const e = { ...DEFAULT_ELECTRIC, ...electric };
  const creds = renderLoginCredentialsBlock({ loginEmail, temporaryPassword });
  const signInUrl = loginEmail ? loginUrl(loginEmail) : BRAND.portalUrl;
  const subject = loginEmail
    ? `Your Montero Rentals sign-in — ${BRAND.property}`
    : `Your Montero Rentals portal — ${BRAND.property}`;

  const electricNote = proratedElectric
    ? `Your electric share for the current bill is prorated from your lease start. You will see the exact amount after ${formatDate(e.chargeableAfter)}.`
    : `Your electric share will appear in the portal after ${formatDate(e.chargeableAfter)}. You have 48 hours to dispute before any ACH charge.`;

  const text = [
    `Hi ${recipientName},`,
    '',
    creds.text || `Portal: ${signInUrl}`,
    'After sign-in: link your bank under Payments, then pay rent and submit maintenance from the portal.',
    electricNote,
    '',
    'Questions? Reply to this email or contact Jose Montero.',
    '',
    signatoryName,
  ].join('\n');

  const html = wrapEmail({
    title: subject,
    preheader: 'Sign in, link your bank, pay rent',
    accent: PALETTE.success,
    accentBg: PALETTE.successBg,
    heroEmoji: '🔑',
    heroLabel: 'Tenant welcome',
    ctaUrl: creds.ctaUrl || signInUrl,
    ctaLabel: creds.ctaLabel || 'Open portal',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(recipientName)}</strong>,`]),
      paragraph([
        `<strong>${escapeHtml(BRAND.name)}</strong> is your portal for `,
        `<strong>${escapeHtml(BRAND.property)}</strong>`,
        unitLabel ? ` (${escapeHtml(unitLabel)})` : '',
        '.',
      ]),
      creds.html,
      sectionHeading('After you sign in'),
      bulletList([
        'Open <strong>Payments</strong> and link your bank (Plaid) for ACH rent and utilities',
        'Pay rent and review your balance in one place',
        'Submit maintenance requests from the portal',
      ]),
      sectionHeading('Electric (Dominion)'),
      paragraph([escapeHtml(electricNote)]),
      paragraph([
        `<span style="color:#64748b;">Questions? Reply here or contact Jose Montero. Emergencies: use Maintenance in the portal and call or text as usual.</span>`,
      ]),
      paragraph([`<span style="color:#64748b;">— ${escapeHtml(signatoryName)}</span>`]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = {
  DEFAULT_ELECTRIC,
  renderOwner,
  renderManager,
  renderTenant,
};
