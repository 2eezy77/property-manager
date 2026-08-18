#!/usr/bin/env node
/**
 * Regression: activity log body redaction for passwords/tokens.
 *
 * Run: npm run test:activity-sanitize-body
 */
'use strict';

const assert = require('assert');
const { sanitizeBody } = require('../src/services/activity-audit.service');

assert.strictEqual(sanitizeBody(null), null);
assert.strictEqual(sanitizeBody('string'), null);

const redacted = sanitizeBody({
  email: 'a@b.com',
  password: 'secret',
  currentPassword: 'old',
  token: 'tok_123',
  nested: {
    refreshToken: 'rt_456',
    note: 'ok',
  },
  tags: ['keep', 'array'],
});

assert.strictEqual(redacted.email, 'a@b.com');
assert.strictEqual(redacted.password, '[redacted]');
assert.strictEqual(redacted.currentPassword, '[redacted]');
assert.strictEqual(redacted.token, '[redacted]');
assert.strictEqual(redacted.nested.refreshToken, '[redacted]');
assert.strictEqual(redacted.nested.note, 'ok');
assert.deepStrictEqual(redacted.tags, ['keep', 'array']);

console.log('test-activity-sanitize-body: OK');
