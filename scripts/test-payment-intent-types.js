#!/usr/bin/env node
/**
 * Tenant checkout must create the Stripe object that matches the method:
 *   card / Link (card wallet) → payment_method_types: ['card']
 *   Cash App                  → payment_method_types: ['cashapp']
 *   Bank ACH / Plaid          → payment_method_types: ['us_bank_account']
 *
 * Bank tap must never silently open a card PaymentIntent (Osanin 2026-09-01
 * Link-card generic_decline while Jose thought the charge was ACH).
 *
 * Run: node scripts/test-payment-intent-types.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildCardIntentParams,
  buildCashAppIntentParams,
  buildBankCheckoutIntentParams,
  createCardPaymentIntent,
  createCashAppPaymentIntent,
  createBankPaymentIntent,
  createLockedCheckoutPaymentIntent,
  buildAchIntentParams,
  checkoutPaymentMethodConfigurationId,
  PLAID_MANAGED_CONNECT_PMC,
  ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE,
} = require('../src/services/stripe.service');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function mockStripeClient(calls) {
  return {
    paymentIntents: {
      create: async (params, options) => {
        calls.push({ params, options });
        return {
          id: `pi_${calls.length}`,
          client_secret: `pi_${calls.length}_secret`,
          payment_method_types: params.payment_method_types,
          status: 'requires_payment_method',
        };
      },
    },
  };
}

// ── Param builders (no live Stripe) ─────────────────────────────────────────
const cardParams = buildCardIntentParams({
  amountCents: 123654,
  customerId: 'cus_test',
  description: 'Rent — September 2026 (incl. processing fee)',
  metadata: { payment_id: 'pay_card' },
});
assert.deepStrictEqual(cardParams.payment_method_types, ['card']);
assert.strictEqual(cardParams.currency, 'usd');
assert.strictEqual(cardParams.capture_method, 'automatic');
assert.ok(!cardParams.payment_method_types.includes('us_bank_account'));
assert.ok(!cardParams.payment_method_types.includes('cashapp'));
assert.notStrictEqual(
  cardParams.payment_method_configuration,
  PLAID_MANAGED_CONNECT_PMC,
  'card/Link must not use the Plaid-managed Connect PMC'
);

const cashAppParams = buildCashAppIntentParams({
  amountCents: 123654,
  customerId: 'cus_test',
  description: 'Rent — September 2026 (incl. processing fee)',
  metadata: { payment_id: 'pay_cashapp' },
});
assert.deepStrictEqual(cashAppParams.payment_method_types, ['cashapp']);
assert.ok(!cashAppParams.payment_method_types.includes('card'));
assert.ok(!cashAppParams.payment_method_types.includes('us_bank_account'));
assert.notStrictEqual(cashAppParams.payment_method_configuration, PLAID_MANAGED_CONNECT_PMC);

const bankParams = buildBankCheckoutIntentParams({
  amountCents: 120000,
  customerId: 'cus_test',
  description: 'Rent — September 2026',
  metadata: { payment_id: 'pay_bank' },
});
assert.deepStrictEqual(bankParams.payment_method_types, ['us_bank_account']);
assert.strictEqual(bankParams.confirm, undefined);
assert.ok(!bankParams.confirm, 'bank checkout PI is unconfirmed so Payment Element can collect the bank');
assert.ok(!bankParams.payment_method_types.includes('card'));
assert.ok(!bankParams.payment_method_types.includes('cashapp'));
assert.strictEqual(bankParams.amount, 120000, 'ACH checkout charges the ledger amount (no card fee)');
assert.notStrictEqual(
  bankParams.payment_method_configuration,
  PLAID_MANAGED_CONNECT_PMC,
  'bank ACH must not use the Plaid-managed Connect PMC'
);

const savedAch = buildAchIntentParams({
  amountCents: 120000,
  customerId: 'cus_test',
  paymentMethodId: 'pm_us_bank',
  description: 'Rent',
  metadata: {},
  ipAddress: '1.2.3.4',
  userAgent: 'test',
});
assert.deepStrictEqual(savedAch.payment_method_types, ['us_bank_account']);
assert.strictEqual(savedAch.confirm, true);

// ── create* helpers pass the matching types into Stripe ─────────────────────
async function testCreateHelpers() {
  const cardCalls = [];
  await createCardPaymentIntent({
    amountCents: 123654,
    customerId: 'cus_test',
    description: 'Rent',
    metadata: {},
    stripeClient: mockStripeClient(cardCalls),
  });
  assert.deepStrictEqual(cardCalls[0].params.payment_method_types, ['card']);

  const cashCalls = [];
  await createCashAppPaymentIntent({
    amountCents: 123654,
    customerId: 'cus_test',
    description: 'Rent',
    metadata: {},
    stripeClient: mockStripeClient(cashCalls),
  });
  assert.deepStrictEqual(cashCalls[0].params.payment_method_types, ['cashapp']);

  const bankCalls = [];
  await createBankPaymentIntent({
    amountCents: 120000,
    customerId: 'cus_test',
    description: 'Rent',
    metadata: {},
    stripeClient: mockStripeClient(bankCalls),
  });
  assert.deepStrictEqual(bankCalls[0].params.payment_method_types, ['us_bank_account']);
  assert.ok(!bankCalls[0].params.confirm);
  assert.notStrictEqual(bankCalls[0].params.payment_method_configuration, PLAID_MANAGED_CONNECT_PMC);
}

function testAccountPmcPin() {
  const prev = process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_CONFIGURATION;
  process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_CONFIGURATION = ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE;
  try {
    assert.strictEqual(checkoutPaymentMethodConfigurationId(), ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE);
    const bank = buildBankCheckoutIntentParams({
      amountCents: 120000,
      customerId: 'cus_test',
      description: 'Rent',
      metadata: {},
    });
    assert.deepStrictEqual(bank.payment_method_types, ['us_bank_account']);
    assert.strictEqual(bank.payment_method_configuration, ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE);

    const card = buildCardIntentParams({
      amountCents: 123510,
      customerId: 'cus_test',
      description: 'Rent',
      metadata: {},
    });
    assert.deepStrictEqual(card.payment_method_types, ['card']);
    assert.strictEqual(card.payment_method_configuration, ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE);

    const cash = buildCashAppIntentParams({
      amountCents: 123510,
      customerId: 'cus_test',
      description: 'Rent',
      metadata: {},
    });
    assert.deepStrictEqual(cash.payment_method_types, ['cashapp']);
    assert.strictEqual(cash.payment_method_configuration, ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE);

    process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_CONFIGURATION = PLAID_MANAGED_CONNECT_PMC;
    assert.strictEqual(
      checkoutPaymentMethodConfigurationId(),
      ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE,
      'Plaid-managed Connect PMC must be remapped to the account-level Default PMC'
    );
  } finally {
    if (prev == null) delete process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_CONFIGURATION;
    else process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_CONFIGURATION = prev;
  }
}

async function testLockedCreateFallback() {
  const conflictCalls = [];
  const conflictClient = {
    paymentIntents: {
      create: async (params) => {
        conflictCalls.push(params);
        if (params.payment_method_configuration) {
          const err = new Error('You may only specify one of these parameters: payment_method_types, payment_method_configuration.');
          err.param = 'payment_method_configuration';
          throw err;
        }
        return {
          id: 'pi_types_only',
          payment_method_types: params.payment_method_types,
          status: 'requires_payment_method',
          amount_received: 0,
        };
      },
    },
  };
  const recovered = await createLockedCheckoutPaymentIntent({
    params: {
      amount: 120000,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      payment_method_configuration: ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE,
    },
    expectedTypes: ['us_bank_account'],
    stripeClient: conflictClient,
  });
  assert.strictEqual(recovered.id, 'pi_types_only');
  assert.strictEqual(conflictCalls.length, 2);
  assert.ok(!conflictCalls[1].payment_method_configuration);

  const widenedCalls = [];
  const canceled = [];
  const widenClient = {
    paymentIntents: {
      create: async (params) => {
        widenedCalls.push(params);
        if (params.payment_method_configuration) {
          return {
            id: 'pi_wide',
            payment_method_types: ['card', 'us_bank_account', 'cashapp'],
            status: 'requires_payment_method',
            amount_received: 0,
          };
        }
        return {
          id: 'pi_locked',
          payment_method_types: params.payment_method_types,
          status: 'requires_payment_method',
          amount_received: 0,
        };
      },
      cancel: async (id) => {
        canceled.push(id);
        return { id, status: 'canceled' };
      },
    },
  };
  const locked = await createLockedCheckoutPaymentIntent({
    params: {
      amount: 120000,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      payment_method_configuration: ACCOUNT_DEFAULT_CHECKOUT_PMC_LIVE,
    },
    expectedTypes: ['us_bank_account'],
    stripeClient: widenClient,
  });
  assert.deepStrictEqual(canceled, ['pi_wide']);
  assert.strictEqual(locked.id, 'pi_locked');
  assert.deepStrictEqual(locked.payment_method_types, ['us_bank_account']);
}

// ── Route + UI wiring ───────────────────────────────────────────────────────
function testWiring() {
  const routes = read('src/routes/payments.routes.js');
  assert.match(routes, /router\.post\('\/bank\/create-intent'/);
  assert.match(routes, /createBankPaymentIntent/);
  assert.match(
    routes,
    /createBankPaymentIntent\([\s\S]*payment_method_types|createBankPaymentIntent\(/
  );

  const bankHandler = routes.slice(
    routes.indexOf("router.post('/bank/create-intent'"),
    routes.indexOf("router.get('/cashapp/sync'") > routes.indexOf("router.post('/bank/create-intent'")
      ? routes.indexOf("router.get('/cashapp/sync'")
      : routes.length
  );
  assert.match(bankHandler, /createBankPaymentIntent/, 'bank create-intent calls the ACH helper');
  assert.doesNotMatch(bankHandler, /createCardPaymentIntent/, 'bank create-intent must not open a card PI');
  assert.doesNotMatch(bankHandler, /computeCardCashAppFee/, 'bank ACH has no processing fee');
  assert.match(bankHandler, /payment_method:\s*'ach'/);
  assert.match(bankHandler, /source:\s*'stripe_ach'/);
  assert.match(bankHandler, /stripeIdempotencyKey/, 'keep #97 idempotency on bank create-intent');

  const cardHandler = routes.slice(
    routes.indexOf("router.post('/card/create-intent'"),
    routes.indexOf("router.post('/bank/create-intent'") > routes.indexOf("router.post('/card/create-intent'")
      ? routes.indexOf("router.post('/bank/create-intent'")
      : routes.indexOf("router.get('/cashapp/sync'")
  );
  assert.match(cardHandler, /createCardPaymentIntent/);
  assert.doesNotMatch(cardHandler, /createBankPaymentIntent/);
  assert.match(cardHandler, /computeCardCashAppFee/, 'do not disable card processing fees');

  const cashHandler = routes.slice(
    routes.indexOf("router.post('/cashapp/create-intent'"),
    routes.indexOf("router.post('/card/create-intent'")
  );
  assert.match(cashHandler, /createCashAppPaymentIntent/);
  assert.match(cashHandler, /computeCardCashAppFee/, 'do not disable Cash App processing fees');

  const paymentsPage = read('client/src/pages/tenant/Payments.jsx');
  assert.match(paymentsPage, /\/api\/payments\/bank\/create-intent/, 'Bank tap starts a bank create-intent');
  assert.match(paymentsPage, /\/api\/payments\/bank\/sync/, 'Financial Connections return syncs the ACH PI');
  assert.match(paymentsPage, /bank_return=1/, 'bank Payment Element returns to a bank sync URL');
  assert.match(paymentsPage, /\/api\/payments\/card\/create-intent/);
  assert.match(paymentsPage, /\/api\/payments\/cashapp\/create-intent/);
  assert.match(paymentsPage, /Link \(card wallet\)|card wallet/, 'Link is labeled as a card wallet, not ACH');
  assert.match(paymentsPage, /Bank \(ACH\)/);
  assert.match(paymentsPage, /startBankPayment|handleBankCheckout/, 'pay flow always offers bank ACH');

  assert.match(routes, /router\.get\('\/bank\/sync'/);

  const cardForm = read('client/src/components/payments/CardPaymentForm.jsx');
  assert.match(cardForm, /paymentMethodOrder:\s*\['card'\]/, 'card Payment Element is card/Link only');
  assert.doesNotMatch(
    cardForm,
    /paymentMethodOrder:\s*\['card',\s*'us_bank_account'\]/,
    'card form must not mix ACH onto the card PI'
  );
  assert.match(cardForm, /paymentTypesMatchVariant/, 'refuse to mount a bank form on a card PI');
  assert.match(cardForm, /paymentMethodTypes/, 'card form checks the PI method types from create-intent');

  assert.match(routes, /checkoutIntentPublicFields/);
  assert.match(routes, /checkoutPaymentMethodConfiguration/);
  assert.doesNotMatch(routes, /pmc_1Tb9l1BaVh1caty8bPcFnpeq/);

  const finishLease = read('client/src/components/leases/FinishLeasePay.jsx');
  assert.match(finishLease, /\/api\/payments\/card\/create-intent/);
  assert.match(finishLease, /\/api\/payments\/cashapp\/create-intent/);
  assert.match(finishLease, /ACH bank|Bank \(ACH\)|payByAch/);
}

async function main() {
  await testCreateHelpers();
  testAccountPmcPin();
  await testLockedCreateFallback();
  testWiring();
  console.log('test-payment-intent-types OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
