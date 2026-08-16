#!/usr/bin/env node
/**
 * Gmail-safe subject sanitization — ASCII only, no emoji/dashes that mojibake.
 * Run: npm run test:email-subject
 */
'use strict';

const assert = require('assert');
const { sanitizeEmailSubject } = require('../src/utils/email-subject');

assert.strictEqual(sanitizeEmailSubject(null), '');
assert.strictEqual(sanitizeEmailSubject(undefined), '');
assert.strictEqual(sanitizeEmailSubject('Rent due'), 'Rent due');

assert.strictEqual(
  sanitizeEmailSubject('Rent — August 2026'),
  'Rent - August 2026'
);
assert.strictEqual(
  sanitizeEmailSubject('Balance – utilities'),
  'Balance - utilities'
);
assert.strictEqual(sanitizeEmailSubject('Fee − $5'), 'Fee - $5');
assert.strictEqual(sanitizeEmailSubject('More…'), 'More...');

assert.strictEqual(
  sanitizeEmailSubject('Payment received 🎉 thanks'),
  'Payment received thanks'
);
assert.strictEqual(
  sanitizeEmailSubject('Café rent 🏠'),
  'Caf rent'
);

assert.strictEqual(
  sanitizeEmailSubject('  Rent   due  \t now  '),
  'Rent due now'
);

console.log('test-email-subject: OK');
