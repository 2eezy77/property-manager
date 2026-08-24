#!/usr/bin/env node
/**
 * Lease invite email/token helpers used by POST /api/leases/native invite.
 * Run: node scripts/test-tenant-invite-helpers.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  normalizeEmail,
  requiredString,
  httpError,
  hashResetToken,
  resetUrlForToken,
  RESET_TTL_MS,
} = require('../src/services/tenant-invite.service');
const {
  hashResetToken: passwordResetHash,
} = require('../src/services/password-reset.service');

assert.ok(RESET_TTL_MS === 60 * 60 * 1000);

assert.strictEqual(normalizeEmail('  Jose@Example.COM '), 'jose@example.com');
assert.strictEqual(normalizeEmail(null), '');
assert.strictEqual(normalizeEmail(undefined), '');

assert.strictEqual(requiredString('  Ada  ', 'name required', 'NAME'), 'Ada');
try {
  requiredString('   ', 'first name is required', 'FIRST_NAME');
  assert.fail('expected throw');
} catch (err) {
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, 'FIRST_NAME');
  assert.strictEqual(err.message, 'first name is required');
}

const err = httpError('orgId is required', 400, 'ORG_REQUIRED');
assert.strictEqual(err.statusCode, 400);
assert.strictEqual(err.code, 'ORG_REQUIRED');

const raw = crypto.randomBytes(32).toString('hex');
assert.strictEqual(
  hashResetToken(raw),
  passwordResetHash(raw),
  'invite + forgot-password must hash tokens the same way'
);

const url = resetUrlForToken(raw);
assert.ok(url.includes('/reset-password?token='));
assert.ok(url.includes(encodeURIComponent(raw)));
assert.ok(
  url.includes('next=%2Ftenant%2Flease') || url.includes('next=/tenant/lease'),
  'invite reset sends tenants to lease next'
);

console.log('test-tenant-invite-helpers: ok');
