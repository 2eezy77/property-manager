#!/usr/bin/env node
/**
 * Shared-DB password reset / bootstrap guards must refuse tenant mutations
 * unless ALLOW_DB_PASSWORD_RESET is set (or --allow-tenant-reset for bootstrap).
 * Run: npm run test:db-password-guard
 */
'use strict';

const assert = require('assert');
const {
  TENANT_EMAILS_743,
  passwordResetAllowed,
  assertPasswordResetAllowed,
  assertBootstrapAllowed,
} = require('../src/utils/db-password-guard');

const prev = process.env.ALLOW_DB_PASSWORD_RESET;
delete process.env.ALLOW_DB_PASSWORD_RESET;

assert.strictEqual(passwordResetAllowed(), false);
assert.ok(TENANT_EMAILS_743.has('buckleystone1@gmail.com'));
assert.ok(TENANT_EMAILS_743.has('isaiahreese13@outlook.com'));

// Non-tenant email: allowed without env (staff/dev accounts)
assert.doesNotThrow(() =>
  assertPasswordResetAllowed({ targetEmail: 'manager@example.com' })
);

// Real tenant without override: blocked
{
  let threw = null;
  try {
    assertPasswordResetAllowed({ targetEmail: 'BuckleyStone1@gmail.com' });
  } catch (err) {
    threw = err;
  }
  assert.ok(threw);
  assert.strictEqual(threw.code, 'TENANT_PASSWORD_PROTECTED');
}

// Tenant + --allow-tenant-reset: allowed without env
assert.doesNotThrow(() =>
  assertPasswordResetAllowed({
    targetEmail: 'isaiahreese13@outlook.com',
    argv: ['--allow-tenant-reset'],
  })
);

// Bootstrap blocked without env / flag
{
  let threw = null;
  try {
    assertBootstrapAllowed([]);
  } catch (err) {
    threw = err;
  }
  assert.ok(threw);
  assert.strictEqual(threw.code, 'BOOTSTRAP_BLOCKED');
}

// Bootstrap allowed via argv even without env
assert.doesNotThrow(() => assertBootstrapAllowed(['--allow-tenant-reset']));

// Env opt-in unlocks both tenant reset and bootstrap
process.env.ALLOW_DB_PASSWORD_RESET = '1';
assert.strictEqual(passwordResetAllowed(), true);
assert.doesNotThrow(() =>
  assertPasswordResetAllowed({ targetEmail: 'buckleystone1@gmail.com' })
);
assert.doesNotThrow(() => assertBootstrapAllowed([]));

process.env.ALLOW_DB_PASSWORD_RESET = 'true';
assert.strictEqual(passwordResetAllowed(), true);

if (prev === undefined) delete process.env.ALLOW_DB_PASSWORD_RESET;
else process.env.ALLOW_DB_PASSWORD_RESET = prev;

console.log('test-db-password-guard: OK');
