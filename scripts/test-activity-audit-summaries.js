/**
 * Unit tests for activity audit path capture + Stripe-like payment summaries.
 * Run: node scripts/test-activity-audit-summaries.js
 */
const assert = require('assert');
const { shouldCapture, requestPath } = require('../src/middleware/activity-audit');
const {
  buildSummary,
  formatPaymentSummary,
  logSessionOpen,
  SESSION_OPEN_DEBOUNCE_HOURS,
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

assert.strictEqual(SESSION_OPEN_DEBOUNCE_HOURS, 4);

(async () => {
  // Debounce: recent login/session skips a second "opened the portal" row.
  let logCalls = 0;
  const debounced = await logSessionOpen({
    userId: 'u-debounce',
    ip: '1.1.1.1',
    db: {
      async query(sql, params) {
        assert.ok(sql.includes("action IN ('login', 'session')"));
        assert.deepStrictEqual(params, ['u-debounce', 4]);
        return { rows: [{ '?column?': 1 }] };
      },
    },
    log: async () => {
      logCalls += 1;
      return { id: 'should-not' };
    },
  });
  assert.strictEqual(debounced, null);
  assert.strictEqual(logCalls, 0);

  const logged = await logSessionOpen({
    userId: 'u-fresh',
    ip: '2.2.2.2',
    db: { async query() { return { rows: [] }; } },
    log: async (payload) => {
      logCalls += 1;
      assert.strictEqual(payload.path, '/auth/refresh');
      assert.strictEqual(payload.realActorId, 'u-fresh');
      assert.strictEqual(payload.ip, '2.2.2.2');
      return { id: 'session-1' };
    },
  });
  assert.strictEqual(logged.id, 'session-1');
  assert.strictEqual(logCalls, 1);
  assert.strictEqual(await logSessionOpen({ userId: null }), null);

  console.log('test-activity-audit-summaries OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
