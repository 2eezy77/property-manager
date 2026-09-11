#!/usr/bin/env node
/**
 * Prevent a second succeeded Stripe charge for the same tenant + lease +
 * billing month + payment_type (the Isaiah 2026-09-01 double card pay).
 *
 * Run: node scripts/test-duplicate-rent-charge.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  assertRentPeriodAvailable,
  lockRentChargePeriod,
  stripeIdempotencyKey,
  classifyOpenRentCharge,
  isUnusedOpenCheckoutIntent,
  ACH_IDEMPOTENCY_KEY_VERSION,
  CASHAPP_IDEMPOTENCY_KEY_VERSION,
  CARD_IDEMPOTENCY_KEY_VERSION,
  RENT_IDEMPOTENCY_KEY_VERSION,
  nextRentIntentAttempt,
  recordConsumedIntentAttempt,
  IN_FLIGHT_CONFIRM_STATUSES,
} = require('../src/services/rent-charge-guard');
const {
  stripeIdempotencyOptions,
  chargeACH,
  createCardPaymentIntent,
  createCashAppPaymentIntent,
  createBankPaymentIntent,
  isStripeIdempotencyError,
  findReusableRentPaymentIntent,
} = require('../src/services/stripe.service');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function expectThrow(fn, code, messageIncludes) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected ${code}`);
  assert.strictEqual(caught.code, code, `expected code ${code}, got ${caught && caught.code}`);
  if (messageIncludes) {
    assert.match(String(caught.message), messageIncludes);
  }
}

// ── Decision table ──────────────────────────────────────────────────────────
expectThrow(
  () => assertRentPeriodAvailable({ processingCount: 1, remainingDue: 450 }),
  'DUPLICATE_PAYMENT',
  /already in progress/i
);
expectThrow(
  () => assertRentPeriodAvailable({ processingCount: 0, remainingDue: 0 }),
  'NOTHING_DUE',
  /already paid/i
);
expectThrow(
  () => assertRentPeriodAvailable({ processingCount: 0, remainingDue: 0.001 }),
  'NOTHING_DUE',
  /already paid/i
);
assert.doesNotThrow(() => assertRentPeriodAvailable({
  processingCount: 0,
  pendingOpenCount: 0,
  remainingDue: 450,
}));
assert.doesNotThrow(() => assertRentPeriodAvailable({
  processingCount: 0,
  remainingDue: 100,
  requestedAmount: 50,
}));
// Isaiah gap: first card create-intent commits as pending, rent still due.
expectThrow(
  () => assertRentPeriodAvailable({
    processingCount: 0,
    pendingOpenCount: 1,
    remainingDue: 450,
  }),
  'DUPLICATE_PAYMENT',
  /already in progress/i
);

assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('processing'));
assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('requires_action'));
assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('requires_confirmation'));
assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('succeeded'));
assert.ok(!IN_FLIGHT_CONFIRM_STATUSES.has('requires_payment_method'));

const paymentId = '11111111-2222-3333-4444-555555555555';
const LILY_PAYMENT_ID = 'f4aaca28-cff8-491f-ba11-d6521aaee4fe';
const STONE_PARENT_ID = '736a6912-4792-4206-8db0-daeaa7c4c4bb';
const STONE_ACH_PAYMENT_ID = 'c5efd11b-fc73-475a-8acf-be4a4bd51b0b';
const STONE_CASHAPP_PAYMENT_ID = 'b2d9357b-061c-4e27-812e-5e311937a382';
assert.strictEqual(RENT_IDEMPOTENCY_KEY_VERSION, 2);
assert.strictEqual(ACH_IDEMPOTENCY_KEY_VERSION, 2);
assert.strictEqual(CASHAPP_IDEMPOTENCY_KEY_VERSION, 2);
assert.strictEqual(CARD_IDEMPOTENCY_KEY_VERSION, 2);
assert.strictEqual(
  stripeIdempotencyKey({ method: 'card', paymentId, attempt: 1 }),
  `rent-card-${paymentId}-a2`,
  'card checkout must not reuse a poisoned or expired -a1 key'
);
for (const method of ['ach', 'ach-to', 'cashapp', 'card']) {
  const key = stripeIdempotencyKey({ method, paymentId: 'any-tenant-pay', attempt: 1 });
  assert.ok(key.endsWith('-a2'), `${method} attempt 1 must floor to -a2 for every tenant`);
}
assert.strictEqual(
  stripeIdempotencyKey({ method: 'ach', paymentId, attempt: 1 }),
  `rent-ach-${paymentId}-a2`,
  'ACH charge must not reuse the PMC-poisoned -a1 key'
);
assert.strictEqual(
  stripeIdempotencyKey({ method: 'cashapp', paymentId, attempt: 1 }),
  `rent-cashapp-${paymentId}-a2`,
  'Cash App must not reuse expired -a1 checkout keys'
);
assert.notStrictEqual(
  stripeIdempotencyKey({ method: 'cashapp', paymentId: STONE_CASHAPP_PAYMENT_ID, attempt: 1 }),
  `rent-cashapp-${STONE_CASHAPP_PAYMENT_ID}-a1`,
  'Stone expired Cash App PI must not be replayed from -a1'
);
assert.notStrictEqual(
  stripeIdempotencyKey({ method: 'ach', paymentId: STONE_ACH_PAYMENT_ID, attempt: 1 }),
  `rent-ach-${STONE_ACH_PAYMENT_ID}-a1`,
  'Stone ACH checkout must stay on the post-Lily key floor'
);
assert.strictEqual(
  nextRentIntentAttempt([{ metadata: {} }]),
  2,
  'first rent intent persists the floored key suffix, not raw attempt 1'
);
assert.strictEqual(
  nextRentIntentAttempt([
    { metadata: { rent_original_amount: 900 } },
    { metadata: { stripe_intent_attempt: 1, payment_method: 'ach' } },
    { metadata: { stripe_intent_attempt: 1, payment_method: 'cash_app' } },
  ]),
  3,
  'stored attempt 1 already consumed Cash App/ACH -a2; next pay must use -a3'
);
assert.strictEqual(
  nextRentIntentAttempt([{ metadata: { stripe_intent_attempt: 2 } }]),
  3,
  'full-remaining retry after a floored -a2 create must not reuse -a2'
);
assert.notStrictEqual(
  stripeIdempotencyKey({
    method: 'cashapp',
    paymentId: STONE_PARENT_ID,
    attempt: nextRentIntentAttempt([{ metadata: { stripe_intent_attempt: 2 } }]),
  }),
  `rent-cashapp-${STONE_PARENT_ID}-a2`,
  'retry metadata differs; a reused -a2 key would StripeIdempotencyError'
);
assert.strictEqual(
  stripeIdempotencyKey({
    method: 'cashapp',
    paymentId: STONE_PARENT_ID,
    attempt: nextRentIntentAttempt([
      { metadata: { stripe_intent_attempt: 1 } },
      { metadata: { stripe_intent_attempt: 1 } },
    ]),
  }),
  `rent-cashapp-${STONE_PARENT_ID}-a3`
);
assert.strictEqual(
  stripeIdempotencyKey({
    method: 'ach',
    paymentId: STONE_PARENT_ID,
    attempt: nextRentIntentAttempt([
      { metadata: { stripe_intent_attempt: 1 } },
      { metadata: { stripe_intent_attempt: 1 } },
    ]),
  }),
  `rent-ach-${STONE_PARENT_ID}-a3`
);
assert.deepStrictEqual(
  recordConsumedIntentAttempt({}),
  { stripe_intent_attempt: 2 },
  'failed/canceled webhook must record the floored key even when metadata was empty'
);
assert.deepStrictEqual(
  recordConsumedIntentAttempt({ stripe_intent_attempt: 1 }),
  { stripe_intent_attempt: 2 }
);
assert.deepStrictEqual(
  recordConsumedIntentAttempt({ stripe_intent_attempt: 4 }),
  { stripe_intent_attempt: 4 },
  'do not rewind a higher attempt already stored on the row'
);
assert.strictEqual(
  nextRentIntentAttempt([
    { metadata: recordConsumedIntentAttempt({ stripe_intent_attempt: 1 }) },
  ]),
  3,
  'any tenant: after a failed checkout the next create uses a new key'
);
assert.strictEqual(
  stripeIdempotencyKey({
    method: 'card',
    paymentId,
    attempt: nextRentIntentAttempt([
      { metadata: recordConsumedIntentAttempt({}) },
    ]),
  }),
  `rent-card-${paymentId}-a3`
);
assert.strictEqual(
  stripeIdempotencyKey({ method: 'ach', paymentId, attempt: 2 }),
  `rent-ach-${paymentId}-a2`
);
assert.strictEqual(
  stripeIdempotencyKey({ method: 'ach', paymentId, attempt: 3 }),
  `rent-ach-${paymentId}-a3`
);
assert.strictEqual(
  stripeIdempotencyKey({ method: 'ach-to', paymentId: LILY_PAYMENT_ID, attempt: 1 }),
  `rent-ach-to-${LILY_PAYMENT_ID}-a2`,
  'bank create-intent must rotate off ach-to-…-a1 after the unused checkout PI'
);
assert.notStrictEqual(
  stripeIdempotencyKey({ method: 'ach', paymentId: LILY_PAYMENT_ID, attempt: 1 }),
  `rent-ach-${LILY_PAYMENT_ID}-a1`
);
assert.ok(stripeIdempotencyKey({ method: 'cashapp', paymentId }).length <= 255);

const lilyIdempotencyErr = new Error(
  'Keys for idempotent requests can only be used with the same parameters they were first used with.'
);
lilyIdempotencyErr.name = 'StripeIdempotencyError';
lilyIdempotencyErr.type = 'idempotency_error';
assert.ok(isStripeIdempotencyError(lilyIdempotencyErr));

assert.ok(isUnusedOpenCheckoutIntent({
  status: 'requires_payment_method',
  latest_charge: null,
  amount_received: 0,
}));
assert.strictEqual(
  classifyOpenRentCharge(
    { status: 'pending', stripe_payment_intent_id: 'pi_3UDwrTBaVh1caty80cbtTUKI' },
    { status: 'requires_payment_method', latest_charge: null, amount_received: 0 }
  ),
  'released',
  'unused bank checkout with no charge must not lock the rent period'
);
assert.strictEqual(
  classifyOpenRentCharge(
    { status: 'pending', stripe_payment_intent_id: 'pi_card' },
    { status: 'requires_payment_method', latest_charge: 'ch_123' }
  ),
  'in_flight'
);
assert.strictEqual(
  classifyOpenRentCharge(
    { status: 'processing', stripe_payment_intent_id: 'pi_ach' },
    { status: 'processing', latest_charge: 'ch_1' }
  ),
  'in_flight'
);
assert.doesNotThrow(() => {
  const kind = classifyOpenRentCharge(
    { status: 'pending', stripe_payment_intent_id: 'pi_unused' },
    { status: 'requires_payment_method', latest_charge: null }
  );
  assert.strictEqual(kind, 'released');
  assertRentPeriodAvailable({
    processingCount: 0,
    pendingOpenCount: kind === 'in_flight' ? 1 : 0,
    remainingDue: 900,
  });
});
assert.deepStrictEqual(stripeIdempotencyOptions('rent-card-x-a1'), {
  idempotencyKey: 'rent-card-x-a1',
});
assert.deepStrictEqual(stripeIdempotencyOptions(''), {});
assert.deepStrictEqual(stripeIdempotencyOptions(null), {});

function createMemoryLock() {
  let chain = Promise.resolve();
  return {
    async withLock(fn) {
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      const prev = chain;
      chain = chain.then(() => next);
      await prev;
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

const memoryLock = createMemoryLock();

/** Mirrors prepareTenantCharge: lock, then re-read open state, then create. */
async function simulateGuardedRentCharge({ store, createCharge, useLock }) {
  const claim = async () => {
    assertRentPeriodAvailable({
      processingCount: store.processingCount,
      pendingOpenCount: store.pendingOpenCount || 0,
      remainingDue: store.remainingDue,
    });
    // Card create-intent commits `pending` (not processing); remainingDue stays due.
    store.pendingOpenCount = (store.pendingOpenCount || 0) + 1;
    const pi = await createCharge();
    store.liveIntents.push(pi);
    return pi;
  };

  if (useLock) return memoryLock.withLock(claim);

  // Stale read: both callers snapshot before either marks in-flight (the live bug).
  const snapshot = {
    processingCount: store.processingCount,
    pendingOpenCount: store.pendingOpenCount || 0,
    remainingDue: store.remainingDue,
  };
  await Promise.resolve();
  assertRentPeriodAvailable(snapshot);
  store.pendingOpenCount = (store.pendingOpenCount || 0) + 1;
  const pi = await createCharge();
  store.liveIntents.push(pi);
  return pi;
}

