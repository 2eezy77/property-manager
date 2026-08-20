#!/usr/bin/env node
/**
 * Partner error sanitization must never leak access_token into API responses.
 * Run: npm run test:plaid-errors
 */
'use strict';

const assert = require('assert');
const { partnerErrorMessage } = require('../src/utils/plaid-errors');

assert.strictEqual(
  partnerErrorMessage(
    { response: { data: { error_message: 'ITEM_LOGIN_REQUIRED' } } },
    'fallback'
  ),
  'ITEM_LOGIN_REQUIRED'
);

assert.strictEqual(
  partnerErrorMessage(
    { response: { data: { display_message: 'Reconnect your bank' } } },
    'fallback'
  ),
  'Reconnect your bank'
);

assert.strictEqual(
  partnerErrorMessage(
    { type: 'StripeInvalidRequestError', message: 'No such customer' },
    'fallback'
  ),
  'No such customer'
);

assert.strictEqual(
  partnerErrorMessage({ message: 'network timeout' }, 'fallback'),
  'network timeout'
);

// Token-bearing messages must be replaced with the safe fallback
assert.strictEqual(
  partnerErrorMessage(
    { message: 'Invalid access_token provided: access-sandbox-abc' },
    'Bank link failed'
  ),
  'Bank link failed'
);

assert.strictEqual(
  partnerErrorMessage({}, 'Bank link failed'),
  'Bank link failed'
);

console.log('test-plaid-errors: OK');
