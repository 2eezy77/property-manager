#!/usr/bin/env node
/**
 * Unit checks for portal-launch recipient / co-owner / prorate / password rules.
 * Run: node scripts/test-portal-launch-recipients.js
 */
'use strict';

const {
  CO_OWNER_EMAIL,
  PRORATED_ELECTRIC_START,
  normalizeEmail,
  isCoOwnerEmail,
  ownersIncludeCoOwner,
  tenantNeedsProratedElectric,
  campaignRoleSkipsPassword,
} = require('../src/services/portal-launch-campaign.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(CO_OWNER_EMAIL.includes('@'), 'co-owner email constant set');
assert(PRORATED_ELECTRIC_START === '2026-06-01', 'prorate cutoff is 2026-06-01');

assert(normalizeEmail('  Foo@Bar.COM ') === 'foo@bar.com', 'normalize trims + lowercases');
assert(normalizeEmail(null) === '', 'normalize null → empty');

assert(isCoOwnerEmail(CO_OWNER_EMAIL) === true, 'exact co-owner match');
assert(isCoOwnerEmail(CO_OWNER_EMAIL.toUpperCase()) === true, 'co-owner match is case-insensitive');
assert(isCoOwnerEmail(`  ${CO_OWNER_EMAIL}  `) === true, 'co-owner match trims');
assert(isCoOwnerEmail('someone.else@gmail.com') === false, 'other email is not co-owner');
assert(isCoOwnerEmail('') === false, 'empty email is not co-owner');

assert(
  ownersIncludeCoOwner([{ email: 'owner@example.com' }, { email: CO_OWNER_EMAIL }]) === true,
  'owners list detects co-owner present'
);
assert(
  ownersIncludeCoOwner([{ email: 'Owner@Example.com' }]) === false,
  'owners list without co-owner returns false'
);
assert(ownersIncludeCoOwner([]) === false, 'empty owners list');
assert(ownersIncludeCoOwner(null) === false, 'null owners list');

assert(tenantNeedsProratedElectric('2026-06-01') === true, 'start on cutoff → prorated');
assert(tenantNeedsProratedElectric('2026-07-15') === true, 'start after cutoff → prorated');
assert(tenantNeedsProratedElectric('2026-05-31') === false, 'start before cutoff → not prorated');
assert(tenantNeedsProratedElectric(null) === false, 'missing start → not prorated');
assert(tenantNeedsProratedElectric('') === false, 'empty start → not prorated');

assert(campaignRoleSkipsPassword('owner') === true, 'owner launch mail skips password');
assert(campaignRoleSkipsPassword('property_manager') === false, 'manager gets password on send');
assert(campaignRoleSkipsPassword('tenant') === false, 'tenant gets password on send');
assert(campaignRoleSkipsPassword('admin') === false, 'non-owner roles do not skip');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll portal-launch-recipients checks passed.');
