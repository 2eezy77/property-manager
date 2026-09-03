#!/usr/bin/env node
/**
 * Admin Users password-set forbid gates (primary owner, co-owner, inactive).
 * Run: node scripts/test-password-admin-gates.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://test:test@127.0.0.1:5432/property_manager_test';

const assert = require('assert');
const {
  assertAdminSetPasswordAllowed,
  validatePassword,
  generatePassword,
} = require('../src/services/password-admin.service');

function expectThrow(fn, code, messageIncludes) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected ${code}`);
  assert.strictEqual(caught.code, code, `expected code ${code}, got ${caught && caught.code}`);
  if (messageIncludes) {
    assert.match(String(caught.message), messageIncludes);
  }
}

const primaryOwnerId = 'owner-primary';
const actorManager = 'mgr-1';
const actorOwner = 'owner-co';

expectThrow(
  () => assertAdminSetPasswordAllowed({
    target: null,
    actorUserId: actorManager,
    primaryOwnerId,
  }),
  'NOT_FOUND'
);

expectThrow(
  () => assertAdminSetPasswordAllowed({
    target: { id: 'u1', role: 'tenant', is_active: false },
    actorUserId: actorManager,
    primaryOwnerId,
  }),
  'NOT_FOUND',
  /inactive/i
);

expectThrow(
  () => assertAdminSetPasswordAllowed({
    target: { id: primaryOwnerId, role: 'owner', is_active: true },
    actorUserId: primaryOwnerId,
    primaryOwnerId,
  }),
  'FORBIDDEN',
  /primary owner/i
);

expectThrow(
  () => assertAdminSetPasswordAllowed({
    target: { id: primaryOwnerId, role: 'owner', is_active: true },
    actorUserId: actorManager,
    primaryOwnerId,
  }),
  'FORBIDDEN',
  /primary owner/i
);

expectThrow(
  () => assertAdminSetPasswordAllowed({
    target: { id: actorOwner, role: 'owner', is_active: true },
    actorUserId: actorManager,
    primaryOwnerId,
  }),
  'FORBIDDEN',
  /account settings/i
);

assert.doesNotThrow(() => assertAdminSetPasswordAllowed({
  target: { id: actorOwner, role: 'owner', is_active: true },
  actorUserId: actorOwner,
  primaryOwnerId,
}));

assert.doesNotThrow(() => assertAdminSetPasswordAllowed({
  target: { id: 'tenant-1', role: 'tenant', is_active: true },
  actorUserId: actorManager,
  primaryOwnerId,
}));

assert.doesNotThrow(() => assertAdminSetPasswordAllowed({
  target: { id: 'pm-1', role: 'property_manager', is_active: true },
  actorUserId: actorManager,
  primaryOwnerId,
}));

expectThrow(() => validatePassword('short'), 'WEAK_PASSWORD');
assert.strictEqual(validatePassword('long-enough'), 'long-enough');

const generated = generatePassword(14);
assert.strictEqual(generated.length, 14);
assert.match(generated, /^[A-Za-z0-9!@#$]+$/);

console.log('test-password-admin-gates: OK');
