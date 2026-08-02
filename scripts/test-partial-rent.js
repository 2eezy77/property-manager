/**
 * Unit-style checks for partial rent credit + allocation.
 * Run: node scripts/test-partial-rent.js
 */

'use strict';

const assert = require('assert');
const {
  allocateTowardRentAndFees,
  applyRentCredit,
  applyLateFeeCredits,
  MIN_RENT_INSTALLMENT,
} = require('../src/services/rent-partial.service');

function mockClient({ pending, fees = [] }) {
  const state = {
    pending: pending
      ? { ...pending, metadata: { ...(pending.metadata || {}) } }
      : null,
    fees: fees.map((f) => ({ ...f })),
  };
  return {
    state,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.includes('FROM late_fees')) {
        return { rows: state.fees.filter((f) => ['pending', 'applied'].includes(f.status)) };
      }
      if (text.startsWith('UPDATE late_fees')) {
        const fee = state.fees.find((f) => f.id === params[0]);
        if (fee) fee.status = 'paid';
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("payment_type = 'rent'") && text.includes('FOR UPDATE')) {
        return { rows: state.pending ? [state.pending] : [] };
      }
      if (text.startsWith('UPDATE payments')) {
        if (text.includes("status = 'succeeded'")) {
          state.pending = null;
        } else if (text.includes('SET amount =')) {
          const meta = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
          state.pending.amount = params[0];
          state.pending.metadata = { ...state.pending.metadata, ...meta };
        }
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 100)}`);
    },
  };
}

async function run() {
  assert.ok(MIN_RENT_INSTALLMENT >= 1);

  const alloc = allocateTowardRentAndFees(500, 400, 150);
  assert.strictEqual(alloc.rentPortion, 400);
  assert.strictEqual(alloc.lateFeePortion, 100);
  assert.strictEqual(alloc.totalAllocated, 500);

  const client = mockClient({
    pending: {
      id: 'rent-parent',
      amount: 1200,
      metadata: { rent_original_amount: 1200, rent_paid_total: 0, rent_parts: [] },
    },
    fees: [{ id: 'fee-1', amount: 150, status: 'applied' }],
  });

  const first = await applyRentCredit(client, {
    leaseId: 'lease-1',
    periodStart: '2026-08-01',
    rentPortion: 400,
    lateFeePortion: 0,
    installmentPaymentId: 'inst-1',
  });
  assert.strictEqual(first.rentRemaining, 800);
  assert.strictEqual(first.completed, false);
  assert.strictEqual(client.state.pending.amount, 800);

  const again = await applyRentCredit(client, {
    leaseId: 'lease-1',
    periodStart: '2026-08-01',
    rentPortion: 400,
    lateFeePortion: 0,
    installmentPaymentId: 'inst-1',
  });
  assert.strictEqual(again.rentRemaining, 800);

  const fees = await applyLateFeeCredits(client, 'lease-1', 150);
  assert.strictEqual(fees.applied, 150);
  assert.strictEqual(client.state.fees[0].status, 'paid');

  const done = await applyRentCredit(client, {
    leaseId: 'lease-1',
    periodStart: '2026-08-01',
    rentPortion: 800,
    lateFeePortion: 0,
    installmentPaymentId: 'inst-2',
  });
  assert.strictEqual(done.completed, true);
  assert.strictEqual(client.state.pending, null);

  console.log('test-partial-rent: OK');
}

run().catch((err) => {
  console.error('test-partial-rent: FAIL', err);
  process.exit(1);
});
