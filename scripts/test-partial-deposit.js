/**
 * Unit-style checks for partial security deposit credit helper.
 * Run: node scripts/test-partial-deposit.js
 */

'use strict';

const assert = require('assert');
const {
  roundMoney,
  parseMoney,
  applyDepositCredit,
} = require('../src/services/security-deposit-partial.service');
const { MIN_DEPOSIT_INSTALLMENT } = require('../src/services/rent-charge.service');

function mockClient(pending) {
  const state = {
    pending: { ...pending, metadata: { ...(pending.metadata || {}) } },
    leaseDepositPaidAt: null,
    updates: [],
  };
  return {
    state,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT id, amount, metadata')) {
        return { rows: state.pending ? [state.pending] : [] };
      }
      if (text.startsWith('UPDATE payments')) {
        state.updates.push({ sql: text, params });
        if (params[0] != null && typeof params[0] === 'number') {
          // amount / depositOriginal first arg for completed or remaining path
        }
        if (text.includes("status = 'succeeded'")) {
          state.pending = null;
        } else if (text.includes('SET amount =')) {
          const meta = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
          state.pending.amount = params[0];
          state.pending.metadata = { ...state.pending.metadata, ...meta };
        }
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('UPDATE leases')) {
        state.leaseDepositPaidAt = params[1];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in mock: ${text.slice(0, 80)}`);
    },
  };
}

async function run() {
  assert.strictEqual(roundMoney(10.005), 10.01);
  assert.strictEqual(parseMoney('12.5'), 12.5);
  assert.ok(MIN_DEPOSIT_INSTALLMENT >= 1);

  const client = mockClient({
    id: 'parent-1',
    amount: 1200,
    metadata: {
      deposit_original_amount: 1200,
      deposit_paid_total: 0,
      deposit_parts: [],
    },
  });

  const first = await applyDepositCredit(client, {
    leaseId: 'lease-1',
    creditAmount: 400,
    installmentPaymentId: 'inst-1',
    paidAt: new Date('2026-08-01T12:00:00Z'),
  });
  assert.strictEqual(first.remaining, 800);
  assert.strictEqual(first.paidTotal, 400);
  assert.strictEqual(first.completed, false);
  assert.strictEqual(client.state.pending.amount, 800);

  // Idempotent re-apply of same installment
  const again = await applyDepositCredit(client, {
    leaseId: 'lease-1',
    creditAmount: 400,
    installmentPaymentId: 'inst-1',
    paidAt: new Date('2026-08-01T12:01:00Z'),
  });
  assert.strictEqual(again.remaining, 800);
  assert.strictEqual(again.paidTotal, 400);
  assert.strictEqual(client.state.pending.amount, 800);

  const second = await applyDepositCredit(client, {
    leaseId: 'lease-1',
    creditAmount: 800,
    installmentPaymentId: 'inst-2',
    paidAt: new Date('2026-08-02T12:00:00Z'),
  });
  assert.strictEqual(second.remaining, 0);
  assert.strictEqual(second.paidTotal, 1200);
  assert.strictEqual(second.completed, true);
  assert.strictEqual(client.state.pending, null);
  assert.ok(client.state.leaseDepositPaidAt);

  console.log('test-partial-deposit: OK');
}

run().catch((err) => {
  console.error('test-partial-deposit: FAIL', err);
  process.exit(1);
});
