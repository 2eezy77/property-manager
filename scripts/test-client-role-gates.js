#!/usr/bin/env node
/**
 * Unit checks for client portal role rank + preview gates.
 * Run: node scripts/test-client-role-gates.js
 */
'use strict';

async function main() {
  const {
    ROLE_HOME,
    ROLE_RANK,
    meetsMinRole,
    canPreviewTenantPortal,
    canPreviewStaffPortal,
  } = await import('../client/src/utils/roles.js');

  let failed = 0;
  function check(cond, msg) {
    if (!cond) {
      console.error('FAIL:', msg);
      failed += 1;
    } else {
      console.log('ok:', msg);
    }
  }

  check(ROLE_HOME.super_admin === '/admin', 'super_admin homes to /admin');
  check(ROLE_HOME.owner === '/admin', 'owner homes to /admin');
  check(ROLE_HOME.property_manager === '/manager', 'property_manager homes to /manager');
  check(ROLE_HOME.tenant === '/tenant', 'tenant homes to /tenant');

  check(ROLE_RANK.owner > ROLE_RANK.property_manager, 'owner ranks above manager');
  check(ROLE_RANK.property_manager > ROLE_RANK.tenant, 'manager ranks above tenant');

  check(meetsMinRole('owner', 'property_manager') === true, 'owner meets manager min');
  check(meetsMinRole('property_manager', 'property_manager') === true, 'manager meets manager min');
  check(meetsMinRole('tenant', 'property_manager') === false, 'tenant fails manager min');
  check(meetsMinRole('owner', 'owner') === true, 'owner meets owner min');
  check(meetsMinRole('property_manager', 'owner') === false, 'manager fails owner min');
  check(meetsMinRole('not_a_role', 'tenant') === false, 'unknown role fails tenant min');
  check(meetsMinRole('owner', 'not_a_role') === false, 'unknown minRole fails closed');

  check(canPreviewTenantPortal('owner') === true, 'owner can preview tenant portal');
  check(canPreviewTenantPortal('super_admin') === true, 'super_admin can preview tenant portal');
  check(canPreviewTenantPortal('property_manager') === true, 'manager can preview tenant portal');
  check(canPreviewTenantPortal('tenant') === false, 'tenant cannot preview tenant portal');

  check(canPreviewStaffPortal({ role: 'owner' }) === true, 'owner can preview staff portal');
  check(canPreviewStaffPortal({ role: 'super_admin' }) === true, 'super_admin can preview staff portal');
  check(canPreviewStaffPortal({ role: 'property_manager' }) === false,
    'manager cannot preview staff portal');
  check(canPreviewStaffPortal({ role: 'tenant' }) === false, 'tenant cannot preview staff portal');
  check(canPreviewStaffPortal(null) === false, 'null user cannot preview staff portal');

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll client role gate checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
