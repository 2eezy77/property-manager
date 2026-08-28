#!/usr/bin/env node
/**
 * Staff Identity alerts must never echo SSN-shaped strings from Stripe reasons.
 * Run: node scripts/test-identity-alert-redact.js
 */
'use strict';

const {
  humanStatus,
  redactSensitive,
  render,
} = require('../src/services/email-templates/identityVerificationAlert');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(humanStatus('requires_input') === 'requires input', 'underscores become spaces');
check(humanStatus(null) === 'requires input', 'null status defaults to requires input');
check(humanStatus('verified') === 'verified', 'plain status passes through');

check(redactSensitive(null) == null, 'null reason stays null');
check(redactSensitive('') === '', 'empty reason stays empty');
check(
  redactSensitive('SSN 123-45-6789 on file') === 'SSN [redacted] on file',
  'hyphenated SSN is redacted'
);
check(
  redactSensitive('id 123 45 6789 mismatch') === 'id [redacted] mismatch',
  'spaced SSN is redacted'
);
check(
  redactSensitive('digits 123456789 only') === 'digits [redacted] only',
  'compact 9-digit SSN is redacted'
);
check(
  redactSensitive('Phone 757-555-0100 is fine') === 'Phone 757-555-0100 is fine',
  'non-SSN phone pattern is not redacted'
);

const leaked = render({
  tenantName: 'Test Tenant',
  tenantEmail: 'tenant@example.com',
  status: 'requires_input',
  reason: 'Document SSN 321-54-9876 did not match',
  unitLabel: 'Unit 2',
  propertyName: '743 A Ave',
});
check(!/321-54-9876/.test(leaked.text), 'rendered text excludes raw SSN');
check(!/321-54-9876/.test(leaked.html), 'rendered html excludes raw SSN');
check(/\[redacted\]/.test(leaked.text), 'rendered text keeps [redacted] marker');
check(/requires input/.test(leaked.text), 'rendered text uses human status');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll identity-alert redact checks passed.');
