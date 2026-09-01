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
  IN_FLIGHT_CONFIRM_STATUSES,
} = require('../src/services/rent-charge-guard');
const {
  stripeIdempotencyOptions,
  chargeACH,
  createCardPaymentIntent,
  createCashAppPaymentIntent,
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
  remainingDue: 450,
}));
assert.doesNotThrow(() => assertRentPeriodAvailable({
  processingCount: 0,
  remainingDue: 100,
  requestedAmount: 50,
}));

assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('processing'));
assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('requires_action'));
assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('requires_confirmation'));
assert.ok(IN_FLIGHT_CONFIRM_STATUSES.has('succeeded'));
assert.ok(!IN_FLIGHT_CONFIRM_STATUSES.has('requires_payment_method'));

const paymentId = '11111111-2222-3333-4444-555555555555';
assert.strictEqual(
  stripeIdempotencyKey({ method: 'card', paymentId, attempt: 1 }),
  `rent-card-${paymentId}-a1`
);
assert.strictEqual(
  stripeIdempotencyKey({ method: 'ach', paymentId, attempt: 2 }),
  `rent-ach-${paymentId}-a2`
);
assert.ok(stripeIdempotencyKey({ method: 'cashapp', paymentId }).length <= 255);
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
      remainingDue: store.remainingDue,
    });
    store.processingCount += 1;
    const pi = await createCharge();
    store.liveIntents.push(pi);
    return pi;
  };

  if (useLock) return memoryLock.withLock(claim);

  // Stale read: both callers snapshot before either marks in-flight (the live bug).
  const snapshot = {
    processingCount: store.processingCount,
    remainingDue: store.remainingDue,
  };
  await Promise.resolve();
  assertRentPeriodAvailable(snapshot);
  store.processingCount += 1;
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
  assert.strictEqual(calls[0].options.idempotencyKey, `rent-card-${paymentId}-a1`);
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
  assert.strictEqual(calls[0].options.idempotencyKey, `rent-cashapp-${paymentId}-a1`);

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
  assert.strictEqual(calls[0].options.idempotencyKey, `rent-ach-${paymentId}-a1`);
}

function testProductionWiring() {
  const charge = read('src/services/rent-charge.service.js');
  assert.match(charge, /lockRentChargePeriod/, 'prepareTenantCharge takes an advisory lock');
  assert.match(charge, /assertRentPeriodAvailable/, 'prepareTenantCharge rejects a covered or in-flight period');
  assert.match(charge, /rejectInFlightConfirm/, 'rent does not cancel a PI that is already confirming');

  const routes = read('src/routes/payments.routes.js');
  assert.match(routes, /idempotencyKey/, 'tenant charge routes send Stripe idempotency keys');
  assert.match(routes, /stripeIdempotencyKey/, 'routes use the shared rent idempotency helper');

  const stripeSrc = read('src/services/stripe.service.js');
  assert.match(stripeSrc, /stripeIdempotencyOptions/, 'Stripe helpers pass Idempotency-Key request options');
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
  await testRetryAfterSuccess();
  await testAchDoesNotDouble();
  await testStripeCreatePassesIdempotencyKey();
  testProductionWiring();
  console.log('test-duplicate-rent-charge OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
