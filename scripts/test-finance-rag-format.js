#!/usr/bin/env node
/**
 * Owner finance RAG formatting — money strings + checklist lines for AI context.
 * Bad formatting misleads owner chat about mortgage/due amounts.
 * Run: npm run test:finance-rag-format
 */
'use strict';

const assert = require('assert');

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://unit:unit@127.0.0.1:5432/unit_test_unused';

const {
  fmtMoney,
  formatFinanceRagContext,
} = require('../src/services/mortgage-statement.service');

assert.strictEqual(fmtMoney(null), 'unknown');
assert.strictEqual(fmtMoney(undefined), 'unknown');
assert.strictEqual(fmtMoney(2265.37), '$2,265.37');
assert.strictEqual(fmtMoney(100), '$100.00');
assert.strictEqual(fmtMoney('90.5'), '$90.50');

{
  const empty = formatFinanceRagContext(null, []);
  assert.ok(empty.includes('## Mortgage: no statements imported yet.'));
  assert.ok(empty.includes('- No checklist items configured.'));
  assert.ok(empty.includes('/api/utilities'));
}

{
  const ctx = formatFinanceRagContext(
    {
      statement_date: '2026-07-15',
      due_date: '2026-08-01',
      amount_due: 2265.37,
      monthly_payment: 2265.37,
      principal_balance: 312000.5,
      escrow_balance: 1200,
      interest_rate: 6.125,
      servicer: 'Newrez',
      raw_text: 'STATEMENT BODY '.repeat(400),
      metadata: {
        last_payment_date: '2026-07-01',
        last_payment_amount: 2265.37,
      },
    },
    [
      {
        category: 'mortgage',
        label: 'Mortgage (Newrez)',
        amount_estimate: 2265.37,
        due_day: 1,
        payment_method: 'ach',
        notes: '743 A Ave',
        last_paid_at: new Date('2026-07-01T12:00:00Z'),
        last_verified_at: null,
      },
      {
        category: 'vivint',
        label: 'Vivint Smart Home',
        amount_estimate: null,
        due_day: null,
        payment_method: 'credit_card',
        notes: null,
        last_paid_at: null,
        last_verified_at: new Date('2026-07-10T12:00:00Z'),
      },
    ]
  );

  assert.ok(ctx.includes('## Latest mortgage statement (Newrez)'));
  assert.ok(ctx.includes('- Total amount due: $2,265.37'));
  assert.ok(ctx.includes('- Interest rate: 6.125%'));
  assert.ok(ctx.includes('- Last payment: $2,265.37 on 2026-07-01'));
  assert.ok(ctx.includes('### Statement excerpt'));
  assert.ok(ctx.includes('STATEMENT BODY'));
  assert.ok(ctx.split('STATEMENT BODY').length - 1 <= 400);
  // Excerpt is capped at 3500 chars of raw_text
  const excerpt = ctx.split('### Statement excerpt\n')[1].split('\n\n')[0];
  assert.ok(excerpt.length <= 3500);

  assert.ok(
    ctx.includes(
      '- Mortgage (Newrez) (mortgage): est $2,265.37, due ~day 1, via ach — paid 2026-07-01; not verified — 743 A Ave'
    )
  );
  assert.ok(
    ctx.includes(
      '- Vivint Smart Home (vivint): est unknown, via credit_card — not marked paid this cycle; verified 2026-07-10'
    )
  );
}

console.log('test-finance-rag-format: OK');
