#!/usr/bin/env node
/**
 * Regression: security-deposit PaymentIntent race guards.
 * Blocks in-flight processing rows and cancel-vs-succeeded races so retries
 * cannot double-charge or leave stuck "in progress" deposits.
 *
 * Run: npm run test:deposit-pi-race
 */
'use strict';

const assert = require('assert');
const stripe = require('../src/services/stripe.service');
const {
  assertNoInFlightDeposit,
  cancelReplacedDepositPaymentIntent,
} = require('../src/services/rent-charge.service');

const originalRetrieve = stripe.retrievePaymentIntent;
const originalCancel = stripe.cancelPaymentIntent;

function mockClient(rows) {
  return {
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.includes("status = 'processing'")) {
        return { rows };
      }
      throw new Error(`Unexpected SQL in mock: ${text.slice(0, 100)}`);
    },
  };
}

async function withStripeStubs({ retrieve, cancel }, fn) {
  stripe.retrievePaymentIntent = retrieve || originalRetrieve;
  stripe.cancelPaymentIntent = cancel || originalCancel;
  try {
    return await fn();
  } finally {
    stripe.retrievePaymentIntent = originalRetrieve;
    stripe.cancelPaymentIntent = originalCancel;
  }
}

async function run() {
  // --- assertNoInFlightDeposit ---
  await assertNoInFlightDeposit(mockClient([]), 'lease-1');

  await assert.rejects(
    () => assertNoInFlightDeposit(mockClient([{ id: 'pay-processing' }]), 'lease-1'),
    (err) => err.code === 'DUPLICATE_PAYMENT'
  );

  // --- cancelReplacedDepositPaymentIntent ---
  const noop = await cancelReplacedDepositPaymentIntent(null);
  assert.deepStrictEqual(noop, { action: 'noop', pi: null });

  await withStripeStubs(
    {
      retrieve: async () => ({ id: 'pi_ok', status: 'succeeded' }),
    },
    async () => {
      const res = await cancelReplacedDepositPaymentIntent('pi_ok');
      assert.strictEqual(res.action, 'succeeded');
      assert.strictEqual(res.pi.id, 'pi_ok');
    }
  );

  await withStripeStubs(
    {
      retrieve: async () => ({ id: 'pi_proc', status: 'processing' }),
    },
    async () => {
      await assert.rejects(
        () => cancelReplacedDepositPaymentIntent('pi_proc'),
        (err) => err.code === 'DUPLICATE_PAYMENT'
      );
    }
  );

  await withStripeStubs(
    {
      retrieve: async () => ({ id: 'pi_canceled', status: 'canceled' }),
    },
    async () => {
      const res = await cancelReplacedDepositPaymentIntent('pi_canceled');
      assert.strictEqual(res.action, 'noop');
    }
  );

  let cancelCalls = 0;
  await withStripeStubs(
    {
      retrieve: async () => ({ id: 'pi_req', status: 'requires_payment_method' }),
      cancel: async () => {
        cancelCalls += 1;
        return { id: 'pi_req', status: 'canceled' };
      },
    },
    async () => {
      const res = await cancelReplacedDepositPaymentIntent('pi_req');
      assert.strictEqual(res.action, 'canceled');
      assert.strictEqual(cancelCalls, 1);
    }
  );

  // Cancel fails because Stripe already succeeded — treat as succeeded.
  let retrieveCount = 0;
  await withStripeStubs(
    {
      retrieve: async () => {
        retrieveCount += 1;
        if (retrieveCount === 1) return { id: 'pi_race', status: 'requires_confirmation' };
        return { id: 'pi_race', status: 'succeeded' };
      },
      cancel: async () => {
        throw new Error('PaymentIntent cannot be canceled');
      },
    },
    async () => {
      const res = await cancelReplacedDepositPaymentIntent('pi_race');
      assert.strictEqual(res.action, 'succeeded');
      assert.strictEqual(retrieveCount, 2);
    }
  );

  // Cancel fails and PI is now processing — still block duplicate.
  retrieveCount = 0;
  await withStripeStubs(
    {
      retrieve: async () => {
        retrieveCount += 1;
        if (retrieveCount === 1) return { id: 'pi_race2', status: 'requires_action' };
        return { id: 'pi_race2', status: 'processing' };
      },
      cancel: async () => {
        throw new Error('PaymentIntent cannot be canceled');
      },
    },
    async () => {
      await assert.rejects(
        () => cancelReplacedDepositPaymentIntent('pi_race2'),
        (err) => err.code === 'DUPLICATE_PAYMENT'
      );
    }
  );

  // Cancel fails but PI is already canceled — noop.
  retrieveCount = 0;
  await withStripeStubs(
    {
      retrieve: async () => {
        retrieveCount += 1;
        if (retrieveCount === 1) return { id: 'pi_race3', status: 'requires_payment_method' };
        return { id: 'pi_race3', status: 'canceled' };
      },
      cancel: async () => {
        throw new Error('PaymentIntent cannot be canceled');
      },
    },
    async () => {
      const res = await cancelReplacedDepositPaymentIntent('pi_race3');
      assert.strictEqual(res.action, 'noop');
    }
  );

  // Cancel fails and PI still open — rethrow cancel error.
  await withStripeStubs(
    {
      retrieve: async () => ({ id: 'pi_stuck', status: 'requires_payment_method' }),
      cancel: async () => {
        const err = new Error('network boom');
        err.code = 'STRIPE_CANCEL_FAIL';
        throw err;
      },
    },
    async () => {
      await assert.rejects(
        () => cancelReplacedDepositPaymentIntent('pi_stuck'),
        (err) => err.code === 'STRIPE_CANCEL_FAIL'
      );
    }
  );

  console.log('test-deposit-pi-race: OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
