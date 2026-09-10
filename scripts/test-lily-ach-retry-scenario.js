#!/usr/bin/env node
/**
 * Replay Lily Fortman rent ACH after PR 105 — mocked Stripe only.
 *
 * Live night (2026-09-10):
 *   1. Signal REROUTE fail-open worked
 *   2. POST /charge used rent-ach-<id>-a1 → StripeIdempotencyError (PMC-poisoned key)
 *   3. POST /bank/create-intent created unused PI (requires_payment_method, no charge)
 *   4. Later /charge and create-intent → 409 (unused PI treated as in-flight)
 *
 * This script walks that sequence with a fake Stripe account. It never calls
 * live Stripe and never charges a tenant.
 *
 * Run: node scripts/test-lily-ach-retry-scenario.js
 */
const assert = require('assert');

const {
  classifyOpenRentCharge,
  assertRentPeriodAvailable,
  stripeIdempotencyKey,
} = require('../src/services/rent-charge-guard');
const {
  chargeACH,
  createBankPaymentIntent,
} = require('../src/services/stripe.service');
const { resolveAchChargeSource } = require('../src/services/tenant-ach-charge.service');
const { assertAchDebitAllowed } = require('../src/services/plaid-ach-guard.service');

const LILY_PAYMENT_ID = 'f4aaca28-cff8-491f-ba11-d6521aaee4fe';
const LILY_TENANT_ID = 'ed270b84-ae0f-428f-8403-3ef878531cef';
const LILY_PLAID_ACCOUNT_ID = '1Evb30ZPbau65vVbMP7gH9NE6vZM0XuAgZAXv';
const LILY_CUSTOMER = 'cus_UzyFrkhG2BKzD9';
const LILY_CHIME_PM = 'ba_1U7M1HBaVh1caty8IeYgkgCI';
const LILY_BOFA_PM = 'ba_1UC4iZBaVh1caty8TestBofA';
const UNUSED_CHECKOUT_PI = 'pi_3UDwrTBaVh1caty80cbtTUKI';
const POISONED_KEY = `rent-ach-${LILY_PAYMENT_ID}-a1`;

function stripeIdempotencyConflict() {
  const err = new Error(
    'Keys for idempotent requests can only be used with the same parameters they were first used with.'
  );
  err.name = 'StripeIdempotencyError';
  err.type = 'idempotency_error';
  return err;
}

/** Old classify from before this fix — unused checkout counted as in-flight. */
function classifyOpenRentChargeBeforeFix(row = {}, pi = null) {
  if (row.status === 'processing') return 'in_flight';
  if (row.status === 'succeeded') return 'paid';
  if (!row.stripe_payment_intent_id) return 'open_invoice';
  if (!pi) return 'in_flight';
  if (pi.status === 'succeeded') return 'paid';
  if (pi.status === 'canceled') return 'released';
  if (pi.status === 'requires_payment_method' && pi.last_payment_error) return 'released';
  return 'in_flight';
}

function lilyPaymentRow() {
  return {
    id: LILY_PAYMENT_ID,
    status: 'pending',
    amount: 900,
    stripe_payment_intent_id: UNUSED_CHECKOUT_PI,
  };
}

function unusedBankCheckoutPi() {
  return {
    id: UNUSED_CHECKOUT_PI,
    amount: 90000,
    payment_method_types: ['us_bank_account'],
    status: 'requires_payment_method',
    latest_charge: null,
    amount_received: 0,
    last_payment_error: null,
  };
}

function lilyChimeBank() {
  return {
    stripe_customer_id: LILY_CUSTOMER,
    stripe_bank_account_id: LILY_CHIME_PM,
    plaid_access_token_encrypted: 'encrypted-token',
    plaid_account_id: LILY_PLAID_ACCOUNT_ID,
    status: 'verified',
    link_status: 'active',
    institution_name: 'Chime',
    account_type: 'checking',
  };
}

function mockStripeThatPoisonsA1(creates) {
  return {
    paymentIntents: {
      create: async (params, options) => {
        creates.push({ params, options });
        const key = options?.idempotencyKey || '';
        if (key === POISONED_KEY || key.startsWith(`${POISONED_KEY}:`)) {
          throw stripeIdempotencyConflict();
        }
        const confirmed = params.confirm === true;
        return {
          id: confirmed ? 'pi_test_lily_charge' : 'pi_test_lily_checkout',
          amount: params.amount,
          currency: 'usd',
          payment_method_types: params.payment_method_types,
          payment_method: params.payment_method || null,
          status: confirmed ? 'processing' : 'requires_payment_method',
          latest_charge: confirmed ? 'ch_test_lily_900' : null,
          amount_received: 0,
        };
      },
      cancel: async (id) => ({ id, status: 'canceled', latest_charge: null, amount_received: 0 }),
    },
  };
}

