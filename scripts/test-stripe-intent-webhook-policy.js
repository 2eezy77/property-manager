#!/usr/bin/env node
/**
 * Unit checks for Stripe PaymentIntent/Charge webhook pure helpers.
 * Run: node scripts/test-stripe-intent-webhook-policy.js
 */
'use strict';

const assert = require('assert');
const {
  isIdentityEvent,
  paymentMethodFromIntent,
  chargeIdFromIntent,
  paymentIntentLikeFromCharge,
  shouldSkipIntentWebhook,
} = require('../src/utils/stripe-intent-webhook-policy');

assert.strictEqual(isIdentityEvent('identity.verification_session.verified'), true);
assert.strictEqual(isIdentityEvent('identity.verification_session.canceled'), true);
assert.strictEqual(isIdentityEvent('payment_intent.succeeded'), false);
assert.strictEqual(isIdentityEvent(undefined), false);

assert.strictEqual(
  paymentMethodFromIntent({ payment_method_types: ['cashapp'] }),
  'cash_app'
);
assert.strictEqual(
  paymentMethodFromIntent({ payment_method_types: ['us_bank_account'] }),
  'ach'
);
assert.strictEqual(
  paymentMethodFromIntent({ payment_method_types: ['card'] }),
  'card'
);
assert.strictEqual(
  paymentMethodFromIntent({ payment_method_types: ['cashapp', 'card'] }),
  'cash_app',
  'Cash App wins when listed first among types'
);
assert.strictEqual(paymentMethodFromIntent({ payment_method_types: [] }), null);
assert.strictEqual(paymentMethodFromIntent(null), null);

assert.strictEqual(chargeIdFromIntent({ latest_charge: 'ch_abc' }), 'ch_abc');
assert.strictEqual(chargeIdFromIntent({ latest_charge: { id: 'ch_obj' } }), 'ch_obj');
assert.strictEqual(chargeIdFromIntent({}), null);

{
  const like = paymentIntentLikeFromCharge({
    id: 'ch_1',
    payment_intent: 'pi_1',
    metadata: { payment_type: 'utility' },
    payment_method_details: { type: 'cashapp' },
  });
  assert.strictEqual(like.id, 'pi_1');
  assert.strictEqual(like.latest_charge, 'ch_1');
  assert.deepStrictEqual(like.payment_method_types, ['cashapp']);
  assert.strictEqual(like.metadata.payment_type, 'utility');
  assert.strictEqual(
    paymentMethodFromIntent(like),
    'cash_app',
    'charge→intent shape still detects Cash App'
  );
}

{
  const cardLike = paymentIntentLikeFromCharge({
    id: 'ch_card',
    payment_method_details: { type: 'card' },
  });
  assert.strictEqual(cardLike.id, 'ch_card', 'charge without PI uses charge id');
  assert.strictEqual(paymentMethodFromIntent(cardLike), 'card');
}

assert.deepStrictEqual(
  shouldSkipIntentWebhook(null, 'evt_1'),
  { skip: true, reason: 'no_payment_row' }
);
assert.deepStrictEqual(
  shouldSkipIntentWebhook({ status: 'succeeded', stripe_webhook_event_id: 'evt_old' }, 'evt_2'),
  { skip: true, reason: 'already_succeeded' }
);
assert.deepStrictEqual(
  shouldSkipIntentWebhook({ status: 'processing', stripe_webhook_event_id: 'evt_dup' }, 'evt_dup'),
  { skip: true, reason: 'duplicate_event' }
);
assert.deepStrictEqual(
  shouldSkipIntentWebhook({ status: 'processing', stripe_webhook_event_id: 'evt_old' }, 'evt_new'),
  { skip: false }
);

console.log('test-stripe-intent-webhook-policy: ok');
