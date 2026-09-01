#!/usr/bin/env node
/**
 * Unit checks for Chime / Stride / Bancorp ACH initiation error copy.
 * Run: node scripts/test-chime-ach-initiation.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  isChimePartnerBank,
  achInitiationFailure,
  CHIME_ACH_NOT_SUPPORTED,
  ACH_INITIATION_FAILED,
  CHIME_ACH_NOT_SUPPORTED_MESSAGE,
  ACH_INITIATION_FAILED_MESSAGE,
} = require('../src/utils/chime-ach-bank');

const root = path.resolve(__dirname, '..');

function assertFalse(cond, msg) {
  assert.strictEqual(cond, false, msg);
}

function assertTrue(cond, msg) {
  assert.strictEqual(cond, true, msg);
}

// Name / Plaid institution / routing detection
assertTrue(isChimePartnerBank({ institutionName: 'Chime' }), 'Chime name');
assertTrue(isChimePartnerBank({ institutionName: 'CHIME CHECKING' }), 'Chime name case-insensitive');
assertTrue(isChimePartnerBank({ institutionName: 'Stride Bank, N.A.' }), 'Stride Bank name');
assertTrue(isChimePartnerBank({ institutionName: 'The Bancorp Bank, N.A.' }), 'Bancorp Bank name');
assertTrue(isChimePartnerBank({ institutionId: 'ins_35' }), 'Plaid Chime institution id');
assertTrue(isChimePartnerBank({ institutionId: 'INS_35' }), 'Plaid Chime institution id case');
assertTrue(isChimePartnerBank({ routingNumber: '031101279' }), 'Bancorp Chime routing');
assertTrue(isChimePartnerBank({ routingNumber: '103100195' }), 'Stride Chime routing');
assertTrue(
  isChimePartnerBank({ routingNumber: '031-101279' }),
  'routing digits only'
);

assertFalse(isChimePartnerBank({}), 'empty bank is not Chime');
assertFalse(isChimePartnerBank({ institutionName: 'Chase' }), 'Chase name is not Chime');
assertFalse(isChimePartnerBank({ institutionName: 'Bank of America' }), 'BofA is not Chime');
assertFalse(isChimePartnerBank({ institutionName: 'BancorpSouth' }), 'BancorpSouth is not Chime');
assertFalse(isChimePartnerBank({ institutionName: 'First Bancorp' }), 'First Bancorp is not Chime');
assertFalse(isChimePartnerBank({ institutionId: 'ins_3' }), 'Chase Plaid id is not Chime');
assertFalse(isChimePartnerBank({ routingNumber: '021000021' }), 'Chase routing is not Chime');
assertFalse(isChimePartnerBank({ routingNumber: '110000000' }), 'Stripe test routing is not Chime');
assertFalse(
  isChimePartnerBank({ routingNumber: '124303120' }),
  'Green Dot / Bonneville ABA is not Chime'
);

function expectChime(bank, label) {
  const body = achInitiationFailure(bank);
  assert.strictEqual(body.error, CHIME_ACH_NOT_SUPPORTED, `${label} error code`);
  assert.strictEqual(body.message, CHIME_ACH_NOT_SUPPORTED_MESSAGE, `${label} message`);
  assert.match(body.message, /Chime/i, `${label} mentions Chime`);
  assert.match(body.message, /debit card/i, `${label} points at debit card`);
  assert.doesNotMatch(body.message, /decline/i, `${label} is not a Stripe decline`);
  assert.doesNotMatch(body.message, /fixed/i, `${label} does not say it is fixed`);
}

function expectGeneric(bank, label) {
  const body = achInitiationFailure(bank);
  assert.strictEqual(body.error, ACH_INITIATION_FAILED, `${label} error code`);
  assert.strictEqual(body.message, ACH_INITIATION_FAILED_MESSAGE, `${label} message`);
  assert.doesNotMatch(body.message, /Chime/i, `${label} must not claim Chime`);
  assert.doesNotMatch(body.message, /Stride/i, `${label} must not claim Stride`);
  assert.doesNotMatch(body.message, /Bancorp/i, `${label} must not claim Bancorp`);
  assert.doesNotMatch(body.message, /decline/i, `${label} is not a Stripe decline`);
}

expectChime({ institutionName: 'Chime' }, 'Chime ACH initiation');
expectChime({ institutionName: 'Stride Bank' }, 'Stride ACH initiation');
expectChime({ institutionName: 'The Bancorp Bank' }, 'Bancorp ACH initiation');
expectChime({ routingNumber: '031101279' }, 'Bancorp routing ACH initiation');
expectChime({ routingNumber: '103100195' }, 'Stride routing ACH initiation');
expectChime({ institutionId: 'ins_35' }, 'Plaid Chime ACH initiation');

expectGeneric({}, 'unknown bank ACH initiation');
expectGeneric({ institutionName: 'Navy Federal Credit Union' }, 'unknown credit union ACH');
expectGeneric({ institutionId: 'ins_3', routingNumber: '021000021' }, 'Chase ACH initiation');
expectGeneric({ routingNumber: '124303120' }, 'Green Dot ABA must not use Chime debit-card copy');

// Charge route wires the helper; card / Cash App catch copy stays unchanged.
const paymentsRoutes = fs.readFileSync(path.join(root, 'src/routes/payments.routes.js'), 'utf8');
const chargeHandler = paymentsRoutes.slice(
  paymentsRoutes.indexOf("router.post('/charge'"),
  paymentsRoutes.indexOf('function tenantStripeClientConfig')
);
assert.match(
  chargeHandler,
  /achInitiationFailure/,
  'POST /charge uses achInitiationFailure for pre-PaymentIntent failures'
);
assert.match(
  chargeHandler,
  /institution_name, institution_id/,
  'POST /charge loads Plaid institution fields for bank detection'
);
assert.match(
  chargeHandler,
  /if \(!stripePaymentIntentId\)/,
  'POST /charge only uses bank ACH copy when no PaymentIntent exists'
);

const cashAppCatch = paymentsRoutes.slice(
  paymentsRoutes.indexOf("router.post('/cashapp/create-intent'")
);
const cashAppHandler = cashAppCatch.slice(0, cashAppCatch.indexOf("router.post('/card/create-intent'"));
assert(
  cashAppHandler.includes("error: 'CASHAPP_INTENT_FAILED'"),
  'Cash App create-intent still uses CASHAPP_INTENT_FAILED'
);
assert(
  cashAppHandler.includes('Could not start Cash App payment.'),
  'Cash App create-intent catch copy is unchanged'
);
assertFalse(
  cashAppHandler.includes('achInitiationFailure'),
  'Cash App path does not use Chime ACH helper'
);
assertFalse(
  cashAppHandler.includes('CHIME_ACH_NOT_SUPPORTED'),
  'Cash App path does not emit Chime ACH code'
);

const cardCatch = paymentsRoutes.slice(paymentsRoutes.indexOf("router.post('/card/create-intent'"));
const cardHandler = cardCatch.slice(0, cardCatch.indexOf("router.get('/cashapp/sync'"));
assert(
  cardHandler.includes("error: 'CARD_INTENT_FAILED'"),
  'Card create-intent still uses CARD_INTENT_FAILED'
);
assert(
  cardHandler.includes('Could not start card payment.'),
  'Card create-intent catch copy is unchanged'
);
assertFalse(
  cardHandler.includes('achInitiationFailure'),
  'Card path does not use Chime ACH helper'
);
assertFalse(
  cardHandler.includes('CHIME_ACH_NOT_SUPPORTED'),
  'Card path does not emit Chime ACH code'
);

const paymentsPage = fs.readFileSync(
  path.join(root, 'client/src/pages/tenant/Payments.jsx'),
  'utf8'
);
assert(
  paymentsPage.includes("apiErrorMessage(err, 'Cash App payment could not be started.')"),
  'tenant Cash App fallback copy is unchanged'
);
assert(
  paymentsPage.includes("apiErrorMessage(err, 'Card payment could not be started.')"),
  'tenant card fallback copy is unchanged'
);
assertFalse(
  paymentsPage.includes('CHIME_ACH_NOT_SUPPORTED'),
  'tenant Pay UI does not add a Chime-specific pay button or path'
);

async function testClientErrorMap() {
  const { apiErrorMessage, PAYMENT_ERROR_MESSAGES } = await import(
    path.join(root, 'client/src/utils/apiErrorMessage.js')
  );

  assert.strictEqual(
    PAYMENT_ERROR_MESSAGES.CHIME_ACH_NOT_SUPPORTED,
    CHIME_ACH_NOT_SUPPORTED_MESSAGE,
    'client Chime fallback matches server copy'
  );
  assert.strictEqual(
    PAYMENT_ERROR_MESSAGES.ACH_INITIATION_FAILED,
    ACH_INITIATION_FAILED_MESSAGE,
    'client generic ACH fallback matches server copy'
  );
  assert.strictEqual(
    PAYMENT_ERROR_MESSAGES.CASHAPP_NOT_CONFIGURED,
    'Cash App Pay is not available right now. Pay with bank (ACH) or contact your property manager.',
    'Cash App configured-error copy is unchanged'
  );
  assert.strictEqual(
    PAYMENT_ERROR_MESSAGES.CHARGE_FAILED,
    ACH_INITIATION_FAILED_MESSAGE,
    'legacy CHARGE_FAILED maps to generic ACH initiation copy, not Chime'
  );

  const chimeErr = {
    response: {
      status: 400,
      data: achInitiationFailure({ institutionName: 'Stride Bank' }),
    },
  };
  assert.strictEqual(
    apiErrorMessage(chimeErr, 'Payment failed. Please try again.'),
    CHIME_ACH_NOT_SUPPORTED_MESSAGE,
    'tenant Pay UI shows Chime reason from /charge 4xx'
  );

  const unknownErr = {
    response: {
      status: 400,
      data: achInitiationFailure({ institutionName: 'Wells Fargo' }),
    },
  };
  const unknownMsg = apiErrorMessage(unknownErr, 'Payment failed. Please try again.');
  assert.strictEqual(unknownMsg, ACH_INITIATION_FAILED_MESSAGE, 'unknown bank uses generic ACH copy');
  assert.doesNotMatch(unknownMsg, /Chime/, 'unknown bank UI copy does not mention Chime');

  const cardErr = {
    response: {
      status: 500,
      data: { error: 'CARD_INTENT_FAILED', message: 'Could not start card payment.' },
    },
  };
  assert.strictEqual(
    apiErrorMessage(cardErr, 'Card payment could not be started.'),
    'Could not start card payment.',
    'card path still shows card initiation copy'
  );

  const cashAppErr = {
    response: {
      status: 500,
      data: { error: 'CASHAPP_INTENT_FAILED', message: 'Could not start Cash App payment.' },
    },
  };
  assert.strictEqual(
    apiErrorMessage(cashAppErr, 'Cash App payment could not be started.'),
    'Could not start Cash App payment.',
    'Cash App path still shows Cash App initiation copy'
  );

  const cashAppCodeOnly = {
    response: { status: 503, data: { error: 'CASHAPP_NOT_CONFIGURED' } },
  };
  assert.strictEqual(
    apiErrorMessage(cashAppCodeOnly, 'Cash App payment could not be started.'),
    PAYMENT_ERROR_MESSAGES.CASHAPP_NOT_CONFIGURED,
    'Cash App code-only fallback is unchanged'
  );
}

testClientErrorMap()
  .then(() => {
    console.log('chime ACH initiation checks passed');
  })
  .catch((err) => {
    console.error('FAIL:', err.message);
    process.exit(1);
  });
