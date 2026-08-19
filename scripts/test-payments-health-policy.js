#!/usr/bin/env node
/**
 * Regression: payments-health Stripe key mode + webhook URL host policy.
 * Mis-detecting live vs test or omitting www/bare webhook hosts causes silent
 * live payment/webhook failures.
 *
 * Run: npm run test:payments-health-policy
 */
'use strict';

const assert = require('assert');

const ORIGIN = process.env.CLIENT_ORIGIN;
const stripe = require('../src/services/stripe.service');

function loadFresh() {
  const path = require.resolve('../src/services/payments-health.service');
  delete require.cache[path];
  return require('../src/services/payments-health.service');
}

try {
  const { stripeKeyMode, expectedWebhookUrls } = loadFresh();

  assert.strictEqual(stripeKeyMode('sk_live_abc'), 'live');
  assert.strictEqual(stripeKeyMode('pk_live_abc'), 'live');
  assert.strictEqual(stripeKeyMode('sk_test_abc'), 'test');
  assert.strictEqual(stripeKeyMode('pk_test_abc'), 'test');
  assert.strictEqual(stripeKeyMode('rk_live_nope'), 'unknown');
  assert.strictEqual(stripeKeyMode(''), 'unknown');

  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  let urls = loadFresh().expectedWebhookUrls();
  for (const base of stripe.PRODUCTION_WEBHOOK_URLS) {
    assert.ok(urls.includes(base), `includes production webhook ${base}`);
  }
  assert.ok(
    !urls.some((u) => /localhost/i.test(u)),
    'localhost CLIENT_ORIGIN must not invent webhook hosts'
  );

  process.env.CLIENT_ORIGIN = 'https://www.example-rentals.test';
  urls = loadFresh().expectedWebhookUrls();
  assert.ok(urls.includes('https://www.example-rentals.test/webhooks/stripe'));
  assert.ok(urls.includes('https://example-rentals.test/webhooks/stripe'));

  process.env.CLIENT_ORIGIN = 'example-rentals.test';
  urls = loadFresh().expectedWebhookUrls();
  assert.ok(urls.includes('https://www.example-rentals.test/webhooks/stripe'));
  assert.ok(urls.includes('https://example-rentals.test/webhooks/stripe'));

  process.env.CLIENT_ORIGIN = 'not a url :::';
  urls = loadFresh().expectedWebhookUrls();
  assert.deepStrictEqual(
    urls.sort(),
    [...stripe.PRODUCTION_WEBHOOK_URLS].sort(),
    'malformed CLIENT_ORIGIN falls back to production list only'
  );

  console.log('test-payments-health-policy: OK');
} finally {
  if (ORIGIN === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = ORIGIN;
  delete require.cache[require.resolve('../src/services/payments-health.service')];
}
