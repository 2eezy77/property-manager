#!/usr/bin/env node
/**
 * Unit checks for admin/invite password strength + generated secrets.
 * Run: node scripts/test-password-policy.js
 *
 * Requires DATABASE_URL only because the service module loads the pool;
 * no queries run.
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/db';

const {
  validatePassword,
  generatePassword,
} = require('../src/services/password-admin.service');

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

assert(throwsCode(() => validatePassword('short')) === 'WEAK_PASSWORD', 'rejects under 8 characters');
assert(throwsCode(() => validatePassword('')) === 'WEAK_PASSWORD', 'rejects empty password');
assert(throwsCode(() => validatePassword(null)) === 'WEAK_PASSWORD', 'rejects null password');
assert(throwsCode(() => validatePassword('1234567')) === 'WEAK_PASSWORD', '7 chars is weak');

assert(validatePassword('12345678') === '12345678', 'accepts exactly 8 characters');
assert(validatePassword('long-enough-secret') === 'long-enough-secret', 'accepts longer passwords');

const generated = generatePassword();
assert(generated.length === 14, 'default generated password is 14 chars');
assert(!/[IlO01]/.test(generated), 'generated password avoids ambiguous IlO01 chars');
assert(/^[A-Za-z0-9!@#$]+$/.test(generated), 'generated password stays in allowed charset');

const custom = generatePassword(20);
assert(custom.length === 20, 'generatePassword honors custom length');

const a = generatePassword(16);
const b = generatePassword(16);
assert(a !== b, 'generated passwords are not identical across calls');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll password-policy checks passed.');
