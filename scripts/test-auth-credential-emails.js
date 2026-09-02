#!/usr/bin/env node
/**
 * Auth/credential email templates: password reset, lease invite, portal credentials.
 * Covers subjects, CTAs, expiry copy, role branching, and HTML escaping.
 *
 * Run: npm run test:auth-credential-emails
 */
'use strict';

const passwordReset = require('../src/services/email-templates/passwordReset');
const tenantLeaseInvite = require('../src/services/email-templates/tenantLeaseInvite');
const tenantPortalCredentials = require('../src/services/email-templates/tenantPortalCredentials');
const { BRAND } = require('../src/services/email-templates/brand');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

{
  const r = passwordReset.render({
    recipientName: 'Ada <script>',
    resetUrl: 'https://portal.example/reset?token=abc',
    loginEmail: 'ada@example.com',
  });
  check(r.subject === 'Reset your Montero Rentals password', `reset subject: ${r.subject}`);
  check(r.text.includes('https://portal.example/reset?token=abc'), 'reset text includes reset URL');
  check(/expires in 1 hour/i.test(r.text), 'reset text mentions 1 hour expiry');
  check(/ignore this email/i.test(r.text), 'reset text has ignore guidance');
  check(r.html.includes('&lt;script&gt;'), 'reset HTML escapes recipient name');
  check(!r.html.includes('<script>'), 'reset HTML has no raw script tag');
  check(/Choose a new password/i.test(r.html), 'reset HTML CTA label');
  check(r.html.includes('https://portal.example/reset?token=abc'), 'reset HTML uses reset URL as CTA');
  check(r.html.includes('ada@example.com'), 'reset HTML shows login email');
}

{
  const r = tenantLeaseInvite.render({
    recipientName: 'Bob <b>',
    setPasswordUrl: 'https://portal.example/set-password?token=xyz',
    loginEmail: 'bob@example.com',
    leaseId: 'lease-99',
  });
  check(r.subject === 'Your Montero Rentals lease is ready', `invite subject: ${r.subject}`);
  check(r.text.includes('https://portal.example/set-password?token=xyz'), 'invite text has set-password URL');
  check(r.text.includes('bob@example.com'), 'invite text has login email');
  check(r.text.includes('Lease ID: lease-99'), 'invite text has lease id');
  check(/Stripe Identity/i.test(r.text), 'invite text mentions Stripe Identity');
  check(/tenant-paid/i.test(r.text), 'invite text says verification fee is tenant-paid');
  check(/expires in 1 hour/i.test(r.text), 'invite text mentions 1 hour expiry');
  check(r.html.includes('&lt;b&gt;'), 'invite HTML escapes recipient name');
  check(!r.html.includes('<b>'), 'invite HTML has no raw bold tag from name');
  check(/Set password and view lease/i.test(r.html), 'invite HTML CTA label');
}

{
  const r = tenantLeaseInvite.render({
    recipientName: 'Bob',
    setPasswordUrl: 'https://portal.example/set-password?token=xyz',
    loginEmail: 'bob@example.com',
  });
  check(!/Lease ID:/.test(r.text), 'invite omits lease id when not provided');
}

{
  const tenant = tenantPortalCredentials.render({
    tenantName: 'Cara <img>',
    email: 'cara@example.com',
    temporaryPassword: 'TempPass1!',
    unitLabel: 'Room 3',
    propertyName: '743 Demo',
    role: 'tenant',
  });
  check(
    tenant.subject === `Your Montero Rentals sign-in — 743 Demo`,
    `tenant creds subject: ${tenant.subject}`
  );
  check(tenant.text.includes('TempPass1!'), 'tenant creds text includes temporary password');
  check(/link your bank/i.test(tenant.text), 'tenant creds text nudges bank link');
  check(tenant.html.includes('&lt;img&gt;'), 'tenant creds HTML escapes name');
  check(tenant.html.includes('Room 3'), 'tenant creds HTML includes unit');
  check(/Do not forward this email/i.test(tenant.html), 'tenant creds warns not to forward');
}

{
  const mgr = tenantPortalCredentials.render({
    tenantName: 'Konstantin',
    email: 'mgr@example.com',
    temporaryPassword: 'MgrPass1!',
    role: 'property_manager',
  });
  check(
    mgr.subject === 'Your Montero Rentals manager sign-in',
    `manager creds subject: ${mgr.subject}`
  );
  check(mgr.text.includes(BRAND.managerDashboardUrl), 'manager creds text points at manager dashboard');
  check(/manager dashboard/i.test(mgr.text), 'manager creds mentions manager dashboard');
  check(!/link your bank/i.test(mgr.text), 'manager creds does not nudge bank link');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll auth-credential-emails checks passed.');
