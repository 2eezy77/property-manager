#!/usr/bin/env node
/**
 * Stripe Dashboard refunds must flip the matched payments row and drop it
 * from paid-vs-owed. Amounts below are the Isaiah 2026-09 card pair from
 * the incident: $450 ledger + $13.35 fee → Stripe charge $463.35.
 *
 * Run: node scripts/test-stripe-refund-webhook.js
 */

const assert = require('assert');
const { computeCardCashAppFee } = require('../src/services/payment-processing-fee.service');
const {
  refundStatusFromCharge,
  refundStatusFromRefund,
  stripeIdsFromRefundEvent,
  shouldSkipRefundApply,
  paidRentFromRows,
  applyStripeRefund,
} = require('../src/services/payment-refund.service');
const { ALL_WEBHOOK_EVENTS } = require('../src/services/stripe.service');
const stripeWebhook = require('../src/webhooks/stripe.webhook');
const pool = require('../src/db/client');

const fee = computeCardCashAppFee(45000);
assert.strictEqual(fee.feeCents, 1335, 'incident fee is $13.35 on $450');
assert.strictEqual(fee.totalCents, 46335, 'incident charge is $463.35');

const LEDGER_RENT = 450;
const CHARGE_CENTS = fee.totalCents;
const PARTIAL_REFUND_CENTS = 1335;

function computeTotalDue(monthlyRent, paidThisMonth, lateFeeBalance) {
  const rentRemaining = Math.max(0, Math.round((monthlyRent - paidThisMonth) * 100) / 100);
  return Math.round((rentRemaining + lateFeeBalance) * 100) / 100;
}

function makePayment(overrides = {}) {
  return {
    id: 'pay_530',
    status: 'succeeded',
    stripe_webhook_event_id: 'evt_succeeded_530',
    lease_id: 'lease_isaiah',
    tenant_id: 'tenant_isaiah',
    amount: LEDGER_RENT,
    payment_type: 'rent',
    metadata: {
      payment_method: 'card',
      source: 'stripe_card',
      charged_total: fee.totalAmount.toFixed(2),
      processing_fee: fee.processingFee.toFixed(2),
      processing_fee_cents: String(fee.feeCents),
      base_amount: fee.baseAmount.toFixed(2),
    },
    stripe_charge_id: 'ch_test_530',
    stripe_payment_intent_id: 'pi_test_530',
    ...overrides,
  };
}

function createFakeDb(seedPayments) {
  const payments = seedPayments.map((p) => ({ ...p, metadata: { ...(p.metadata || {}) } }));
  const notifications = [];
  const queries = [];

  async function query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    queries.push({ sql, params });

    if (normalized.startsWith('select') && normalized.includes('from payments')) {
      const chargeId = params[0];
      const piId = params[1];
      const matches = payments.filter((p) => (
        (chargeId && p.stripe_charge_id === chargeId)
        || (piId && p.stripe_payment_intent_id === piId)
      ));
      matches.sort((a, b) => {
        const aHit = chargeId && a.stripe_charge_id === chargeId ? 0 : 1;
        const bHit = chargeId && b.stripe_charge_id === chargeId ? 0 : 1;
        return aHit - bHit;
      });
      return { rows: matches.slice(0, 1) };
    }

    if (normalized.startsWith('update payments')) {
      const [nextStatus, eventId, chargeId, metaJson, paymentId] = params;
      const row = payments.find((p) => p.id === paymentId);
      if (!row || row.status === 'refunded') return { rows: [] };
      row.status = nextStatus;
      row.stripe_webhook_event_id = eventId;
      row.stripe_charge_id = row.stripe_charge_id || chargeId;
      row.metadata = { ...(row.metadata || {}), ...JSON.parse(metaJson) };
      return { rows: [{ ...row }] };
    }

    if (normalized.startsWith('insert into notifications')) {
      notifications.push({ params });
      return { rows: [] };
    }

    if (normalized.includes('utility_bill_splits')) {
      return { rows: [] };
    }

    throw new Error(`Unexpected refund test query: ${sql}`);
  }

  return { query, payments, notifications, queries };
}

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

