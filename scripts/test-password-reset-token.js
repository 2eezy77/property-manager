#!/usr/bin/env node
/**
 * Password-reset link token helpers (shape, hash, URL, DB-row validity).
 * Run: node scripts/test-password-reset-token.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  hashResetToken,
  resetUrlForToken,
  isValidResetTokenRaw,
  isResetTokenRecordValid,
  MIN_RESET_TOKEN_LENGTH,
  RESET_TTL_MS,
} = require('../src/services/password-reset.service');

assert.strictEqual(MIN_RESET_TOKEN_LENGTH, 32);
assert.ok(RESET_TTL_MS === 60 * 60 * 1000);

assert.strictEqual(isValidResetTokenRaw(null), false);
assert.strictEqual(isValidResetTokenRaw(''), false);
assert.strictEqual(isValidResetTokenRaw('   '), false);
assert.strictEqual(isValidResetTokenRaw('a'.repeat(31)), false);
assert.strictEqual(isValidResetTokenRaw('a'.repeat(32)), true);
assert.strictEqual(isValidResetTokenRaw(`  ${'b'.repeat(32)}  `), true);

const raw = crypto.randomBytes(32).toString('hex');
const hash = hashResetToken(raw);
assert.strictEqual(hash.length, 64);
assert.strictEqual(hashResetToken(raw), hash, 'hash is deterministic');
assert.notStrictEqual(hashResetToken(`${raw}x`), hash, 'different raw → different hash');

const url = resetUrlForToken(raw);
assert.ok(url.includes('/reset-password?token='), 'reset path');
assert.ok(url.includes(encodeURIComponent(raw)), 'token is URL-encoded');
assert.ok(!url.includes('&next='), 'forgot-password link has no lease next');

const now = new Date('2026-08-24T12:00:00Z');
assert.strictEqual(isResetTokenRecordValid(null, now), false);
assert.strictEqual(
  isResetTokenRecordValid({ is_active: false, expires_at: '2026-08-24T13:00:00Z' }, now),
  false,
  'inactive user'
);
assert.strictEqual(
  isResetTokenRecordValid({
    is_active: true,
    used_at: '2026-08-24T11:00:00Z',
    expires_at: '2026-08-24T13:00:00Z',
  }, now),
  false,
  'already used'
);
assert.strictEqual(
  isResetTokenRecordValid({
    is_active: true,
    used_at: null,
    expires_at: '2026-08-24T11:59:59Z',
  }, now),
  false,
  'expired'
);
assert.strictEqual(
  isResetTokenRecordValid({
    is_active: true,
    used_at: null,
    expires_at: '2026-08-24T12:00:00Z',
  }, now),
  true,
  'expires exactly now still valid'
);
assert.strictEqual(
  isResetTokenRecordValid({
    is_active: true,
    used_at: null,
    expires_at: '2026-08-24T13:00:00Z',
  }, now),
  true,
  'future expiry'
);

console.log('test-password-reset-token: ok');
