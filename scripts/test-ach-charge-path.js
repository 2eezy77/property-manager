#!/usr/bin/env node
/**
 * Charge-path tests: saved us_bank_account / Plaid-linked checking must reach Stripe.
 * Reproduces the Lily Fortman 2026-09-01 failure (Plaid Signal 400 before PaymentIntent).
 * Run: node scripts/test-ach-charge-path.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  signalClientTransactionId,
} = require('../src/utils/plaid-signal-transaction-id');
const {
  resolveAchChargeSource,
} = require('../src/services/tenant-ach-charge.service');
const {
  assertAchDebitAllowed,
} = require('../src/services/plaid-ach-guard.service');
const {
  buildSignalEvaluateRequest,
} = require('../src/services/plaid.service');
const {
  buildAchIntentParams,
} = require('../src/services/stripe.service');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const LILY_PAYMENT_ID = 'f4aaca28-cff8-491f-ba11-d6521aaee4fe';
const LILY_PLAID_ACCOUNT_ID = '1Evb30ZPbau65vVbMP7gH9NE6vZM0XuAgZAXv';
const LILY_SAVED_PM = 'ba_1U7M1HBaVh1caty8IeYgkgCI';
const LILY_CUSTOMER = 'cus_UzyFrkhG2BKzD9';

// ── Signal client_transaction_id (Plaid: 1–36 chars) ────────────────────────
const legacyLilyId = `rent-${LILY_PAYMENT_ID}`;
assert.strictEqual(legacyLilyId.length, 41, 'precondition: rent-<uuid> is 41 chars (the live bug)');
assert.ok(signalClientTransactionId(legacyLilyId).length <= 36, 'truncates rent-<uuid> to Plaid max');
assert.ok(signalClientTransactionId(LILY_PAYMENT_ID).length <= 36, 'bare payment uuid is valid');
assert.strictEqual(signalClientTransactionId(LILY_PAYMENT_ID), LILY_PAYMENT_ID);
assert.ok(signalClientTransactionId(`autopay-${LILY_PAYMENT_ID}`).length <= 36, 'autopay prefix truncated');
assert.ok(signalClientTransactionId(`utility-autopay-${LILY_PAYMENT_ID}`).length <= 36);

const signalReq = buildSignalEvaluateRequest(
  'access-sandbox-test',
  LILY_PLAID_ACCOUNT_ID,
  90000,
  { userId: 'ed270b84-ae0f-428f-8403-3ef878531cef', clientTransactionId: legacyLilyId }
);
assert.ok(signalReq.client_transaction_id.length <= 36, 'Signal request id is Plaid-legal');
assert.strictEqual(signalReq.amount, 900);
assert.strictEqual(signalReq.account_id, LILY_PLAID_ACCOUNT_ID);
assert.strictEqual(signalReq.user_present, true);

async function testSignalGuard() {
  const prevSignal = process.env.PLAID_SIGNAL_ENABLED;
  const prevBalance = process.env.PLAID_BALANCE_CHECK_ENABLED;
  process.env.PLAID_SIGNAL_ENABLED = 'true';
  process.env.PLAID_BALANCE_CHECK_ENABLED = 'false';

  try {
    const signalErr = Object.assign(new Error('Request failed with status code 400'), {
      response: {
        data: {
          error_type: 'INVALID_REQUEST',
          error_code: 'INVALID_FIELD',
          error_message: 'client_transaction_id must be between 1 and 36 in length',
        },
      },
    });

    const open = await assertAchDebitAllowed({
      accessToken: 'access-sandbox-test',
      accountId: LILY_PLAID_ACCOUNT_ID,
      amountCents: 90000,
      userId: 'ed270b84-ae0f-428f-8403-3ef878531cef',
      clientTransactionId: legacyLilyId,
      context: 'rent',
    }, {
      evaluateAchRisk: async () => { throw signalErr; },
    });
    assert.strictEqual(open.ok, true, 'Signal INVALID_FIELD must not block Stripe charge');

    const blocked = await assertAchDebitAllowed({
      accessToken: 'access-sandbox-test',
      accountId: LILY_PLAID_ACCOUNT_ID,
      amountCents: 90000,
      userId: 'ed270b84-ae0f-428f-8403-3ef878531cef',
      clientTransactionId: LILY_PAYMENT_ID,
      context: 'rent',
    }, {
      evaluateAchRisk: async () => ({ rulesetResult: 'REROUTE' }),
    });
    assert.strictEqual(blocked.ok, false, 'Signal REROUTE still blocks');
    assert.strictEqual(blocked.status, 402);
    assert.strictEqual(blocked.body.error, 'ACH_RISK_BLOCKED');

    process.env.PLAID_BALANCE_CHECK_ENABLED = 'true';
    const balanceOpen = await assertAchDebitAllowed({
      accessToken: 'access-sandbox-test',
      accountId: LILY_PLAID_ACCOUNT_ID,
      amountCents: 90000,
      userId: 'ed270b84-ae0f-428f-8403-3ef878531cef',
      clientTransactionId: LILY_PAYMENT_ID,
      context: 'rent',
    }, {
      evaluateAchRisk: async () => ({ rulesetResult: 'ACCEPT' }),
      getAvailableBalance: async () => {
        throw Object.assign(new Error('Request failed with status code 400'), {
          response: { data: { error_code: 'INVALID_FIELD', error_message: 'balance unavailable' } },
        });
      },
    });
    assert.strictEqual(balanceOpen.ok, true, 'Balance API errors must not block Stripe charge');
  } finally {
    if (prevSignal == null) delete process.env.PLAID_SIGNAL_ENABLED;
    else process.env.PLAID_SIGNAL_ENABLED = prevSignal;
    if (prevBalance == null) delete process.env.PLAID_BALANCE_CHECK_ENABLED;
    else process.env.PLAID_BALANCE_CHECK_ENABLED = prevBalance;
  }
}

// ── Saved Plaid-linked checking uses Stripe PM, not raw ACH numbers ─────────
const lilyBank = {
  stripe_customer_id: LILY_CUSTOMER,
  stripe_bank_account_id: LILY_SAVED_PM,
  plaid_access_token_encrypted: 'encrypted-token',
  plaid_account_id: LILY_PLAID_ACCOUNT_ID,
  status: 'verified',
  link_status: 'active',
  institution_name: 'Chime',
  account_type: 'checking',
};

const lilySource = resolveAchChargeSource(lilyBank);
assert.strictEqual(lilySource.customerId, LILY_CUSTOMER);
assert.strictEqual(lilySource.paymentMethodId, LILY_SAVED_PM);
assert.strictEqual(lilySource.needsPlaidNumbers, false, 'saved us_bank_account must not re-fetch Plaid Auth numbers');
assert.strictEqual(lilySource.canRunSignal, true);

const noPm = resolveAchChargeSource({
  stripe_customer_id: LILY_CUSTOMER,
  stripe_bank_account_id: null,
  plaid_access_token_encrypted: 'encrypted-token',
  plaid_account_id: LILY_PLAID_ACCOUNT_ID,
});
assert.strictEqual(noPm.paymentMethodId, null);
assert.strictEqual(noPm.needsPlaidNumbers, true, 'no saved PM still uses Plaid Auth numbers');

const noPlaid = resolveAchChargeSource({
  stripe_customer_id: LILY_CUSTOMER,
  stripe_bank_account_id: LILY_SAVED_PM,
  plaid_access_token_encrypted: null,
  plaid_account_id: null,
});
assert.strictEqual(noPlaid.needsPlaidNumbers, false);
assert.strictEqual(noPlaid.canRunSignal, false, 'manual/saved PM without Plaid still charges');

const savedIntent = buildAchIntentParams({
  amountCents: 90000,
  customerId: LILY_CUSTOMER,
  paymentMethodId: LILY_SAVED_PM,
  description: 'Rent — September 2026',
  metadata: { payment_id: LILY_PAYMENT_ID },
  ipAddress: '1.2.3.4',
  userAgent: 'Mozilla/5.0',
});
assert.strictEqual(savedIntent.payment_method, LILY_SAVED_PM);
assert.strictEqual(savedIntent.customer, LILY_CUSTOMER);
assert.deepStrictEqual(savedIntent.payment_method_types, ['us_bank_account']);
assert.ok(!savedIntent.payment_method_data, 'saved PM must not send raw routing/account');
assert.ok(savedIntent.mandate_data, 'tenant-present ACH includes mandate_data');
assert.strictEqual(savedIntent.confirm, true);

const rawIntent = buildAchIntentParams({
  amountCents: 90000,
  customerId: LILY_CUSTOMER,
  routingNumber: '110000000',
  accountNumber: '000123456789',
  accountHolderName: 'Lily Fortman',
  description: 'Rent',
  metadata: {},
  ipAddress: '1.2.3.4',
  userAgent: 'Mozilla/5.0',
});
assert.ok(rawIntent.payment_method_data, 'fallback still uses routing numbers when no saved PM');
assert.ok(!rawIntent.payment_method);

// ── Charge route wiring ─────────────────────────────────────────────────────
const chargeSrc = read('src/routes/payments.routes.js');
assert.match(chargeSrc, /resolveAchChargeSource/, 'charge route uses saved-PM resolver');
assert.match(chargeSrc, /paymentMethodId/, 'charge route passes saved us_bank_account to Stripe');
assert.match(chargeSrc, /signalClientTransactionId/, 'charge route sends a Plaid-legal Signal id');
assert.doesNotMatch(
  chargeSrc,
  /clientTransactionId:\s*`rent-\$\{payment\.id\}`/,
  'must not send rent-<uuid> (41 chars) to Plaid Signal'
);

const chimeSrc = read('src/utils/chime-ach-bank.js');
assert.match(chimeSrc, /Chime doesn't allow bank ACH for rent/, 'keep Chime debit-card fallback copy');

testSignalGuard()
  .then(() => {
    console.log('test-ach-charge-path OK');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
