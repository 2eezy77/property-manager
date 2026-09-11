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

/**
 * Shared floor for every tenant portal method (ACH charge, bank checkout,
 * Cash App, card). `-a1` keys were consumed in production with create params
 * that no longer match (PMC+types, then types-only) or with PaymentIntents
 * that later canceled/expired. Reusing `-a1` returns the dead PI or
 * StripeIdempotencyError. Bump this integer — not a per-tenant special case —
 * if a future param change poisons `-a2`.
 */
const RENT_IDEMPOTENCY_KEY_VERSION = 2;
const ACH_IDEMPOTENCY_KEY_VERSION = RENT_IDEMPOTENCY_KEY_VERSION;
const CASHAPP_IDEMPOTENCY_KEY_VERSION = RENT_IDEMPOTENCY_KEY_VERSION;
const CARD_IDEMPOTENCY_KEY_VERSION = RENT_IDEMPOTENCY_KEY_VERSION;

function paymentIntentHasCharge(pi) {
  if (!pi) return false;
  if (pi.latest_charge) return true;
  if (Number(pi.amount_received || 0) > 0) return true;
  return false;
}

function isUnusedOpenCheckoutIntent(pi) {
  return Boolean(
    pi
    && pi.status === 'requires_payment_method'
    && !paymentIntentHasCharge(pi)
  );
}

/**
 * pending + PI that is confirming or already charged is in-flight.
 * Unused requires_payment_method with no charge is replaceable (Lily unused
 * bank checkout). Billing invoices with no PI are not in-flight. Canceled /
 * declined PIs can be replaced.
 */
function classifyOpenRentCharge(row = {}, pi = null) {
  if (row.status === 'processing') return 'in_flight';
  if (row.status === 'succeeded') return 'paid';
  if (!row.stripe_payment_intent_id) return 'open_invoice';
  if (!pi) return 'in_flight';
  if (pi.status === 'succeeded') return 'paid';
  if (pi.status === 'canceled') return 'released';
  if (isUnusedOpenCheckoutIntent(pi)) return 'released';
  if (pi.status === 'requires_payment_method' && pi.last_payment_error) return 'released';
  return 'in_flight';
}

function assertRentPeriodAvailable({
  processingCount = 0,
  pendingOpenCount = 0,
  remainingDue = 0,
} = {}) {
  if (Number(processingCount) + Number(pendingOpenCount) > 0) {
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

function methodKeyVersionFloor(method) {
  if (method === 'ach' || method === 'ach-to') return ACH_IDEMPOTENCY_KEY_VERSION;
  if (method === 'cashapp') return CASHAPP_IDEMPOTENCY_KEY_VERSION;
  if (method === 'card') return CARD_IDEMPOTENCY_KEY_VERSION;
  return RENT_IDEMPOTENCY_KEY_VERSION;
}

/** Highest key suffix any portal method will actually send. */
function rentIdempotencyKeyFloor() {
  return RENT_IDEMPOTENCY_KEY_VERSION;
}

/**
 * Stripe key suffix already consumed for this obligation. A stored attempt
 * of 1 still used `-a2` once the portal floor applied, so treat that as 2.
 */
function maxConsumedIntentAttempt(rows = []) {
  let maxStored = 0;
  for (const row of rows) {
    const n = Number((row.metadata || {}).stripe_intent_attempt);
    if (Number.isFinite(n) && n > maxStored) maxStored = n;
  }
  if (maxStored <= 0) return 0;
  return Math.max(maxStored, rentIdempotencyKeyFloor());
}

/**
 * Next stripe_intent_attempt for a rent or deposit obligation. Reads every
 * row (parent + failed partials) so a canceled/expired checkout advances
 * the counter for the next tenant instead of restarting at 1.
 * Persist this value (not raw 1) so a full-remaining retry cannot reuse
 * the floored `-a2` key with different PaymentIntent metadata.
 */
function nextRentIntentAttempt(rows = []) {
  const consumed = maxConsumedIntentAttempt(rows);
  if (consumed <= 0) return rentIdempotencyKeyFloor();
  return consumed + 1;
}

/**
 * Value to persist after Stripe finishes a PaymentIntent (failed / canceled).
 * Empty metadata still consumed the floored key on create.
 */
function recordConsumedIntentAttempt(metadata = {}) {
  const consumed = maxConsumedIntentAttempt([{ metadata }]);
  return {
    stripe_intent_attempt: consumed > 0 ? consumed : rentIdempotencyKeyFloor(),
  };
}

function stripeIdempotencyKey({ method, paymentId, attempt = 1 }) {
  const n = Number(attempt) || 1;
  const floored = Math.max(n, methodKeyVersionFloor(method));
  const key = `rent-${method}-${paymentId}-a${floored}`;
  return key.length <= 255 ? key : key.slice(0, 255);
}

module.exports = {
  IN_FLIGHT_CONFIRM_STATUSES,
  RENT_IDEMPOTENCY_KEY_VERSION,
  ACH_IDEMPOTENCY_KEY_VERSION,
  CASHAPP_IDEMPOTENCY_KEY_VERSION,
  CARD_IDEMPOTENCY_KEY_VERSION,
  paymentIntentHasCharge,
  isUnusedOpenCheckoutIntent,
  classifyOpenRentCharge,
  assertRentPeriodAvailable,
  lockRentChargePeriod,
  methodKeyVersionFloor,
  rentIdempotencyKeyFloor,
  maxConsumedIntentAttempt,
  nextRentIntentAttempt,
  recordConsumedIntentAttempt,
  stripeIdempotencyKey,
};
