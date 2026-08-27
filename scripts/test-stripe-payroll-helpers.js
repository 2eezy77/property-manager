#!/usr/bin/env node
/**
 * Unit checks for Stripe Connect payroll error mapping and PaymentIntent cancel/status.
 * Run: node scripts/test-stripe-payroll-helpers.js
 */
const {
  wrapStripePayrollError,
  mapStripeStatus,
  isCancellablePayrollIntent,
  payrollProcessingDetails,
} = require('../src/utils/stripe-payroll-helpers');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const connectOff = wrapStripePayrollError(new Error('You must be signed up for Connect'));
assert(connectOff.code === 'CONNECT_NOT_ENABLED', 'Connect not enabled → CONNECT_NOT_ENABLED');
assert(connectOff.statusCode === 503, 'Connect not enabled → 503');
assert(/Connect → Get started/i.test(connectOff.message), 'Connect not enabled has dashboard guidance');

const onboarding = wrapStripePayrollError(
  new Error('insufficient_capabilities_for_transfer for this account')
);
assert(onboarding.code === 'CONNECT_ONBOARDING_REQUIRED', 'capabilities → CONNECT_ONBOARDING_REQUIRED');
assert(onboarding.statusCode === 503, 'capabilities → 503');
assert(/finish Connect onboarding/i.test(onboarding.message), 'capabilities message points at onboarding');

const other = new Error('card_declined');
assert(wrapStripePayrollError(other) === other, 'unrelated Stripe errors pass through');
assert(wrapStripePayrollError(null) === null, 'null error passes through');

assert(mapStripeStatus('succeeded') === 'paid', 'succeeded → paid');
assert(mapStripeStatus('canceled') === 'failed', 'canceled → failed');
assert(mapStripeStatus('processing') === 'processing', 'processing stays processing');
assert(mapStripeStatus('requires_action') === 'processing', 'requires_action → processing');
assert(mapStripeStatus('requires_payment_method') === 'processing', 'requires_payment_method → processing');

assert(isCancellablePayrollIntent({ status: 'requires_action' }) === true, 'requires_action cancellable');
assert(isCancellablePayrollIntent({ status: 'requires_payment_method' }) === true, 'requires_payment_method cancellable');
assert(isCancellablePayrollIntent({ status: 'requires_confirmation' }) === true, 'requires_confirmation cancellable');
assert(isCancellablePayrollIntent({ status: 'canceled' }) === true, 'canceled treated cancellable for cleanup');
assert(isCancellablePayrollIntent({ status: 'processing' }) === false, 'processing not cancellable');
assert(isCancellablePayrollIntent({ status: 'succeeded' }) === false, 'succeeded not cancellable');
assert(isCancellablePayrollIntent(null) === false, 'null intent not cancellable');
assert(isCancellablePayrollIntent({}) === false, 'missing status not cancellable');

assert(payrollProcessingDetails(null) === null, 'null PI → null details');
const details = payrollProcessingDetails({
  status: 'requires_action',
  next_action: {
    verify_with_microdeposits: { hosted_verification_url: 'https://verify.example/md' },
  },
  last_payment_error: { message: 'Bank declined' },
});
assert(details.stripeStatus === 'requires_action', 'details expose stripe status');
assert(details.canCancel === true, 'requires_action details canCancel');
assert(details.verificationUrl === 'https://verify.example/md', 'microdeposit verification URL');
assert(details.failureReason === 'Bank declined', 'last_payment_error message');

const processing = payrollProcessingDetails({ status: 'processing' });
assert(processing.canCancel === false, 'processing details cannot cancel');
assert(processing.verificationUrl === null, 'no verification URL when absent');
assert(processing.failureReason === null, 'no failure reason when absent');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll stripe-payroll-helpers checks passed.');
