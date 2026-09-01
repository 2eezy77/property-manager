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
  buildAchIntentParams,
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

const cashAppParams = buildCashAppIntentParams({
  amountCents: 123654,
  customerId: 'cus_test',
  description: 'Rent — September 2026 (incl. processing fee)',
  metadata: { payment_id: 'pay_cashapp' },
});
assert.deepStrictEqual(cashAppParams.payment_method_types, ['cashapp']);
assert.ok(!cashAppParams.payment_method_types.includes('card'));
assert.ok(!cashAppParams.payment_method_types.includes('us_bank_account'));

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

  const finishLease = read('client/src/components/leases/FinishLeasePay.jsx');
  assert.match(finishLease, /\/api\/payments\/card\/create-intent/);
  assert.match(finishLease, /\/api\/payments\/cashapp\/create-intent/);
  assert.match(finishLease, /ACH bank|Bank \(ACH\)|payByAch/);
}

async function main() {
  await testCreateHelpers();
  testWiring();
  console.log('test-payment-intent-types OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