async function step(title, fn) {
  process.stdout.write(`\n→ ${title}\n`);
  const result = await fn();
  if (result != null) process.stdout.write(`  ${typeof result === 'string' ? result : JSON.stringify(result)}\n`);
  return result;
}

async function main() {
  const prevSignal = process.env.PLAID_SIGNAL_ENABLED;
  const prevHard = process.env.PLAID_SIGNAL_HARD_BLOCK;
  process.env.PLAID_SIGNAL_ENABLED = 'true';
  delete process.env.PLAID_SIGNAL_HARD_BLOCK;

  try {
    await step('1. Recreate the unused $900 bank checkout PI (live after create-intent)', () => {
      const pi = unusedBankCheckoutPi();
      assert.strictEqual(pi.id, UNUSED_CHECKOUT_PI);
      assert.strictEqual(pi.amount, 90000);
      assert.deepStrictEqual(pi.payment_method_types, ['us_bank_account']);
      assert.strictEqual(pi.status, 'requires_payment_method');
      assert.strictEqual(pi.latest_charge, null);
      return { paymentIntent: pi.id, amountCents: pi.amount, status: pi.status };
    });

    await step('2. Old lock: unused PI with no charge was in-flight → 409', () => {
      const kind = classifyOpenRentChargeBeforeFix(lilyPaymentRow(), unusedBankCheckoutPi());
      assert.strictEqual(kind, 'in_flight');
      assert.throws(
        () => assertRentPeriodAvailable({
          processingCount: 0,
          pendingOpenCount: 1,
          remainingDue: 900,
        }),
        (err) => err.code === 'DUPLICATE_PAYMENT'
      );
      return { classify: kind, http: 409 };
    });

    await step('3. If /charge still sent poisoned -a1, Stripe rejects then we retry -a2', async () => {
      const creates = [];
      const pi = await chargeACH({
        amountCents: 90000,
        customerId: LILY_CUSTOMER,
        paymentMethodId: LILY_CHIME_PM,
        description: 'Rent — September 2026',
        metadata: { payment_id: LILY_PAYMENT_ID },
        ipAddress: '1.2.3.4',
        userAgent: 'test',
        idempotencyKey: POISONED_KEY,
        stripeClient: mockStripeThatPoisonsA1(creates),
      });
      assert.strictEqual(creates.length, 2);
      assert.strictEqual(creates[0].options.idempotencyKey, POISONED_KEY);
      assert.strictEqual(creates[1].options.idempotencyKey, `rent-ach-${LILY_PAYMENT_ID}-a2`);
      assert.strictEqual(creates[1].params.confirm, true);
      assert.strictEqual(creates[1].params.payment_method, LILY_CHIME_PM);
      assert.strictEqual(pi.status, 'processing');
      assert.strictEqual(pi.latest_charge, 'ch_test_lily_900');
      return {
        firstKey: creates[0].options.idempotencyKey,
        retryKey: creates[1].options.idempotencyKey,
        status: pi.status,
        paymentIntent: pi.id,
      };
    });

    await step('4. Signal REROUTE fail-open (live step that already worked)', async () => {
      const guard = await assertAchDebitAllowed({
        accessToken: 'access-sandbox-test',
        accountId: LILY_PLAID_ACCOUNT_ID,
        amountCents: 90000,
        userId: LILY_TENANT_ID,
        clientTransactionId: LILY_PAYMENT_ID,
        context: 'rent',
      }, {
        evaluateAchRisk: async () => ({ rulesetResult: 'REROUTE', customerReturnRiskScore: null }),
      });
      assert.strictEqual(guard.ok, true);
      return { ok: true, rulesetResult: 'REROUTE', score: null };
    });

    await step('5. New lock: unused checkout is released; period is chargeable', () => {
      const kind = classifyOpenRentCharge(lilyPaymentRow(), unusedBankCheckoutPi());
      assert.strictEqual(kind, 'released');
      assert.doesNotThrow(() => assertRentPeriodAvailable({
        processingCount: 0,
        pendingOpenCount: 0,
        remainingDue: 900,
      }));
      return { classify: kind, remainingDue: 900 };
    });

    const source = resolveAchChargeSource(lilyChimeBank());
    await step('6. Saved Chime ba_ is charged directly (no Plaid Auth numbers)', () => {
      assert.strictEqual(source.paymentMethodId, LILY_CHIME_PM);
      assert.strictEqual(source.needsPlaidNumbers, false);
      assert.strictEqual(source.canRunSignal, true);
      return { paymentMethodId: source.paymentMethodId, customerId: source.customerId };
    });

    const chargeCreates = [];
    const chargePi = await step('7. POST /charge with saved ba_ uses -a2 and confirms $900 ACH', async () => {
      const key = stripeIdempotencyKey({
        method: 'ach',
        paymentId: LILY_PAYMENT_ID,
        attempt: 1,
      });
      assert.strictEqual(key, `rent-ach-${LILY_PAYMENT_ID}-a2`);
      assert.notStrictEqual(key, POISONED_KEY);

      const pi = await chargeACH({
        amountCents: 90000,
        customerId: LILY_CUSTOMER,
        paymentMethodId: source.paymentMethodId,
        description: 'Rent — September 2026',
        metadata: { payment_id: LILY_PAYMENT_ID, tenant_id: LILY_TENANT_ID },
        ipAddress: '1.2.3.4',
        userAgent: 'test',
        idempotencyKey: key,
        stripeClient: mockStripeThatPoisonsA1(chargeCreates),
      });

      assert.strictEqual(chargeCreates.length, 1);
      assert.strictEqual(chargeCreates[0].options.idempotencyKey, key);
      assert.notStrictEqual(chargeCreates[0].options.idempotencyKey, POISONED_KEY);
      assert.strictEqual(chargeCreates[0].params.confirm, true);
      assert.strictEqual(chargeCreates[0].params.payment_method, LILY_CHIME_PM);
      assert.deepStrictEqual(chargeCreates[0].params.payment_method_types, ['us_bank_account']);
      assert.strictEqual(chargeCreates[0].params.amount, 90000);
      assert.ok(!chargeCreates[0].params.payment_method_configuration);
      assert.strictEqual(pi.id, 'pi_test_lily_charge');
      assert.strictEqual(pi.status, 'processing');
      assert.strictEqual(pi.latest_charge, 'ch_test_lily_900');
      assert.strictEqual(pi.amount, 90000);
      return {
        idempotencyKey: key,
        paymentIntent: pi.id,
        status: pi.status,
        amountCents: pi.amount,
        latestCharge: pi.latest_charge,
      };
    });

    await step('8. Same path with BofA ba_ also confirms (not the unused checkout PI)', async () => {
      const creates = [];
      const pi = await chargeACH({
        amountCents: 90000,
        customerId: LILY_CUSTOMER,
        paymentMethodId: LILY_BOFA_PM,
        description: 'Rent — September 2026',
        metadata: { payment_id: LILY_PAYMENT_ID },
        ipAddress: '1.2.3.4',
        userAgent: 'test',
        idempotencyKey: stripeIdempotencyKey({
          method: 'ach',
          paymentId: LILY_PAYMENT_ID,
          attempt: 1,
        }),
        stripeClient: mockStripeThatPoisonsA1(creates),
      });
      assert.strictEqual(creates[0].params.payment_method, LILY_BOFA_PM);
      assert.strictEqual(creates[0].params.confirm, true);
      assert.notStrictEqual(pi.id, UNUSED_CHECKOUT_PI);
      assert.strictEqual(pi.status, 'processing');
      return { paymentMethod: LILY_BOFA_PM, paymentIntent: pi.id, status: pi.status };
    });

    await step('9. Bank create-intent after unused PI uses ach-to-…-a2, not poisoned -a1', async () => {
      const creates = [];
      const key = stripeIdempotencyKey({
        method: 'ach-to',
        paymentId: LILY_PAYMENT_ID,
        attempt: 1,
      });
      const pi = await createBankPaymentIntent({
        amountCents: 90000,
        customerId: LILY_CUSTOMER,
        description: 'Rent — September 2026',
        metadata: { payment_id: LILY_PAYMENT_ID },
        idempotencyKey: key,
        stripeClient: mockStripeThatPoisonsA1(creates),
      });
      assert.strictEqual(creates[0].options.idempotencyKey, `${key}:types-only`);
      assert.ok(!String(creates[0].options.idempotencyKey).includes('-a1'));
      assert.deepStrictEqual(creates[0].params.payment_method_types, ['us_bank_account']);
      assert.ok(!creates[0].params.confirm);
      assert.ok(!creates[0].params.payment_method_configuration);
      assert.strictEqual(pi.amount, 90000);
      return { idempotencyKey: creates[0].options.idempotencyKey, paymentIntent: pi.id };
    });

    console.log('\nlily-ach-retry-scenario OK');
    console.log(JSON.stringify({
      charged: chargePi,
      reusedPoisonedKey: false,
      unusedCheckoutBlockedRetry: false,
      liveStripe: false,
    }, null, 2));
  } finally {
    if (prevSignal == null) delete process.env.PLAID_SIGNAL_ENABLED;
    else process.env.PLAID_SIGNAL_ENABLED = prevSignal;
    if (prevHard == null) delete process.env.PLAID_SIGNAL_HARD_BLOCK;
    else process.env.PLAID_SIGNAL_HARD_BLOCK = prevHard;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
