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
 * Floor for ACH / bank-checkout keys after PR 105. Live key
 * `rent-ach-<lily-payment>-a1` was first used with PMC+types params; Stripe
 * then rejected the types-only / saved-ba_ create with StripeIdempotencyError.
 * Bank create-intent `ach-to` is versioned the same way so a canceled unused
 * checkout PI is not replayed from the prior successful idempotency cache.
 */
const ACH_IDEMPOTENCY_KEY_VERSION = 2;

/**
 * Floor for Cash App Pay keys after Stone 2026-09-11. Live key
 * `rent-cashapp-<stone-420>-a1` created pi_3UEVPx… which expired without
 * approval. Reusing -a1 returns that dead PI (or StripeIdempotencyError if
 * create params changed). Version with ACH so a retry cannot replay -a1.
 */
const CASHAPP_IDEMPOTENCY_KEY_VERSION = 2;

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
  return 1;
}

/**
 * Next stripe_intent_attempt for a rent period. Reads every row (parent +
 * failed partials) so Stone's expired Cash App / superseded ACH attempts
 * advance the counter instead of restarting at 1 on the parent invoice.
 */
function nextRentIntentAttempt(rows = []) {
  let maxAttempt = 0;
  for (const row of rows) {
    const n = Number((row.metadata || {}).stripe_intent_attempt);
    if (Number.isFinite(n) && n > maxAttempt) maxAttempt = n;
  }
  return maxAttempt + 1;
}

function stripeIdempotencyKey({ method, paymentId, attempt = 1 }) {
  const n = Number(attempt) || 1;
  const floored = Math.max(n, methodKeyVersionFloor(method));
  const key = `rent-${method}-${paymentId}-a${floored}`;
  return key.length <= 255 ? key : key.slice(0, 255);
}

module.exports = {
  IN_FLIGHT_CONFIRM_STATUSES,
  ACH_IDEMPOTENCY_KEY_VERSION,
  CASHAPP_IDEMPOTENCY_KEY_VERSION,
  paymentIntentHasCharge,
  isUnusedOpenCheckoutIntent,
  classifyOpenRentCharge,
  assertRentPeriodAvailable,
  lockRentChargePeriod,
  methodKeyVersionFloor,
  nextRentIntentAttempt,
  stripeIdempotencyKey,
};