// ── Two overlapping card creates → one live charge ──────────────────────────
async function testConcurrentCardPays() {
  const stripeCalls = [];
  const stripeCreate = async () => {
    const id = `pi_${stripeCalls.length + 1}`;
    stripeCalls.push(id);
    return { id, status: 'requires_payment_method' };
  };

  const unlocked = { remainingDue: 450, processingCount: 0, liveIntents: [] };
  await Promise.all([
    simulateGuardedRentCharge({ store: unlocked, createCharge: stripeCreate, useLock: false }),
    simulateGuardedRentCharge({ store: unlocked, createCharge: stripeCreate, useLock: false }),
  ]);
  assert.strictEqual(
    unlocked.liveIntents.length,
    2,
    'precondition: without a lock, two overlapping card pays both create PaymentIntents'
  );

  const locked = { remainingDue: 450, processingCount: 0, liveIntents: [] };
  const lockedStripe = [];
  const lockedCreate = async () => {
    const id = `pi_locked_${lockedStripe.length + 1}`;
    lockedStripe.push(id);
    return { id, status: 'requires_payment_method' };
  };
  const results = await Promise.allSettled([
    simulateGuardedRentCharge({ store: locked, createCharge: lockedCreate, useLock: true }),
    simulateGuardedRentCharge({ store: locked, createCharge: lockedCreate, useLock: true }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'lock + re-check allows exactly one card charge');
  assert.strictEqual(rejected.length, 1, 'the overlapping card pay is rejected');
  assert.strictEqual(rejected[0].reason.code, 'DUPLICATE_PAYMENT');
  assert.strictEqual(locked.liveIntents.length, 1);
  assert.strictEqual(lockedStripe.length, 1);
}

async function testSecondCreateTwoMinutesAfterPendingIntent() {
  const store = {
    remainingDue: 450,
    processingCount: 0,
    pendingOpenCount: 0,
    liveIntents: [],
  };
  let creates = 0;
  const createCharge = async () => {
    creates += 1;
    return { id: `pi_later_${creates}`, status: 'requires_payment_method' };
  };

  await simulateGuardedRentCharge({ store, createCharge, useLock: true });
  assert.strictEqual(creates, 1, 'first card create-intent creates one PaymentIntent');
  assert.strictEqual(store.pendingOpenCount, 1, 'first commit leaves the rent row pending');
  assert.strictEqual(store.processingCount, 0, 'card create-intent does not mark processing');
  assert.strictEqual(store.remainingDue, 450, 'succeeded coverage has not changed yet');

  // Lock is free; two minutes later is just another request against the same store.
  await assert.rejects(
    () => simulateGuardedRentCharge({ store, createCharge, useLock: true }),
    (err) => err.code === 'DUPLICATE_PAYMENT' && /already in progress/i.test(err.message)
  );
  assert.strictEqual(creates, 1, 'second create-intent two minutes later must not create another PaymentIntent');
  assert.strictEqual(store.liveIntents.length, 1);
}

async function testRetryAfterSuccess() {
  let creates = 0;
  await assert.rejects(
    () => simulateGuardedRentCharge({
      store: { remainingDue: 0, processingCount: 0, liveIntents: [{ id: 'pi_paid' }] },
      createCharge: async () => {
        creates += 1;
        return { id: 'pi_should_not_exist' };
      },
      useLock: true,
    }),
    (err) => err.code === 'NOTHING_DUE' && /already paid/i.test(err.message)
  );
  assert.strictEqual(creates, 0, 'retry after success must not create a second PaymentIntent');
}

async function testAchDoesNotDouble() {
  let creates = 0;
  await assert.rejects(
    () => simulateGuardedRentCharge({
      store: { remainingDue: 450, processingCount: 1, liveIntents: [{ id: 'pi_ach' }] },
      createCharge: async () => {
        creates += 1;
        return { id: 'pi_ach_2' };
      },
      useLock: true,
    }),
    (err) => err.code === 'DUPLICATE_PAYMENT'
  );
  assert.strictEqual(creates, 0, 'ACH in-flight must not start a second debit');
}

function lilyIdempotencyConflict() {
  const err = new Error(
    'Keys for idempotent requests can only be used with the same parameters they were first used with.'
  );
  err.name = 'StripeIdempotencyError';
  err.type = 'idempotency_error';
  return err;
}

async function testChargeAchReusesExistingIntentOnIdempotencyConflict() {
  const creates = [];
  const existing = {
    id: 'pi_already_processing',
    status: 'processing',
    amount: 90000,
    metadata: { payment_id: LILY_PAYMENT_ID },
    latest_charge: 'ch_existing',
  };
  const stripeClient = {
    paymentIntents: {
      create: async (params, options) => {
        creates.push({ params, options });
        throw lilyIdempotencyConflict();
      },
      list: async () => ({ data: [existing] }),
    },
  };

  const pi = await chargeACH({
    amountCents: 90000,
    customerId: 'cus_test',
    paymentMethodId: 'ba_1U7M1HBaVh1caty8IeYgkgCI',
    description: 'Rent',
    metadata: { payment_id: LILY_PAYMENT_ID },
    ipAddress: '1.2.3.4',
    userAgent: 'test',
    idempotencyKey: stripeIdempotencyKey({ method: 'ach', paymentId: LILY_PAYMENT_ID, attempt: 1 }),
    stripeClient,
  });
  assert.strictEqual(creates.length, 1, 'confirmed ACH must not create a second debit');
  assert.strictEqual(creates[0].options.idempotencyKey, `rent-ach-${LILY_PAYMENT_ID}-a2`);
  assert.notStrictEqual(creates[0].options.idempotencyKey, `rent-ach-${LILY_PAYMENT_ID}-a1`);
  assert.strictEqual(pi.id, 'pi_already_processing');
  assert.strictEqual(pi.status, 'processing');
}

async function testChargeAchDoesNotBumpKeyWhenNoExistingIntent() {
  const creates = [];
  const stripeClient = {
    paymentIntents: {
      create: async (params, options) => {
        creates.push({ params, options });
        throw lilyIdempotencyConflict();
      },
      list: async () => ({ data: [] }),
    },
  };

  await assert.rejects(
    () => chargeACH({
      amountCents: 90000,
      customerId: 'cus_test',
      paymentMethodId: 'ba_1U7M1HBaVh1caty8IeYgkgCI',
      description: 'Rent',
      metadata: { payment_id: LILY_PAYMENT_ID },
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      idempotencyKey: stripeIdempotencyKey({ method: 'ach', paymentId: LILY_PAYMENT_ID, attempt: 1 }),
      stripeClient,
    }),
    (err) => err.type === 'idempotency_error'
  );
  assert.strictEqual(creates.length, 1, 'must not open a second confirmed ACH with a bumped key');
}

async function testFindReusableRentPaymentIntent() {
  const listed = await findReusableRentPaymentIntent({
    paymentIntents: {
      list: async () => ({
        data: [{
          id: 'pi_other',
          status: 'processing',
          amount: 90000,
          metadata: { payment_id: 'other' },
        }, {
          id: 'pi_match',
          status: 'processing',
          amount: 90000,
          metadata: { payment_id: LILY_PAYMENT_ID },
        }],
      }),
    },
  }, {
    customerId: 'cus_test',
    paymentId: LILY_PAYMENT_ID,
    amountCents: 90000,
  });
  assert.strictEqual(listed.id, 'pi_match');
}

async function testBankCreateIntentDoesNotBumpKeyOnIdempotencyConflict() {
  const calls = [];
  const stripeClient = {
    paymentIntents: {
      create: async (params, options) => {
        calls.push({ params, options });
        throw lilyIdempotencyConflict();
      },
    },
  };

  await assert.rejects(
    () => createBankPaymentIntent({
      amountCents: 90000,
      customerId: 'cus_test',
      description: 'Rent',
      metadata: { payment_id: LILY_PAYMENT_ID },
      idempotencyKey: stripeIdempotencyKey({
        method: 'ach-to',
        paymentId: LILY_PAYMENT_ID,
        attempt: 1,
      }),
      stripeClient,
    }),
    (err) => err.type === 'idempotency_error'
  );
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].options.idempotencyKey,
    `rent-ach-to-${LILY_PAYMENT_ID}-a2:types-only`
  );
}

