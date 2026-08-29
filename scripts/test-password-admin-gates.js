#!/usr/bin/env node
/**
 * Admin Users password-set gates + credential email role routing.
 * Locks primary-owner / co-owner forbid paths without DB (pure helpers).
 *
 * Run: node scripts/test-password-admin-gates.js
 *
 * Requires DATABASE_URL only because password-admin loads the pool; no queries run.
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/db';

const { assertAdminSetPasswordAllowed } = require('../src/services/password-admin.service');
const { render: renderPortalCredentials } = require('../src/services/email-templates/tenantPortalCredentials');
const { render: renderPasswordChangedStaff } = require('../src/services/email-templates/tenantPasswordChangedStaff');
const { BRAND } = require('../src/services/email-templates/brand');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function throwsCode(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || err.message;
  }
}

const PRIMARY = 'owner-primary';
const ACTOR = 'manager-1';

assert(throwsCode(() => assertAdminSetPasswordAllowed(null, { actorUserId: ACTOR })) === 'NOT_FOUND',
  'missing target is NOT_FOUND');
assert(
  throwsCode(() => assertAdminSetPasswordAllowed(
    { id: 'u1', role: 'tenant', is_active: false },
    { actorUserId: ACTOR }
  )) === 'NOT_FOUND',
  'inactive user is NOT_FOUND'
);

assert(
  throwsCode(() => assertAdminSetPasswordAllowed(
    { id: PRIMARY, role: 'owner', is_active: true },
    { actorUserId: ACTOR, primaryOwnerId: PRIMARY }
  )) === 'FORBIDDEN',
  'primary owner cannot be reset from Users'
);

assert(
  throwsCode(() => assertAdminSetPasswordAllowed(
    { id: PRIMARY, role: 'owner', is_active: true },
    { actorUserId: PRIMARY, primaryOwnerId: PRIMARY }
  )) === 'FORBIDDEN',
  'primary owner forbid applies even when actor is self'
);

assert(
  throwsCode(() => assertAdminSetPasswordAllowed(
    { id: 'co-owner', role: 'owner', is_active: true },
    { actorUserId: ACTOR, primaryOwnerId: PRIMARY }
  )) === 'FORBIDDEN',
  'manager cannot set another owner password'
);

assert(
  assertAdminSetPasswordAllowed(
    { id: 'co-owner', role: 'owner', is_active: true },
    { actorUserId: 'co-owner', primaryOwnerId: PRIMARY }
  ) === true,
  'non-primary owner may change their own password'
);

assert(
  assertAdminSetPasswordAllowed(
    { id: 'tenant-1', role: 'tenant', is_active: true },
    { actorUserId: ACTOR, primaryOwnerId: PRIMARY }
  ) === true,
  'tenant password reset is allowed'
);

assert(
  assertAdminSetPasswordAllowed(
    { id: 'mgr-2', role: 'property_manager', is_active: true },
    { actorUserId: ACTOR, primaryOwnerId: PRIMARY }
  ) === true,
  'property manager password reset is allowed'
);

assert(
  assertAdminSetPasswordAllowed(
    { id: 'tenant-2', role: 'tenant', is_active: true },
    { actorUserId: ACTOR }
  ) === true,
  'missing primaryOwnerId still allows tenant resets'
);

const tenantCreds = renderPortalCredentials({
  tenantName: 'Ada',
  email: 'ada@example.com',
  temporaryPassword: 'TempPass12!',
  unitLabel: 'Unit 2',
  propertyName: '743 A Ave',
  role: 'tenant',
});
assert(/sign-in — 743 A Ave/.test(tenantCreds.subject), `tenant subject names property: ${tenantCreds.subject}`);
assert(tenantCreds.text.includes('link your bank under Payments'), 'tenant copy pushes bank link');
assert(!tenantCreds.text.includes(BRAND.managerDashboardUrl), 'tenant email does not use manager dashboard URL');

const managerCreds = renderPortalCredentials({
  tenantName: 'Konstantin',
  email: 'manager@example.com',
  temporaryPassword: 'TempPass12!',
  propertyName: '743 A Ave',
  role: 'property_manager',
});
assert(managerCreds.subject === 'Your Montero Rentals manager sign-in',
  `manager subject is role-specific, got ${managerCreds.subject}`);
assert(managerCreds.text.includes(BRAND.managerDashboardUrl), 'manager email points at manager dashboard');
assert(managerCreds.html.includes(BRAND.managerDashboardUrl), 'manager HTML CTA uses manager dashboard');
assert(!managerCreds.text.includes('link your bank under Payments'), 'manager copy does not push tenant bank link');

const staffAlert = renderPasswordChangedStaff({
  tenantName: 'Ada Lovelace',
  tenantEmail: 'ada@example.com',
  unitLabel: 'Unit 2',
  propertyName: '743 A Ave',
  changedAt: new Date('2026-08-15T15:30:00Z'),
});
assert(staffAlert.subject === 'Tenant updated portal password — Ada Lovelace',
  `staff alert subject names tenant, got ${staffAlert.subject}`);
assert(staffAlert.text.includes('ada@example.com'), 'staff alert includes tenant email');
assert(staffAlert.text.includes('Unit: Unit 2'), 'staff alert includes unit');
assert(staffAlert.html.includes('Open Users'), 'staff alert CTA opens Users');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll password-admin gate checks passed.');
