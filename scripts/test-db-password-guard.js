#!/usr/bin/env node
/**
 * Unit checks for shared-DB password reset / bootstrap guards.
 */
const {
  TENANT_EMAILS_743,
  passwordResetAllowed,
  assertPasswordResetAllowed,
  assertBootstrapAllowed,
} = require('../src/utils/db-password-guard');

let failed = 0;
const prev = process.env.ALLOW_DB_PASSWORD_RESET;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

function withEnv(value, fn) {
  if (value === undefined) delete process.env.ALLOW_DB_PASSWORD_RESET;
  else process.env.ALLOW_DB_PASSWORD_RESET = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ALLOW_DB_PASSWORD_RESET;
    else process.env.ALLOW_DB_PASSWORD_RESET = prev;
  }
}

assert('protects known tenants', TENANT_EMAILS_743.has('buckleystone1@gmail.com'));
assert('protects isaiah', TENANT_EMAILS_743.has('isaiahreese13@outlook.com'));
assert('protects davontaye', TENANT_EMAILS_743.has('davontayegara95@gmail.com'));

withEnv(undefined, () => {
  assert('disallowed without flag', passwordResetAllowed() === false);

  let threw = null;
  try {
    assertPasswordResetAllowed({ targetEmail: 'BuckleyStone1@gmail.com' });
  } catch (err) {
    threw = err;
  }
  assert('blocks tenant reset', threw?.code === 'TENANT_PASSWORD_PROTECTED', threw?.code);

  threw = null;
  try {
    assertPasswordResetAllowed({
      targetEmail: 'buckleystone1@gmail.com',
      argv: ['--allow-tenant-reset'],
    });
  } catch (err) {
    threw = err;
  }
  assert(
    'tenant reset allowed with --allow-tenant-reset',
    threw === null,
    threw?.message
  );

  threw = null;
  try {
    assertPasswordResetAllowed({ targetEmail: 'staff@example.com' });
  } catch (err) {
    threw = err;
  }
  assert('allows non-tenant email without flag', threw === null, threw?.message);

  threw = null;
  try {
    assertBootstrapAllowed([]);
  } catch (err) {
    threw = err;
  }
  assert('blocks bootstrap', threw?.code === 'BOOTSTRAP_BLOCKED', threw?.code);

  threw = null;
  try {
    assertBootstrapAllowed(['--allow-tenant-reset']);
  } catch (err) {
    threw = err;
  }
  assert('bootstrap allowed with argv opt-in', threw === null, threw?.message);
});

withEnv('1', () => {
  assert('allowed with 1', passwordResetAllowed() === true);
  let threw = null;
  try {
    assertPasswordResetAllowed({ targetEmail: 'buckleystone1@gmail.com' });
    assertBootstrapAllowed([]);
  } catch (err) {
    threw = err;
  }
  assert('ALLOW=1 bypasses guards', threw === null, threw?.message);
});

withEnv('true', () => {
  assert('allowed with true', passwordResetAllowed() === true);
});

withEnv('yes', () => {
  assert('rejects other truthy strings', passwordResetAllowed() === false);
});

process.exit(failed ? 1 : 0);