async function testStripeCreatePassesIdempotencyKey() {
  const calls = [];
  const stripeClient = {
    paymentIntents: {
      create: async (params, options) => {
        calls.push({ params, options });
        return { id: 'pi_test', status: 'requires_payment_method' };
      },
    },
  };

  await createCardPaymentIntent({
    amountCents: 46335,
    customerId: 'cus_test',
    description: 'Rent — September 2026',
    metadata: { payment_id: paymentId },
    idempotencyKey: stripeIdempotencyKey({ method: 'card', paymentId, attempt: 1 }),
    stripeClient,
  });
  assert.strictEqual(calls[0].options.idempotencyKey, `rent-card-${paymentId}-a2:types-only`);
  assert.ok(!calls[0].params.idempotencyKey, 'idempotency key is a request option, not a PI field');

  calls.length = 0;
  await createCashAppPaymentIntent({
    amountCents: 46335,
    customerId: 'cus_test',
    description: 'Rent',
    metadata: {},
    idempotencyKey: stripeIdempotencyKey({ method: 'cashapp', paymentId, attempt: 1 }),
    stripeClient,
  });
  assert.strictEqual(calls[0].options.idempotencyKey, `rent-cashapp-${paymentId}-a2:types-only`);

  calls.length = 0;
  await chargeACH({
    amountCents: 45000,
    customerId: 'cus_test',
    paymentMethodId: 'pm_us_bank',
    description: 'Rent',
    metadata: {},
    ipAddress: '1.2.3.4',
    userAgent: 'test',
    idempotencyKey: stripeIdempotencyKey({ method: 'ach', paymentId, attempt: 1 }),
    stripeClient,
  });
  assert.strictEqual(calls[0].options.idempotencyKey, `rent-ach-${paymentId}-a2`);

  calls.length = 0;
  await createBankPaymentIntent({
    amountCents: 120000,
    customerId: 'cus_test',
    description: 'Rent',
    metadata: {},
    idempotencyKey: stripeIdempotencyKey({ method: 'ach', paymentId, attempt: 1 }),
    stripeClient,
  });
  assert.strictEqual(
    calls[0].options.idempotencyKey,
    `rent-ach-${paymentId}-a2:types-only`,
    'bank checkout must not reuse the sticky PMC-failure key'
  );
  assert.ok(!calls[0].params.payment_method_configuration);
  assert.deepStrictEqual(calls[0].params.payment_method_types, ['us_bank_account']);
}

