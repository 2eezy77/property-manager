/**
 * Unit tests for utility house-cover monthly pool math.
 * Run: npm run test:utility-house-cover
 */
const assert = require('assert');
const {
  billingMonthKey,
  leasesOverlapMonth,
  countActiveLeasesForMonth,
  allocateMonthlyHouseCover,
} = require('../src/use-cases/utilities/house-cover');

function getAmount(b) {
  if (b.tenant_charge_amount != null && b.tenant_charge_amount !== '') {
    return Number(b.tenant_charge_amount);
  }
  return Number(b.total_amount);
}

assert.strictEqual(billingMonthKey('2026-07-01'), '2026-07');
assert.strictEqual(billingMonthKey('2026-07-15T12:00:00Z'), '2026-07');
assert.strictEqual(billingMonthKey(null), null);

assert.strictEqual(
  leasesOverlapMonth({ start_date: '2025-10-01', end_date: '2026-12-31' }, '2026-07'),
  true
);
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2026-08-01', end_date: '2027-01-01' }, '2026-07'),
  false
);
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2026-01-01', end_date: '2026-06-30' }, '2026-07'),
  false
);

const fourTenants = [
  { id: 'l1', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'l2', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'l3', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'l4', start_date: '2025-01-01', end_date: '2027-01-01' },
];
assert.strictEqual(countActiveLeasesForMonth(fourTenants, '2026-07'), 4);

// Vacant room / lease outside month does not count
assert.strictEqual(
  countActiveLeasesForMonth(
    [...fourTenants, { id: 'vacant', start_date: '2026-08-01', end_date: '2027-01-01' }],
    '2026-07'
  ),
  4
);

// Worked example: July electric $731.70, 4 tenants, $100 each → pool $331.70
{
  const bills = [{ id: 'elec', total_amount: 731.7, tenant_charge_amount: 731.7 }];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 100,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.strictEqual(r.combined, 731.7);
  assert.strictEqual(r.coverTotal, 400);
  assert.ok(Math.abs(r.tenantPool - 331.7) < 0.001);
  assert.ok(Math.abs(r.byBillId.elec.tenantPoolAmount - 331.7) < 0.001);
  assert.ok(Math.abs(r.byBillId.elec.houseCoverApplied - 400) < 0.001);
}

// Cover >= combined → $0
{
  const bills = [{ id: 'water', total_amount: 165.74 }];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 100,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.strictEqual(r.tenantPool, 0);
  assert.strictEqual(r.byBillId.water.tenantPoolAmount, 0);
  assert.strictEqual(r.byBillId.water.houseCoverApplied, 165.74);
}

// Two bills pro-rate; cent remainder lands on last bill
{
  const bills = [
    { id: 'a', total_amount: 200 },
    { id: 'b', total_amount: 100 },
  ];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 100,
    activeLeaseCount: 1,
    getAmount,
  });
  assert.strictEqual(r.combined, 300);
  assert.strictEqual(r.coverTotal, 100);
  assert.strictEqual(r.tenantPool, 200);
  const a = r.byBillId.a.tenantPoolAmount;
  const b = r.byBillId.b.tenantPoolAmount;
  assert.ok(Math.abs(a + b - 200) < 0.001);
  assert.ok(Math.abs(a - 133.33) < 0.02);
  assert.ok(Math.abs(b - 66.67) < 0.02);
}

// coverPerTenant 0 → full amounts
{
  const bills = [{ id: 'x', total_amount: 50 }];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 0,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.strictEqual(r.coverTotal, 0);
  assert.strictEqual(r.tenantPool, 50);
  assert.strictEqual(r.byBillId.x.tenantPoolAmount, 50);
}

// Caller filters mutable-only bills (freeze path)
{
  const mutable = [{ id: 'open', total_amount: 731.7 }];
  const r = allocateMonthlyHouseCover({
    bills: mutable,
    coverPerTenant: 100,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.ok(Math.abs(r.tenantPool - 331.7) < 0.001);
}

console.log('test-utility-house-cover: OK');
