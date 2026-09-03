#!/usr/bin/env node
/**
 * Admin Users password-set forbid gates (no DB queries).
 * Locks primary-owner / co-owner paths without hashing or emailing.
 *
 * Run: npm run test:password-admin-gates
 *
 * Requires DATABASE_URL only because password-admin loads the pool; no queries run.
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/db';

const { assertAdminSetPasswordAllowed } = require('../src/services/password-admin.service');

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

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll password-admin gate checks passed.');
