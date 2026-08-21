/**
 * Pure helpers for Stripe PaymentIntent / Charge webhook handling.
 * Keep settlement idempotency and method detection out of the Express router.
 */

'use strict';

function isIdentityEvent(type) {
  return Boolean(type?.startsWith('identity.verification_session.'));
}

function paymentMethodFromIntent(pi) {
  if (pi?.payment_method_types?.includes('cashapp')) return 'cash_app';
  if (pi?.payment_method_types?.includes('us_bank_account')) return 'ach';
  if (pi?.payment_method_types?.includes('card')) return 'card';
  return null;
}

function chargeIdFromIntent(pi) {
  if (!pi) return null;
  return typeof pi.latest_charge === 'string'
    ? pi.latest_charge
    : pi.latest_charge?.id ?? null;
}

/**
 * Normalize a Charge object into the PaymentIntent-shaped fields settlement uses.
 */
function paymentIntentLikeFromCharge(charge) {
  const type = charge?.payment_method_details?.type;
  const payment_method_types =
    type === 'cashapp' ? ['cashapp']
    : type === 'card' ? ['card']
    : type === 'us_bank_account' ? ['us_bank_account']
    : [];
  return {
    id: charge?.payment_intent || charge?.id,
    latest_charge: charge?.id,
    metadata: charge?.metadata || {},
    payment_method_types,
  };
}

/**
 * Skip duplicate webhook deliveries; never re-settle an already-succeeded payment.
 */
function shouldSkipIntentWebhook(payment, eventId) {
  if (!payment) return { skip: true, reason: 'no_payment_row' };
  if (payment.status === 'succeeded') return { skip: true, reason: 'already_succeeded' };
  if (payment.stripe_webhook_event_id === eventId) return { skip: true, reason: 'duplicate_event' };
  return { skip: false };
}

module.exports = {
  isIdentityEvent,
  paymentMethodFromIntent,
  chargeIdFromIntent,
  paymentIntentLikeFromCharge,
  shouldSkipIntentWebhook,
};
