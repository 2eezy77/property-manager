#!/usr/bin/env node
/**
 * Stripe account restriction error matcher (card/Cash App create-intent).
 * Run: node scripts/test-stripe-account-restriction.js
 */
'use strict';

const assert = require('assert');
const {
  isStripeAccountRestrictionError,
} = require('../src/utils/stripe-account-restriction');

assert.strictEqual(
  isStripeAccountRestrictionError({
    code: 'account_invalid',
    message: 'Your account cannot currently make charges (charges_enabled=false).',
  }),
  true,
  'charges_enabled in message'
);

assert.strictEqual(
  isStripeAccountRestrictionError({
    message: 'This account is restricted and cannot accept payments.',
  }),
  true,
  'account restricted phrasing'
);

assert.strictEqual(
  isStripeAccountRestrictionError({
    raw: { message: 'transfers capability is inactive' },
  }),
  true,
  'capability via raw.message'
);

assert.strictEqual(
  isStripeAccountRestrictionError({
    code: 'card_declined',
    message: 'Your card was declined.',
  }),
  false,
  'ordinary decline is not a restriction'
);

assert.strictEqual(
  isStripeAccountRestrictionError(null),
  false,
  'null err is false'
);

assert.strictEqual(
  isStripeAccountRestrictionError({}),
  false,
  'empty err is false'
);

console.log('All stripe-account-restriction checks passed.');
