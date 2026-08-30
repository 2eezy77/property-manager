#!/usr/bin/env node
/**
 * Dominion MFA OTP extraction: labeled 6-digit codes, short-body fallback,
 * and MFA vs routine bill filtering (avoid account-number false positives).
 *
 * Run: npm run test:dominion-otp-extract
 */
'use strict';

const { extractCode, looksLikeMfa } = require('../src/utils/dominion-otp');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(extractCode('Your verification code is: 482917') === '482917', 'verification code labeled');
check(extractCode('security code 119200') === '119200', 'security code labeled');
check(extractCode('Your code is 334455') === '334455', 'your code is');
check(extractCode('482917 is your authentication code') === '482917', 'code before label');
check(extractCode('Please enter this code: 908172') === '908172', 'enter this code');
check(extractCode('one-time code: 555666') === '555666', 'one-time hyphenated');

check(extractCode('OTP 123456') === '123456', 'short body lone 6-digit fallback');
check(
  extractCode(`Current Charges $293.69. Account 123456789. Due ${'x'.repeat(900)}`) === null,
  'long bill body with digits is not treated as OTP'
);
check(extractCode('codes 111111 and 222222') === null, 'ambiguous multi-code short body returns null');
check(extractCode('') === null, 'empty text returns null');
check(extractCode(null) === null, 'null text returns null');

check(looksLikeMfa('Dominion Energy verification code'), 'subject looks like MFA');
check(looksLikeMfa('Your one-time login code'), 'one-time login looks like MFA');
check(looksLikeMfa('security code for sign-in'), 'security + sign-in looks like MFA');
check(!looksLikeMfa('Your Dominion Energy bill is ready. Current Charges $293.69'),
  'routine bill email is not MFA');
check(!looksLikeMfa('Account ending in 123456'), 'account fragment alone is not MFA');

// Combined gate used by fetch-email-otp: extract + MFA lookalike
function accept(blob) {
  const code = extractCode(blob);
  if (!code) return null;
  if (!looksLikeMfa(blob)) return null;
  return code;
}
check(
  accept('Your verification code is 482917 for Dominion Energy sign-in') === '482917',
  'MFA email accepted'
);
check(
  accept('Current Charges $293.69. Amount Due $731.70. Account 482917.') === null,
  'bill with 6-digit fragment rejected without MFA language'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll dominion-otp-extract checks passed.');
