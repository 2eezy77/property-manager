/**
 * Server-side guard so two overlapping tenant rent charges cannot both succeed.
 * Used by prepareTenantCharge (ACH / card / Cash App / Link share this path).
 */

/** Stripe PI statuses that mean a charge is already confirming or finished. */
const IN_FLIGHT_CONFIRM_STATUSES = new Set([
  'requires_confirmation',
  'requires_action',
  'requires_capture',
  'processing',
  'succeeded',
]);

function assertRentPeriodAvailable({ processingCount = 0, remainingDue = 0 } = {}) {
  if (Number(processingCount) > 0) {
    const err = new Error('A rent payment is already in progress.');
    err.code = 'DUPLICATE_PAYMENT';
    throw err;
  }
  if (Number(remainingDue) <= 0.009) {
    const err = new Error('This period is already paid. Refresh to see your updated balance.');
    err.code = 'NOTHING_DUE';
    throw err;
  }
}

/**
 * Transaction-scoped lock. Safe with PgBouncer/Supabase transaction poolers
 * (session-level pg_advisory_lock is not).
 */
async function lockRentChargePeriod(client, leaseId, periodStart) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
    [`lease:${leaseId}`, `rent:${periodStart}`]
  );
}

function stripeIdempotencyKey({ method, paymentId, attempt = 1 }) {
  const key = `rent-${method}-${paymentId}-a${attempt}`;
  return key.length <= 255 ? key : key.slice(0, 255);
}

module.exports = {
  IN_FLIGHT_CONFIRM_STATUSES,
  assertRentPeriodAvailable,
  lockRentChargePeriod,
  stripeIdempotencyKey,
};