async function run() {
  check(refundStatusFromCharge({
    amount: CHARGE_CENTS,
    amount_refunded: CHARGE_CENTS,
    refunded: true,
  }) === 'refunded', 'full Stripe charge refund → refunded');

  check(refundStatusFromCharge({
    amount: CHARGE_CENTS,
    amount_refunded: PARTIAL_REFUND_CENTS,
    refunded: false,
  }) === 'partially_refunded', 'partial Stripe charge refund → partially_refunded');

  check(refundStatusFromCharge({
    amount: CHARGE_CENTS,
    amount_refunded: 0,
    refunded: false,
  }) === null, 'no amount_refunded → no status change');

  const ids = stripeIdsFromRefundEvent({
    object: 'charge',
    id: 'ch_test_530',
    payment_intent: 'pi_test_530',
    amount: CHARGE_CENTS,
    amount_refunded: CHARGE_CENTS,
    refunded: true,
  });
  check(ids.chargeId === 'ch_test_530' && ids.paymentIntentId === 'pi_test_530', 'charge.refunded maps charge + PI ids');

  const refundIds = stripeIdsFromRefundEvent({
    object: 'refund',
    id: 're_test_1',
    charge: 'ch_test_530',
    payment_intent: { id: 'pi_test_530' },
    amount: CHARGE_CENTS,
    status: 'succeeded',
  });
  check(refundIds.chargeId === 'ch_test_530' && refundIds.paymentIntentId === 'pi_test_530', 'refund object maps charge + PI ids');

  const pay = makePayment();
  check(
    refundStatusFromRefund({ amount: CHARGE_CENTS, status: 'succeeded' }, pay) === 'refunded',
    'refund.updated of charged total → refunded'
  );
  check(
    refundStatusFromRefund({ amount: PARTIAL_REFUND_CENTS, status: 'succeeded' }, pay) === 'partially_refunded',
    'refund.updated of fee-only cents → partially_refunded'
  );
  check(
    refundStatusFromRefund({ amount: CHARGE_CENTS, status: 'failed' }, pay) === null,
    'failed refund object does not apply'
  );

  check(
    shouldSkipRefundApply(null, 'evt_1', 'refunded').reason === 'unknown_charge',
    'unknown charge is skipped'
  );
  check(
    shouldSkipRefundApply(makePayment({ stripe_webhook_event_id: 'evt_dup' }), 'evt_dup', 'refunded').reason === 'duplicate_event',
    'same event id is skipped'
  );
  check(
    shouldSkipRefundApply(makePayment({ status: 'refunded' }), 'evt_new', 'refunded').reason === 'already_refunded',
    'already refunded is skipped'
  );
  check(
    shouldSkipRefundApply(makePayment({ status: 'partially_refunded' }), 'evt_full', 'refunded').skip === false,
    'partial → full refund is allowed'
  );

  for (const ev of ['charge.refunded', 'charge.refund.updated', 'refund.created', 'refund.updated']) {
    check(ALL_WEBHOOK_EVENTS.includes(ev), `ALL_WEBHOOK_EVENTS includes ${ev}`);
  }

  const keep = makePayment({
    id: 'pay_528',
    stripe_charge_id: 'ch_3UAzCMBaVh1caty81hhAubkc',
    stripe_payment_intent_id: 'pi_test_528',
  });
  const refundMe = makePayment();
  const beforePaid = paidRentFromRows([keep, refundMe]);
  check(beforePaid === 900, `two succeeded $450 charges count as $${beforePaid} paid`);
  check(computeTotalDue(450, beforePaid, 0) === 0, 'before refund, $450 rent looks paid');

  const db = createFakeDb([keep, refundMe]);
  const applied = await applyStripeRefund(db, {
    eventId: 'evt_refund_530',
    charge: {
      object: 'charge',
      id: 'ch_test_530',
      payment_intent: 'pi_test_530',
      amount: CHARGE_CENTS,
      amount_refunded: CHARGE_CENTS,
      refunded: true,
    },
  });
  check(applied.applied === true && applied.status === 'refunded', 'charge.refunded marks the matched row refunded');
  check(db.payments.find((p) => p.id === 'pay_530').status === 'refunded', '5:30 payment is refunded');
  check(db.payments.find((p) => p.id === 'pay_528').status === 'succeeded', '5:28 payment stays succeeded');
  check(Number(db.payments.find((p) => p.id === 'pay_530').amount) === LEDGER_RENT, 'ledger amount stays $450 (not rewritten)');
  check(db.notifications.length === 1, 'one in-app refund notification');

  const afterPaid = paidRentFromRows(db.payments);
  check(afterPaid === LEDGER_RENT, `after refund, remaining succeeded charge still counts as $${afterPaid}`);
  check(computeTotalDue(450, afterPaid, 0) === 0, 'remaining $450 succeeded charge still covers $450 rent');
  check(computeTotalDue(900, afterPaid, 0) === 450, 'if monthly rent is $900, refunded charge re-opens $450');

  const replay = await applyStripeRefund(db, {
    eventId: 'evt_refund_530',
    charge: {
      object: 'charge',
      id: 'ch_test_530',
      payment_intent: 'pi_test_530',
      amount: CHARGE_CENTS,
      amount_refunded: CHARGE_CENTS,
      refunded: true,
    },
  });
  check(replay.applied === false && replay.reason === 'duplicate_event', 'replay of same event is skipped');
  check(db.notifications.length === 1, 'duplicate event does not notify again');

  const secondEvent = await applyStripeRefund(db, {
    eventId: 'evt_refund_530_sibling',
    charge: {
      object: 'charge',
      id: 'ch_test_530',
      payment_intent: 'pi_test_530',
      amount: CHARGE_CENTS,
      amount_refunded: CHARGE_CENTS,
      refunded: true,
    },
  });
  check(secondEvent.applied === false && secondEvent.reason === 'already_refunded', 'sibling event on already-refunded row is skipped');

  const unknown = await applyStripeRefund(createFakeDb([keep]), {
    eventId: 'evt_unknown',
    charge: {
      object: 'charge',
      id: 'ch_unknown',
      payment_intent: 'pi_unknown',
      amount: CHARGE_CENTS,
      amount_refunded: CHARGE_CENTS,
      refunded: true,
    },
  });
  check(unknown.applied === false && unknown.reason === 'unknown_charge', 'unknown charge is skipped');

  const partialDb = createFakeDb([makePayment({ id: 'pay_partial', stripe_charge_id: 'ch_partial', stripe_payment_intent_id: 'pi_partial' })]);
  const partial = await applyStripeRefund(partialDb, {
    eventId: 'evt_partial',
    charge: {
      object: 'charge',
      id: 'ch_partial',
      payment_intent: 'pi_partial',
      amount: CHARGE_CENTS,
      amount_refunded: PARTIAL_REFUND_CENTS,
      refunded: false,
    },
  });
  check(partial.applied === true && partial.status === 'partially_refunded', 'partial refund uses existing enum');
  check(paidRentFromRows(partialDb.payments) === 0, 'partially_refunded no longer counts toward paid');

  const byPi = createFakeDb([makePayment({
    stripe_charge_id: null,
    stripe_payment_intent_id: 'pi_only',
  })]);
  const viaPi = await applyStripeRefund(byPi, {
    eventId: 'evt_pi',
    charge: {
      object: 'charge',
      id: 'ch_later',
      payment_intent: 'pi_only',
      amount: CHARGE_CENTS,
      amount_refunded: CHARGE_CENTS,
      refunded: true,
    },
  });
  check(viaPi.applied === true, 'maps by stripe_payment_intent_id when charge id is not stored yet');

  const siblingDb = createFakeDb([makePayment({ id: 'pay_re', stripe_charge_id: 'ch_re', stripe_payment_intent_id: 'pi_re' })]);
  const viaRefundObj = await applyStripeRefund(siblingDb, {
    eventId: 'evt_re',
    refund: {
      object: 'refund',
      id: 're_1',
      charge: 'ch_re',
      payment_intent: 'pi_re',
      amount: CHARGE_CENTS,
      status: 'succeeded',
    },
  });
  check(viaRefundObj.applied === true && viaRefundObj.status === 'refunded', 'refund.updated sibling applies the same path');

  check(typeof stripeWebhook.__test.onChargeRefunded === 'function', 'webhook exports onChargeRefunded');
  check(typeof stripeWebhook.__test.handleEvent === 'function', 'webhook exports handleEvent');

  const originalQuery = pool.query;
  const hookDb = createFakeDb([makePayment()]);
  pool.query = hookDb.query.bind(hookDb);
  try {
    await stripeWebhook.__test.handleEvent({
      id: 'evt_handle_refunded',
      type: 'charge.refunded',
      data: {
        object: {
          object: 'charge',
          id: 'ch_test_530',
          payment_intent: 'pi_test_530',
          amount: CHARGE_CENTS,
          amount_refunded: CHARGE_CENTS,
          refunded: true,
        },
      },
    });
    check(hookDb.payments[0].status === 'refunded', 'handleEvent(charge.refunded) updates the payment');
  } finally {
    pool.query = originalQuery;
  }

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll Stripe refund webhook checks passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
