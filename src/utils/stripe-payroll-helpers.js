/**
 * Pure Stripe Connect / PaymentIntent helpers for associate payroll
 * and manager lease-signing ACH fee charges.
 */

function wrapStripePayrollError(err) {
  const msg = err?.message || '';
  if (/signed up for Connect/i.test(msg)) {
    const e = new Error(
      'Stripe Connect is not enabled yet. In your live Stripe dashboard open Connect → Get started, ' +
      'complete platform setup, then retry Pay via ACH. dashboard.stripe.com/connect'
    );
    e.statusCode = 503;
    e.code = 'CONNECT_NOT_ENABLED';
    return e;
  }
  if (/insufficient_capabilities_for_transfer/i.test(msg)) {
    const e = new Error(
      'Manager Stripe payout setup is incomplete. Konstantin must finish Connect onboarding ' +
      'on his Boots on site page before ACH payroll can run.'
    );
    e.statusCode = 503;
    e.code = 'CONNECT_ONBOARDING_REQUIRED';
    return e;
  }
  return err;
}

function mapStripeStatus(piStatus) {
  if (piStatus === 'succeeded') return 'paid';
  if (piStatus === 'canceled') return 'failed';
  return 'processing';
}

function isCancellablePayrollIntent(pi) {
  if (!pi?.status) return false;
  return ['requires_action', 'requires_payment_method', 'requires_confirmation', 'canceled'].includes(pi.status);
}

function payrollProcessingDetails(pi) {
  if (!pi) return null;
  const verificationUrl = pi.next_action?.verify_with_microdeposits?.hosted_verification_url || null;
  return {
    stripeStatus: pi.status,
    canCancel: isCancellablePayrollIntent(pi),
    verificationUrl,
    failureReason: pi.last_payment_error?.message || null,
  };
}

module.exports = {
  wrapStripePayrollError,
  mapStripeStatus,
  isCancellablePayrollIntent,
  payrollProcessingDetails,
};
