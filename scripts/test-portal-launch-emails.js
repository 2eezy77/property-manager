#!/usr/bin/env node
/**
 * Portal launch go-live emails: owner/manager/tenant render + electric copy escape.
 * Complements portal-launch-recipients (#79) with HTML/text body checks.
 *
 * Run: npm run test:portal-launch-emails
 */
'use strict';

const {
  DEFAULT_ELECTRIC,
  renderOwner,
  renderManager,
  renderTenant,
} = require('../src/services/email-templates/portalLaunch');
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

check(DEFAULT_ELECTRIC.currentCharges === 184.64, 'DEFAULT_ELECTRIC current charges locked');
check(DEFAULT_ELECTRIC.statementBalance === 744.21, 'DEFAULT_ELECTRIC statement balance locked');

{
  const r = renderOwner({
    recipientName: 'Jose <owner>',
    electric: {
      ...DEFAULT_ELECTRIC,
      tenantShares: [
        { firstName: 'Ada <t>', amount: 50 },
        { firstName: 'Bo', amount: 40 },
      ],
    },
    signatoryName: 'Montero <LLC>',
  });
  check(r.subject === 'Montero Rentals portal is live', 'owner subject');
  check(r.text.includes('Hi Jose <owner>,'), 'owner text keeps raw name');
  check(r.text.includes('$184.64'), 'owner text includes current charges');
  check(r.text.includes('Ada <t> $50.00'), 'owner text lists share without HTML escape');
  check(r.html.includes('Jose &lt;owner&gt;'), 'owner HTML escapes recipient');
  check(r.html.includes('Ada &lt;t&gt;'), 'owner HTML escapes share name');
  check(r.html.includes('Montero &lt;LLC&gt;'), 'owner HTML escapes signatory');
  check(r.html.includes(BRAND.adminUrl), 'owner CTA is admin dashboard');
  check(/Open owner dashboard/i.test(r.html), 'owner CTA label');
  check(!r.html.includes('<owner>'), 'owner HTML has no raw angle brackets from name');
}

{
  const withCreds = renderManager({
    recipientName: 'Kon',
    loginEmail: 'kon+mgr@example.com',
    temporaryPassword: 'TempPass1!',
  });
  check(
    withCreds.subject === 'Your Montero Rentals manager sign-in',
    'manager subject with credentials'
  );
  check(withCreds.text.includes('TempPass1!'), 'manager text includes temp password');
  check(withCreds.text.includes('kon%2Bmgr%40example.com') || withCreds.html.includes('kon%2Bmgr%40example.com'),
    'manager sign-in URL encodes plus-address email');
  check(/Sign in to portal/i.test(withCreds.html), 'manager CTA uses credential block label');

  const noCreds = renderManager({ recipientName: 'Kon' });
  check(
    noCreds.subject === 'Montero Rentals manager portal is live',
    'manager subject without credentials'
  );
  check(
    noCreds.html.includes(`${String(BRAND.portalUrl).replace(/\/$/, '')}/login`)
      || noCreds.html.includes(BRAND.managerDashboardUrl),
    'manager no-cred CTA is portal login or manager dashboard'
  );
  check(!noCreds.text.includes('Temporary password'), 'manager no-cred omits temp password');
  check(noCreds.text.includes(BRAND.managerDashboardUrl), 'manager no-cred text points at manager portal');
}

{
  const prorated = renderTenant({
    recipientName: 'Stone <x>',
    unitLabel: 'Unit <2>',
    loginEmail: 'stone@example.com',
    temporaryPassword: 'Welcome1!',
    proratedElectric: true,
  });
  check(prorated.subject.includes(BRAND.property), 'tenant subject names property');
  check(/prorated/i.test(prorated.text), 'prorated tenant note in text');
  check(prorated.html.includes('Stone &lt;x&gt;'), 'tenant HTML escapes name');
  check(prorated.html.includes('Unit &lt;2&gt;'), 'tenant HTML escapes unit label');
  check(prorated.text.includes('Welcome1!'), 'tenant text includes temp password');
  check(/do not forward|Only you received this password/i.test(prorated.html),
    'tenant credential warning present');

  const standard = renderTenant({
    recipientName: 'Lily',
    unitLabel: 'Unit 3',
    proratedElectric: false,
  });
  check(/48 hours to dispute/i.test(standard.text), 'non-prorated dispute window copy');
  check(standard.subject.startsWith('Your Montero Rentals portal'),
    'tenant subject without login email');
  check(standard.html.includes(BRAND.portalUrl), 'tenant no-cred CTA falls back to portal');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll portal-launch-emails checks passed.');
