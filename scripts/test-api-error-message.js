#!/usr/bin/env node
/**
 * Unit checks for payment / API error code → user-facing copy.
 * Wrong mappings hide ACH risk blocks, duplicate charges, or Connect setup.
 * Run: node scripts/test-api-error-message.js
 */
'use strict';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

(async () => {
  const {
    apiErrorMessage,
    PAYMENT_ERROR_MESSAGES,
  } = await import('../client/src/utils/apiErrorMessage.js');

  assert(
    PAYMENT_ERROR_MESSAGES.ACH_RISK_BLOCKED.includes('elevated return risk'),
    'ACH risk block has dedicated copy'
  );
  assert(
    PAYMENT_ERROR_MESSAGES.DUPLICATE_PAYMENT.includes('already in progress'),
    'duplicate payment has dedicated copy'
  );

  assert(
    apiErrorMessage({
      response: { status: 409, data: { error: 'DUPLICATE_PAYMENT' } },
    }) === PAYMENT_ERROR_MESSAGES.DUPLICATE_PAYMENT,
    'maps known payment error codes when message is absent'
  );
  assert(
    apiErrorMessage({
      response: {
        status: 400,
        data: { error: 'ACH_RISK_BLOCKED', message: 'Custom bank message' },
      },
    }) === 'Custom bank message',
    'prefers server message over code fallback'
  );
  assert(
    apiErrorMessage({
      response: { status: 503, data: { error: 'CONNECT_ONBOARDING_REQUIRED' } },
    }) === PAYMENT_ERROR_MESSAGES.CONNECT_ONBOARDING_REQUIRED,
    'maps Connect onboarding required for associate pay'
  );
  assert(
    apiErrorMessage({ code: 'ECONNABORTED' }) === 'Request timed out. Check your connection and try again.',
    'timeouts get connection copy'
  );
  assert(
    apiErrorMessage({ response: { status: 429, data: {} } }) ===
      'Too many requests. Please wait a few minutes and try again.',
    '429 rate limit has dedicated copy'
  );
  assert(
    apiErrorMessage({ response: { status: 403, data: {} } }) ===
      'You do not have permission to perform this action.',
    '403 permission denial has dedicated copy'
  );
  assert(
    apiErrorMessage({ response: { status: 500, data: {} } }) ===
      'The server encountered an error. Please try again later.',
    '5xx gets generic server copy'
  );
  assert(
    apiErrorMessage(null, 'Fallback') === 'Fallback',
    'null error uses caller fallback'
  );
  assert(
    apiErrorMessage({
      response: { status: 400, data: { error: 'something went sideways' } },
    }) === 'something went sideways',
    'non-code error strings are shown as-is'
  );

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll api error message checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
