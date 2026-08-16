#!/usr/bin/env node
/**
 * Cash App import allocation: chronological hist vs May-2026 calendar split,
 * pre-lease reallocation, deposit credits, and unknown-sender warnings.
 * Mis-bucketing months double-credits rent or drops paid months.
 * Run: npm run test:cashapp-import-plan
 */
'use strict';

const assert = require('assert');
const {
  allocateRentMonths,
  allocateCalendarMonths,
  buildImportPlanFromRows,
} = require('../src/services/cashapp-import.service');

function pay({ id, dateIso, amount, notes = 'rent', sender = 'Stone', senderKey = 'stone' }) {
  return {
    transactionId: id,
    date: new Date(`${dateIso}T12:00:00`),
    dateIso,
    amount,
    notes,
    sender,
    senderKey,
  };
}

// Hist: two $450 halves chronologically fill one $900 month; leftover is partial
{
  const { months, unallocated } = allocateRentMonths(
    [
      pay({ id: 'a', dateIso: '2026-03-05', amount: 450 }),
      pay({ id: 'b', dateIso: '2026-03-20', amount: 450 }),
      pay({ id: 'c', dateIso: '2026-04-02', amount: 200 }),
    ],
    900
  );
  assert.strictEqual(months.length, 1);
  assert.strictEqual(months[0].amount, 900);
  assert.strictEqual(months[0].parts.length, 2);
  assert.strictEqual(unallocated.length, 1);
  assert.strictEqual(unallocated[0].amount, 200);
  assert.strictEqual(unallocated[0].shortfall, 700);
}

// Calendar: same-month halves stay in that month; overage flagged
{
  const { months, unallocated, overages } = allocateCalendarMonths(
    [
      pay({ id: 'd', dateIso: '2026-06-08', amount: 450 }),
      pay({ id: 'e', dateIso: '2026-06-22', amount: 450 }),
      pay({ id: 'f', dateIso: '2026-07-05', amount: 1000 }),
    ],
    900
  );
  assert.strictEqual(months.length, 2);
  assert.ok(months.some((m) => m.periodStart.startsWith('2026-06')));
  assert.ok(months.some((m) => m.periodStart.startsWith('2026-07')));
  assert.strictEqual(unallocated.length, 0);
  assert.strictEqual(overages.length, 1);
  assert.strictEqual(overages[0].ym, '2026-07');
  assert.strictEqual(overages[0].excess, 100);
}

// Plan orchestration: May cutoff, deposit credits, unknown sender, pre-lease shift
{
  const tenants = [
    {
      cashAppKey: 'stone',
      name: 'Buckley Stone',
      tenant_id: 't-stone',
      lease_id: 'l-stone',
      monthly_rent: '900',
      start_date: '2026-07-01',
    },
  ];

  const rows = [
    // Pre-lease June pay (calendar path) → reallocated into July lease month
    pay({ id: 'g', dateIso: '2026-06-20', amount: 900, notes: 'july rent' }),
    // Deposit must not become rent
    pay({
      id: 'h',
      dateIso: '2026-07-02',
      amount: 450,
      notes: 'security deposit',
    }),
    // Unmapped sender
    pay({
      id: 'i',
      dateIso: '2026-07-10',
      amount: 900,
      sender: 'John Kloc',
      senderKey: 'john kloc',
    }),
  ];

  const plan = buildImportPlanFromRows(rows, tenants, ['stone', 'john kloc']);

  assert.ok(
    plan.warnings.some((w) => w.includes('No tenant mapped') && w.includes('john kloc'))
  );
  assert.strictEqual(plan.tenants.length, 1);

  const stone = plan.tenants[0];
  assert.strictEqual(stone.months.length, 1);
  assert.strictEqual(stone.months[0].periodStart, '2026-07-01');
  assert.strictEqual(stone.months[0].amount, 900);
  assert.strictEqual(stone.depositCredits.length, 1);
  assert.strictEqual(stone.depositCredits[0].amount, 450);
  assert.ok(plan.warnings.some((w) => w.includes('security deposit')));
}

console.log('test-cashapp-import-plan: OK');
