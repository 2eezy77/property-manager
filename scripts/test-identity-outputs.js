#!/usr/bin/env node
/**
 * Regression: Stripe Identity verified_outputs → collections fail-close.
 * TEST often redacts SSN digits; without a 9-digit id_number the lease must
 * not activate as verified for collections PII.
 *
 * Run: npm run test:identity-outputs
 */
'use strict';

const assert = require('assert');
const {
  statusFromSession,
  isAlertStatus,
  dateOfBirthFromOutputs,
  legalNameFromOutputs,
  idNumberFromOutputs,
  missingCollectionsProfileReason,
} = require('../src/services/tenant-identity.service');

assert.strictEqual(statusFromSession({ status: 'verified' }), 'verified');
assert.strictEqual(statusFromSession({ status: 'processing' }), 'processing');
assert.strictEqual(statusFromSession({ status: 'requires_input' }), 'requires_input');
assert.strictEqual(statusFromSession({ status: 'canceled' }), 'canceled');
assert.strictEqual(statusFromSession({ status: 'foo', last_error: { code: 'x' } }), 'failed');
assert.strictEqual(statusFromSession({ status: 'foo' }), 'requires_input');

assert.strictEqual(isAlertStatus('requires_input'), true);
assert.strictEqual(isAlertStatus('canceled'), true);
assert.strictEqual(isAlertStatus('failed'), true);
assert.strictEqual(isAlertStatus('verified'), false);
assert.strictEqual(isAlertStatus('processing'), false);

assert.strictEqual(
  dateOfBirthFromOutputs({ dob: { year: 1990, month: 3, day: 7 } }),
  '1990-03-07'
);
assert.strictEqual(
  dateOfBirthFromOutputs({ date_of_birth: { year: 2001, month: 12, day: 1 } }),
  '2001-12-01'
);
assert.strictEqual(dateOfBirthFromOutputs({ dob: { year: 1990, month: 3 } }), null);
assert.strictEqual(dateOfBirthFromOutputs({}), null);

assert.strictEqual(legalNameFromOutputs({ name: ' Ada Lovelace ' }), 'Ada Lovelace');
assert.strictEqual(legalNameFromOutputs({ full_name: 'Grace Hopper' }), 'Grace Hopper');
assert.strictEqual(
  legalNameFromOutputs({ first_name: 'Alan', last_name: 'Turing' }),
  'Alan Turing'
);
assert.strictEqual(legalNameFromOutputs({ first_name: 'Solo' }), 'Solo');
assert.strictEqual(legalNameFromOutputs({}), null);

assert.strictEqual(idNumberFromOutputs({ id_number: '123-45-6789' }), '123-45-6789');
assert.strictEqual(idNumberFromOutputs({ ssn: '987654321' }), '987654321');
assert.strictEqual(idNumberFromOutputs({ id_number: { value: '111223333' } }), '111223333');
assert.strictEqual(idNumberFromOutputs({ id_number: { number: '444556666' } }), '444556666');
assert.strictEqual(idNumberFromOutputs({}), null);

assert.strictEqual(
  missingCollectionsProfileReason({ id_number: '123456789' }),
  'Stripe Identity verified the session without legal name output.'
);

assert.match(
  missingCollectionsProfileReason({ name: 'Test User', id_number: '*****6789' }),
  /without SSN\/id_number/
);

assert.match(
  missingCollectionsProfileReason({ name: 'Test User', id_number: { value: '12345' } }),
  /without SSN\/id_number/
);

assert.strictEqual(
  missingCollectionsProfileReason({
    name: 'Test User',
    id_number: '123-45-6789',
  }),
  null,
  'formatted 9-digit SSN is accepted'
);

assert.strictEqual(
  missingCollectionsProfileReason({
    first_name: 'Test',
    last_name: 'User',
    id_number: { value: '123456789' },
  }),
  null,
  'object id_number.value with name parts is accepted'
);

console.log('test-identity-outputs: OK');
