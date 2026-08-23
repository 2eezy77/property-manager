#!/usr/bin/env node
/**
 * Sandbox ACH number rewrite + Connect transfers capability gate.
 * Run: node scripts/test-stripe-ach-normalize.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_coverage_dummy';

const assert = require('assert');
const {
  normalizeAchNumbers,
  isConnectTransfersActive,
} = require('../src/services/stripe.service');

const prevKey = process.env.STRIPE_SECRET_KEY;

process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
assert.deepStrictEqual(
  normalizeAchNumbers('021000021', '123456789'),
  { routingNumber: '110000000', accountNumber: '000123456789' },
  'test mode rewrites Plaid sandbox numbers to Stripe test ACH'
);

process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
assert.deepStrictEqual(
  normalizeAchNumbers('021000021', '123456789'),
  { routingNumber: '021000021', accountNumber: '123456789' },
  'live mode keeps real routing/account numbers'
);

process.env.STRIPE_SECRET_KEY = prevKey;

assert.strictEqual(
  isConnectTransfersActive({ capabilities: { transfers: 'active' } }),
  true,
  'active transfers capability is ready'
);
assert.strictEqual(
  isConnectTransfersActive({ capabilities: { transfers: 'pending' } }),
  false,
  'pending transfers is not ready'
);
assert.strictEqual(
  isConnectTransfersActive({ capabilities: {} }),
  false,
  'missing transfers capability is not ready'
);
assert.strictEqual(
  isConnectTransfersActive(null),
  false,
  'null account is not ready'
);

console.log('All stripe-ach-normalize checks passed.');
