#!/usr/bin/env node
/**
 * Regression: occupancy/electric split math + account matching for Gmail imports.
 * Pure helpers only — no DB.
 *
 * Run: npm run test:utility-split-domain
 */
const assert = require('assert');
const {
  computeOccupancySplits,
  computeElectricSplits,
  getBillSplitAmount,
  accountsMatch,
  matchProperty,
  inclusiveDays,
} = require('../src/use-cases/utilities/domain');

const periodStart = '2026-07-01';
const periodEnd = '2026-07-31';
assert.strictEqual(inclusiveDays(periodStart, periodEnd), 31);

// Full-month equal occupancy — cent remainder on last tenant
{
  const leases = [
    { id: 'l1', tenant_id: 't1', start_date: '2025-01-01', end_date: '2027-01-01' },
    { id: 'l2', tenant_id: 't2', start_date: '2025-01-01', end_date: '2027-01-01' },
    { id: 'l3', tenant_id: 't3', start_date: '2025-01-01', end_date: '2027-01-01' },
  ];
  const splits = computeOccupancySplits(leases, 100, periodStart, periodEnd);
  assert.strictEqual(splits.length, 3);
  const sum = splits.reduce((s, x) => s + Number(x.amount), 0);
  assert.ok(Math.abs(sum - 100) < 0.001, `sum=${sum}`);
  assert.strictEqual(splits[0].amount, '33.33');
  assert.strictEqual(splits[1].amount, '33.33');
  assert.strictEqual(splits[2].amount, '33.34'); // remainder
  assert.ok(splits.every((s) => s.prorated === false));
}

// Mid-month move-in: Lily pays only from start_date
{
  const leases = [
    { id: 'stone', tenant_id: 't1', start_date: '2025-01-01', end_date: '2027-01-01' },
    { id: 'lily', tenant_id: 't2', start_date: '2026-07-16', end_date: '2027-01-01' },
  ];
  const splits = computeOccupancySplits(leases, 165.74, periodStart, periodEnd);
  assert.strictEqual(splits.length, 2);
  const byId = Object.fromEntries(splits.map((s) => [s.leaseId, s]));
  assert.strictEqual(byId.stone.occupancyDays, 31);
  assert.strictEqual(byId.lily.occupancyDays, 16);
  assert.strictEqual(byId.lily.prorated, true);
  assert.strictEqual(byId.lily.effectiveStart, '2026-07-16');
  const sum = splits.reduce((s, x) => s + Number(x.amount), 0);
  assert.ok(Math.abs(sum - 165.74) < 0.001, `prorated sum=${sum}`);
  // stone should pay more than lily
  assert.ok(Number(byId.stone.amount) > Number(byId.lily.amount));
}

// Move-out before period end shortens weight
{
  const leases = [
    { id: 'out', tenant_id: 't1', start_date: '2025-01-01', end_date: '2026-07-10' },
    { id: 'stay', tenant_id: 't2', start_date: '2025-01-01', end_date: '2027-01-01' },
  ];
  const splits = computeOccupancySplits(leases, 310, periodStart, periodEnd);
  const byId = Object.fromEntries(splits.map((s) => [s.leaseId, s]));
  assert.strictEqual(byId.out.occupancyDays, 10);
  assert.strictEqual(byId.stay.occupancyDays, 31);
  assert.strictEqual(byId.out.prorated, true);
}

// Electric submeter percents when shares sum to 100%
{
  const leases = [
    { id: 'a', tenant_id: 't1', unit_id: 'u1', start_date: '2025-01-01', end_date: '2027-01-01' },
    { id: 'b', tenant_id: 't2', unit_id: 'u2', start_date: '2025-01-01', end_date: '2027-01-01' },
    { id: 'c', tenant_id: 't3', unit_id: 'u3', start_date: '2025-01-01', end_date: '2027-01-01' },
  ];
  const shares = { u1: 40, u2: 30, u3: 30 };
  const splits = computeElectricSplits(leases, shares, 100, periodStart, periodEnd);
  assert.strictEqual(splits.length, 3);
  assert.ok(splits.every((s) => s.splitBy === 'electric_share_percent'));
  const byId = Object.fromEntries(splits.map((s) => [s.leaseId, s]));
  assert.strictEqual(byId.a.amount, '40.00');
  assert.strictEqual(byId.b.amount, '30.00');
  assert.strictEqual(byId.c.amount, '30.00');
  const sum = splits.reduce((s, x) => s + Number(x.amount), 0);
  assert.ok(Math.abs(sum - 100) < 0.001);
}

// Shares ≠ 100% → fall back to occupancy
{
  const leases = [
    { id: 'a', tenant_id: 't1', unit_id: 'u1', start_date: '2025-01-01', end_date: '2027-01-01' },
    { id: 'b', tenant_id: 't2', unit_id: 'u2', start_date: '2025-01-01', end_date: '2027-01-01' },
  ];
  const badShares = { u1: 40, u2: 40 }; // 80%
  const splits = computeElectricSplits(leases, badShares, 100, periodStart, periodEnd);
  assert.ok(splits.every((s) => !s.splitBy));
  assert.strictEqual(splits[0].amount, '50.00');
  assert.strictEqual(splits[1].amount, '50.00');
}

// Current Charges beat statement balance / total_amount for split pool
assert.strictEqual(
  getBillSplitAmount({ tenant_charge_amount: 293.69, total_amount: 744.21 }),
  293.69
);
assert.strictEqual(getBillSplitAmount({ total_amount: 165.74 }), 165.74);
assert.strictEqual(getBillSplitAmount({ tenant_charge_amount: '', total_amount: 50 }), 50);

// Account matching: full, suffix, Dominion "ending in"
assert.ok(accountsMatch('1234563430', '1234563430'));
assert.ok(accountsMatch('1234563430', '3430'));
assert.ok(accountsMatch('PP-1055175', '1055175'));
assert.ok(accountsMatch('3491396160', '6160'));
assert.ok(!accountsMatch('', '3430'));
assert.ok(!accountsMatch('1234', '5678'));

const props = [
  {
    id: 'p1',
    dominion_account_number: '1234563430',
    norfolk_utilities_account_number: '3491396160',
  },
  {
    id: 'p2',
    dominion_account_number: '9999999999',
    norfolk_utilities_account_number: '1111111111',
  },
];
assert.strictEqual(matchProperty(props, { account_number: '3430' }).id, 'p1');
assert.strictEqual(matchProperty(props, { account_number: '3491396160' }).id, 'p1');
assert.strictEqual(matchProperty(props, { account_number: '0000' }), null);
assert.strictEqual(
  matchProperty([props[0]], { account_number: null }).id,
  'p1',
  'single property falls back when no account'
);

console.log('test-utility-split-domain: OK');
