#!/usr/bin/env node
/**
 * Connect Express business_profile for site-visit Instant Payouts.
 * Run: node scripts/test-connect-site-profile.js
 */
const {
  connectSiteBusinessProfile,
  CONNECT_SITE_MCC,
} = require('../src/services/stripe.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(CONNECT_SITE_MCC === '6513', 'MCC 6513 is real-estate agents/managers');

{
  const prev = process.env.CLIENT_ORIGIN;
  process.env.CLIENT_ORIGIN = 'https://www.monterorentals.com/';
  const profile = connectSiteBusinessProfile('Konstantin Manager');
  assert(profile.name === 'Konstantin Manager', 'profile uses display name');
  assert(profile.url === 'https://www.monterorentals.com', 'trailing slash stripped from CLIENT_ORIGIN');
  assert(profile.mcc === '6513', 'profile mcc is CONNECT_SITE_MCC');
  assert(
    profile.product_description === 'Property management site visit compensation',
    'product description is site-visit compensation'
  );
  if (prev === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = prev;
}

{
  const prev = process.env.CLIENT_ORIGIN;
  delete process.env.CLIENT_ORIGIN;
  const profile = connectSiteBusinessProfile('Owner Pay');
  assert(
    profile.url === 'https://www.monterorentals.com',
    'defaults to production origin when CLIENT_ORIGIN unset'
  );
  assert(profile.name === 'Owner Pay', 'name still set without CLIENT_ORIGIN');
  if (prev !== undefined) process.env.CLIENT_ORIGIN = prev;
}

if (failed) {
  console.error(`\ntest-connect-site-profile: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-connect-site-profile: OK');