function testProductionWiring() {
  const charge = read('src/services/rent-charge.service.js');
  assert.match(charge, /lockRentChargePeriod/, 'prepareTenantCharge takes an advisory lock');
  assert.match(charge, /assertRentPeriodAvailable/, 'prepareTenantCharge rejects a covered or in-flight period');
  assert.match(charge, /pendingOpenCount/, 'pending card intents count as in-flight, not only processing');
  assert.match(charge, /rejectInFlightConfirm/, 'rent does not cancel a PI that is already confirming');
  assert.match(charge, /kind === 'released'/, 'unused checkout PIs are canceled, not locked');
  assert.match(charge, /nextRentIntentAttempt/, 'rent charges advance attempt from all period rows');
  assert.match(
    charge,
    /payment_type = 'security_deposit'[\s\S]*nextRentIntentAttempt/,
    'deposit retries advance the same attempt counter'
  );

  const guard = read('src/services/rent-charge-guard.js');
  assert.match(guard, /RENT_IDEMPOTENCY_KEY_VERSION/, 'all portal methods share one key floor');
  assert.match(guard, /CARD_IDEMPOTENCY_KEY_VERSION/, 'card keys share the same floor as ACH and Cash App');
  assert.match(guard, /recordConsumedIntentAttempt/, 'failed intents persist the consumed suffix');
  assert.match(guard, /nextRentIntentAttempt/, 'period attempt counter reads failed partials');
  assert.match(guard, /maxConsumedIntentAttempt/, 'stored attempt 1 counts as consumed -a2 after floors');
  assert.match(guard, /isUnusedOpenCheckoutIntent/, 'unused requires_payment_method + no charge is replaceable');

  const routes = read('src/routes/payments.routes.js');
  assert.match(routes, /idempotencyKey/, 'tenant charge routes send Stripe idempotency keys');
  assert.match(routes, /stripeIdempotencyKey/, 'routes use the shared rent idempotency helper');

  const webhook = read('src/webhooks/stripe.webhook.js');
  assert.match(webhook, /persistConsumedIntentAttempt/, 'failed and canceled PIs record the consumed key');
  assert.match(webhook, /recordConsumedIntentAttempt/, 'webhook uses the shared consumed-attempt helper');

  const utility = read('src/services/utility-portal-charge.service.js');
  assert.match(utility, /stripe_intent_attempt/, 'utility portal pays start on the shared key floor');

  const stripeSrc = read('src/services/stripe.service.js');
  assert.match(stripeSrc, /stripeIdempotencyOptions/, 'Stripe helpers pass Idempotency-Key request options');
  assert.match(stripeSrc, /findReusableRentPaymentIntent/, 'confirmed ACH reuses an existing PI instead of bumping the key');
  assert.doesNotMatch(
    stripeSrc,
    /retrying with bumped key/,
    'Stripe docs: do not open a second confirmed debit with a new idempotency key'
  );
  assert.match(
    stripeSrc,
    /paymentIntents\.create\([\s\S]*stripeIdempotencyOptions/,
    'PaymentIntent create uses idempotency options'
  );

  const paymentsPage = read('client/src/pages/tenant/Payments.jsx');
  assert.match(paymentsPage, /payInFlightRef/, 'tenant Pay UI locks after first submit');
  assert.match(paymentsPage, /cardIntent\?\.paymentType === 'rent'/, 'card CTA stays locked while an intent is open');
  assert.match(paymentsPage, /disabled=\{payLoading/, 'ACH rent CTA is disabled while the charge is in flight');

  const cardForm = read('client/src/components/payments/CardPaymentForm.jsx');
  assert.match(cardForm, /confirmLockRef/, 'card confirm cannot be submitted twice');

  const errors = read('client/src/utils/apiErrorMessage.js');
  assert.match(errors, /already in progress or complete/, 'duplicate-pay copy is mapped for the client');
  assert.match(errors, /NOTHING_DUE/, 'already-paid code has client fallback copy');

  const lockSql = String(lockRentChargePeriod);
  assert.match(lockSql, /pg_advisory_xact_lock/, 'lock is transaction-scoped (safe with poolers)');
}

async function main() {
  await testConcurrentCardPays();
  await testSecondCreateTwoMinutesAfterPendingIntent();
  await testRetryAfterSuccess();
  await testAchDoesNotDouble();
  await testStripeCreatePassesIdempotencyKey();
  await testChargeAchReusesExistingIntentOnIdempotencyConflict();
  await testChargeAchDoesNotBumpKeyWhenNoExistingIntent();
  await testFindReusableRentPaymentIntent();
  await testBankCreateIntentDoesNotBumpKeyOnIdempotencyConflict();
  testProductionWiring();
  console.log('test-duplicate-rent-charge OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
