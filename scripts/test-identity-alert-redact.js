#!/usr/bin/env node
/**
 * Stripe Identity staff alerts must redact SSN-shaped strings and escape HTML.
 * Run: node scripts/test-identity-alert-redact.js
 */
'use strict';

const assert = require('assert');
const {
  render,
  humanStatus,
  redactSensitive,
} = require('../src/services/email-templates/identityVerificationAlert');

assert.strictEqual(humanStatus('requires_input'), 'requires input');
assert.strictEqual(humanStatus(null), 'requires input');
assert.strictEqual(humanStatus('verified'), 'verified');

assert.strictEqual(redactSensitive('SSN 123-45-6789 on file'), 'SSN [redacted] on file');
assert.strictEqual(redactSensitive('123 45 6789'), '[redacted]');
assert.strictEqual(redactSensitive('123456789'), '[redacted]');
assert.strictEqual(redactSensitive('no digits here'), 'no digits here');
assert.strictEqual(redactSensitive(''), '');
assert.strictEqual(redactSensitive(null), null);

const withSsn = render({
  tenantName: 'Ada <script>',
  tenantEmail: 'ada@example.com',
  status: 'requires_input',
  reason: 'Document mismatch; SSN 987-65-4321 failed checksum',
  unitLabel: 'Room 2',
  propertyName: '743 A Ave',
});

assert.match(withSsn.subject || withSsn.text, /Identity verification requires input/i);
assert.match(withSsn.text, /\[redacted\]/);
assert.doesNotMatch(withSsn.text, /987-65-4321/);
assert.doesNotMatch(withSsn.html, /987-65-4321/);
assert.match(withSsn.html, /\[redacted\]/);
assert.match(withSsn.html, /Ada &lt;script&gt;/);
assert.doesNotMatch(withSsn.html, /Ada <script>/);
assert.match(withSsn.html, /requires input/);
assert.match(withSsn.text, /No sensitive identity number is included/);

const emptyReason = render({
  tenantName: 'Bo',
  status: 'canceled',
  reason: '',
});
assert.match(emptyReason.text, /Stripe Identity requires staff review/);
assert.match(emptyReason.html, /canceled/);

console.log('ok: identity-alert-redact');
