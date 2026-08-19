#!/usr/bin/env node
/**
 * Unit checks for Connect readiness, webhook event allowlist, and ACH sandbox remap.
 * Run: node scripts/test-stripe-connect-webhooks.js
 */
'use strict';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_coverage_placeholder';

const {
  isConnectTransfersActive,
  summarizeConnectAccount,
  normalizeAchNumbers,
  stripeMode,
  isCashAppPayConfigured,
  REQUIRED_WEBHOOK_EVENTS,
  EXTRA_WEBHOOK_EVENTS,
  ALL_WEBHOOK_EVENTS,
  PRODUCTION_WEBHOOK_URLS,
} = require('../src/services/stripe.service');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(isConnectTransfersActive({ capabilities: { transfers: 'active' } }) === true, 'Connect transfers=active is ready for Instant Payouts');
check(isConnectTransfersActive({ capabilities: { transfers: 'pending' } }) === false, 'pending transfers block associate Instant Payouts');
check(isConnectTransfersActive({ capabilities: { transfers: 'inactive' } }) === false, 'inactive transfers are not ready');
check(isConnectTransfersActive(null) === false, 'missing Connect account is not ready');
check(isConnectTransfersActive({}) === false, 'empty Connect account is not ready');

const summary = summarizeConnectAccount({
  id: 'acct_1',
  email: 'mgr@example.com',
  capabilities: { transfers: 'active', card_payments: 'active' },
  details_submitted: true,
  payouts_enabled: true,
  requirements: { currently_due: [], disabled_reason: null },
});
check(summary.transfersActive === true, 'summarizeConnectAccount marks active transfers');
check(summary.payoutsEnabled === true, 'summarizeConnectAccount surfaces payouts_enabled');
check(summary.requirementsDue.length === 0, 'summarizeConnectAccount lists empty requirements');

const blocked = summarizeConnectAccount({
  id: 'acct_2',
  email: 'mgr@example.com',
  capabilities: { transfers: 'pending' },
  details_submitted: false,
  payouts_enabled: false,
  requirements: { currently_due: ['external_account'], disabled_reason: 'requirements.past_due' },
});
check(blocked.transfersActive === false, 'pending Connect is not transfersActive');
check(blocked.requirementsDue.includes('external_account'), 'due requirements are listed');
check(blocked.disabledReason === 'requirements.past_due', 'disabled_reason is preserved');

const required = new Set(REQUIRED_WEBHOOK_EVENTS);
for (const ev of [
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]) {
  check(required.has(ev), `required webhook includes ${ev}`);
}

const extra = new Set(EXTRA_WEBHOOK_EVENTS);
for (const ev of [
  'account.updated',
  'charge.dispute.created',
  'identity.verification_session.verified',
  'identity.verification_session.requires_input',
  'identity.verification_session.canceled',
  'identity.verification_session.processing',
]) {
  check(extra.has(ev), `extra webhook includes ${ev}`);
}

check(
  ALL_WEBHOOK_EVENTS.length === REQUIRED_WEBHOOK_EVENTS.length + EXTRA_WEBHOOK_EVENTS.length,
  'ALL_WEBHOOK_EVENTS is required + extra'
);
check(
  new Set(ALL_WEBHOOK_EVENTS).size === ALL_WEBHOOK_EVENTS.length,
  'webhook allowlist has no duplicates'
);
check(
  PRODUCTION_WEBHOOK_URLS.includes('https://www.monterorentals.com/webhooks/stripe'),
  'production www webhook URL is listed'
);
check(
  PRODUCTION_WEBHOOK_URLS.includes('https://monterorentals.com/webhooks/stripe'),
  'production apex webhook URL is listed'
);

const prevKey = process.env.STRIPE_SECRET_KEY;
const prevPub = process.env.STRIPE_PUBLISHABLE_KEY;
try {
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  const sandbox = normalizeAchNumbers('021000021', '987654321');
  check(sandbox.routingNumber === '110000000', 'test mode remaps routing to Stripe sandbox');
  check(sandbox.accountNumber === '000123456789', 'test mode remaps account to Stripe sandbox');
  check(stripeMode() === 'test', 'sk_test_ reports test mode');

  process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
  const live = normalizeAchNumbers('021000021', '987654321');
  check(live.routingNumber === '021000021', 'live mode keeps real routing numbers');
  check(live.accountNumber === '987654321', 'live mode keeps real account numbers');
  check(stripeMode() === 'live', 'sk_live_ reports live mode');

  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
  check(isCashAppPayConfigured() === true, 'Cash App Pay needs publishable + secret keys');
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  check(isCashAppPayConfigured() === false, 'Cash App Pay is off without publishable key');
} finally {
  process.env.STRIPE_SECRET_KEY = prevKey;
  if (prevPub === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
  else process.env.STRIPE_PUBLISHABLE_KEY = prevPub;
}

if (failed) {
  console.error(`\ntest-stripe-connect-webhooks: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll stripe-connect-webhooks checks passed.');
