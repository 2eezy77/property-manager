/**
 * Unit tests for activity audit path capture + Stripe-like payment summaries.
 * Run: node scripts/test-activity-audit-summaries.js
 */
const assert = require('assert');
const { shouldCapture, requestPath } = require('../src/middleware/activity-audit');
const {
  buildSummary,
  formatPaymentSummary,
} = require('../src/services/activity-audit.service');

// Mount-safe path: router-relative req.path must not win over originalUrl
assert.strictEqual(
  requestPath({ path: '/charge', originalUrl: '/api/payments/charge?x=1', baseUrl: '/api/payments' }),
  '/api/payments/charge'
);
assert.strictEqual(
  requestPath({ path: '/create-intent', originalUrl: '/api/payments/card/create-intent', baseUrl: '/api/payments' }),
  '/api/payments/card/create-intent'
);

assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    path: '/charge',
    originalUrl: '/api/payments/charge',
    baseUrl: '/api/payments',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'GET',
    path: '/sync',
    originalUrl: '/api/payments/cashapp/sync',
    baseUrl: '/api/payments',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'GET',
    path: '/me',
    originalUrl: '/auth/me',
  }),
  false
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'GET',
    path: '/balance',
    originalUrl: '/api/payments/balance',
  }),
  false
);

// Noise stays out; current payroll / identity / visit routes stay in
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/payments/plaid/link-token',
  }),
  false
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/owner/property-bank/plaid/link-token',
  }),
  false
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/site-visits/payout-bank/plaid/link-token',
  }),
  false
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'PATCH',
    originalUrl: '/api/users/me/checkin',
  }),
  false
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/payments/plaid/exchange',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/messages',
  }),
  false
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/utilities/bills/abc/notify',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/site-visits/payroll/cashapp/create-intent',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/site-visits/payroll/cancel-processing',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'GET',
    originalUrl: '/api/site-visits/payroll/cashapp/sync?payment_intent=pi_x',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/site-visits/visit-1/reschedule',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/leases/lease-1/identity/fee',
  }),
  true
);
assert.strictEqual(
  shouldCapture({
    user: { id: 'u1' },
    method: 'POST',
    originalUrl: '/api/manager-compensation/lease-signing/fee-1/cashapp/create-intent',
  }),
  true
);

const actor = { first_name: 'Osanin', last_name: 'Murillo', email: 'o@x.com' };

assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/auth/login',
    statusCode: 200,
    body: {},
  }),
  'Osanin Murillo signed in'
);
assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/auth/refresh',
    statusCode: 200,
    body: {},
  }),
  'Osanin Murillo opened the portal'
);

assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/payments/charge',
    statusCode: 200,
    body: { paymentType: 'utility', amount: 68.41 },
  }),
  'Osanin Murillo submitted $68.41 utilities payment via ACH'
);
assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/payments/card/create-intent',
    statusCode: 200,
    body: { paymentType: 'utility' },
  }),
  'Osanin Murillo started utilities payment via card'
);
assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/payments/cashapp/create-intent',
    statusCode: 400,
    body: { paymentType: 'rent', amount: 1200 },
  }),
  'Osanin Murillo failed rent payment $1200.00 via Cash App'
);
assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/events/payment_confirmed',
    statusCode: 200,
    body: {
      paymentType: 'utility',
      amount: 68.41,
      payment_method: 'card',
    },
  }),
  'Osanin Murillo paid $68.41 utilities via card'
);

assert.ok(
  formatPaymentSummary('Someone', {
    paymentType: 'rent',
    amount: 10,
    method: 'ACH',
    statusCode: 200,
    phase: 'confirmed',
  }).includes('paid $10.00 rent via ACH')
);

assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/site-visits/visit-1/reschedule',
    statusCode: 200,
    body: {},
  }),
  'Osanin Murillo changed a boots-on-site visit date (tenant notices updated when applicable)'
);
assert.strictEqual(
  buildSummary({
    actor: { first_name: 'Jose', last_name: 'Montero' },
    method: 'POST',
    path: '/api/site-visits/payroll/cashapp/create-intent',
    statusCode: 201,
    body: { customAmount: 100, payVisits: true },
  }),
  'Jose Montero started Cash App pay for site visits plus $100.00 other work'
);
assert.strictEqual(
  buildSummary({
    actor: { first_name: 'Jose', last_name: 'Montero' },
    method: 'POST',
    path: '/api/site-visits/payroll/cancel-processing',
    statusCode: 200,
    body: {},
  }),
  'Jose Montero cancelled an in-progress Konstantin payroll payment'
);
assert.strictEqual(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/leases/lease-1/identity/session',
    statusCode: 200,
    body: {},
  }),
  'Osanin Murillo started Stripe Identity verification'
);

console.log('test-activity-audit-summaries OK');
