#!/usr/bin/env node
/**
 * Manager Payments month grouping + method labels.
 * Run: node scripts/test-manager-payment-months.js
 */
'use strict';

const assert = require('assert');

async function main() {
  const {
    monthKeyFromDate,
    paymentMonthKey,
    groupPaymentsByMonth,
    paymentMethodLabel,
    monthLabelFromKey,
  } = await import('../client/src/utils/managerPaymentMonths.js');

  assert.strictEqual(monthKeyFromDate('2026-08-15T12:00:00.000Z'), '2026-08');
  assert.strictEqual(monthKeyFromDate(null), null);
  assert.strictEqual(monthKeyFromDate('not-a-date'), null);
  assert.strictEqual(monthLabelFromKey('2026-06'), 'June 2026');
  assert.strictEqual(monthLabelFromKey('unknown'), 'Unknown period');

  // Prefer period_start over paid_at / created_at (July rent paid in August)
  assert.strictEqual(
    paymentMonthKey({
      period_start: '2026-07-01',
      paid_at: '2026-08-03T15:00:00.000Z',
      created_at: '2026-08-03T15:00:00.000Z',
    }),
    '2026-07'
  );
  assert.strictEqual(
    paymentMonthKey({
      period_start: null,
      paid_at: '2026-08-03T15:00:00.000Z',
    }),
    '2026-08'
  );
  assert.strictEqual(paymentMonthKey({}), 'unknown');

  const rows = [
    {
      id: 1,
      period_start: '2026-08-01',
      amount: 900,
      status: 'succeeded',
      source: 'stripe_card',
    },
    {
      id: 2,
      period_start: '2026-08-01',
      amount: 450,
      status: 'pending',
      source: 'stripe_card',
    },
    {
      id: 3,
      period_start: '2026-07-01',
      amount: 900,
      status: 'succeeded',
      paid_at: '2026-08-02T12:00:00.000Z',
    },
    {
      id: 4,
      period_start: '2026-06-01',
      amount: 100,
      status: 'failed',
    },
  ];

  const groups = groupPaymentsByMonth(rows, { now: new Date('2026-08-15T12:00:00.000Z') });
  assert.strictEqual(groups.length, 3);
  assert.strictEqual(groups[0].key, '2026-08');
  assert.strictEqual(groups[0].isCurrent, true);
  assert.strictEqual(groups[0].count, 2);
  // Only succeeded amounts count toward collected
  assert.strictEqual(groups[0].collected, 900);
  assert.strictEqual(groups[1].key, '2026-07');
  assert.strictEqual(groups[1].collected, 900);
  assert.strictEqual(groups[1].isCurrent, false);
  assert.strictEqual(groups[2].key, '2026-06');
  assert.strictEqual(groups[2].collected, 0);

  // Method labels: never call Stripe card "ACH"
  assert.strictEqual(
    paymentMethodLabel({ source: 'stripe_card', stripe_payment_intent_id: 'pi_x' }),
    'Card'
  );
  assert.strictEqual(
    paymentMethodLabel({ source: 'stripe_card', partial_rent: 'true' }),
    'Card (partial)'
  );
  assert.strictEqual(paymentMethodLabel({ source: 'stripe_cashapp' }), 'Cash App Pay');
  assert.strictEqual(
    paymentMethodLabel({ source: 'cash_app_import' }),
    'Cash App (archived off-app)'
  );
  assert.strictEqual(
    paymentMethodLabel({ payment_method: 'zelle', partial_rent: 'true' }),
    'Zelle (partial)'
  );
  assert.strictEqual(
    paymentMethodLabel({ stripe_payment_intent_id: 'pi_ach', status: 'processing' }),
    'Bank (ACH)'
  );
  assert.strictEqual(paymentMethodLabel({ status: 'succeeded' }), 'ACH');
  assert.strictEqual(paymentMethodLabel({}), '—');

  console.log('test-manager-payment-months: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
