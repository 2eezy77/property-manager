#!/usr/bin/env node
/**
 * Cash App pre-lease reallocation edges.
 * June rent paid before a July lease start must land on the first lease month —
 * but only inside the 45-day window and only when the total covers full rent.
 * Run: npm run test:cashapp-prelease-realloc
 */
'use strict';

const assert = require('assert');
const {
  reallocatePreLeaseMonths,
  filterByLeaseStart,
} = require('../src/services/cashapp-import.service');

function monthAlloc({ periodStart, periodEnd, periodLabel, amount, paidAt, parts }) {
  return {
    periodStart,
    periodEnd,
    periodLabel,
    amount,
    paidAt,
    parts: parts || [
      {
        transactionId: `tx-${paidAt}`,
        dateIso: paidAt,
        amount,
        notes: 'rent',
        sender: 'Stone',
      },
    ],
  };
}

const tenant = {
  start_date: '2026-07-01',
  monthly_rent: '900',
};

// Happy path: mid-June pay (≥45d window) → July lease month
{
  const out = reallocatePreLeaseMonths(
    {
      months: [
        monthAlloc({
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodLabel: 'June 2026',
          amount: 900,
          paidAt: '2026-06-20',
        }),
      ],
      unallocated: [],
      overages: [],
    },
    tenant
  );
  assert.strictEqual(out.months.length, 1);
  assert.strictEqual(out.months[0].periodStart, '2026-07-01');
  assert.strictEqual(out.months[0].amount, 900);
  assert.strictEqual(out.months[0].paidAt, '2026-06-20');
}

// Outside 45-day window: early May pay for July lease stays out (then filtered)
{
  const out = reallocatePreLeaseMonths(
    {
      months: [
        monthAlloc({
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          periodLabel: 'May 2026',
          amount: 900,
          paidAt: '2026-05-02',
        }),
      ],
      unallocated: [],
    },
    tenant
  );
  assert.strictEqual(out.months.length, 0, 'too-early pre-lease months must not invent July');
}

// Shortfall: partial pre-lease total must not invent a full lease month
{
  const out = reallocatePreLeaseMonths(
    {
      months: [
        monthAlloc({
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodLabel: 'June 2026',
          amount: 450,
          paidAt: '2026-06-18',
        }),
      ],
      unallocated: [],
    },
    tenant
  );
  assert.strictEqual(out.months.length, 0);
}

// First lease month already present: leave June out (do not duplicate July)
{
  const out = reallocatePreLeaseMonths(
    {
      months: [
        monthAlloc({
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodLabel: 'June 2026',
          amount: 900,
          paidAt: '2026-06-20',
        }),
        monthAlloc({
          periodStart: '2026-07-01',
          periodEnd: '2026-07-31',
          periodLabel: 'July 2026',
          amount: 900,
          paidAt: '2026-07-05',
        }),
      ],
      unallocated: [],
    },
    tenant
  );
  assert.strictEqual(out.months.length, 1);
  assert.strictEqual(out.months[0].periodStart, '2026-07-01');
  assert.strictEqual(out.months[0].paidAt, '2026-07-05');
}

// Multiple pre-lease halves that sum to rent → combine into first lease month
{
  const out = reallocatePreLeaseMonths(
    {
      months: [
        monthAlloc({
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodLabel: 'June 2026',
          amount: 450,
          paidAt: '2026-06-10',
          parts: [
            {
              transactionId: 'a',
              dateIso: '2026-06-10',
              amount: 450,
              notes: 'rent',
              sender: 'Stone',
            },
          ],
        }),
        monthAlloc({
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodLabel: 'June 2026',
          amount: 450,
          paidAt: '2026-06-25',
          parts: [
            {
              transactionId: 'b',
              dateIso: '2026-06-25',
              amount: 450,
              notes: 'rent',
              sender: 'Stone',
            },
          ],
        }),
      ],
      unallocated: [],
    },
    tenant
  );
  assert.strictEqual(out.months.length, 1);
  assert.strictEqual(out.months[0].periodStart, '2026-07-01');
  assert.strictEqual(out.months[0].parts.length, 2);
  assert.strictEqual(out.months[0].paidAt, '2026-06-25');
}

// filterByLeaseStart drops months before lease calendar month
{
  const filtered = filterByLeaseStart(
    {
      months: [
        monthAlloc({
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodLabel: 'June 2026',
          amount: 900,
          paidAt: '2026-06-01',
        }),
        monthAlloc({
          periodStart: '2026-07-01',
          periodEnd: '2026-07-31',
          periodLabel: 'July 2026',
          amount: 900,
          paidAt: '2026-07-01',
        }),
      ],
      unallocated: [{ amount: 50 }],
    },
    '2026-07-15'
  );
  assert.strictEqual(filtered.months.length, 1);
  assert.strictEqual(filtered.months[0].periodStart, '2026-07-01');
  assert.strictEqual(filtered.unallocated.length, 1);
}

console.log('test-cashapp-prelease-realloc: OK');
