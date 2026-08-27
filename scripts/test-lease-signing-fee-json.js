#!/usr/bin/env node
/**
 * Unit checks for lease-signing fee API shape / rent-month eligibility fields.
 * Run: node scripts/test-lease-signing-fee-json.js
 */
const {
  RENT_MONTHS_REQUIRED,
  feeToJson,
} = require('../src/utils/lease-signing-fee-json');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(RENT_MONTHS_REQUIRED === 3, 'requires 3 succeeded rent months');
assert(feeToJson(null) === null, 'null row → null');
assert(feeToJson(undefined) === null, 'undefined row → null');

const base = {
  id: 'fee-1',
  org_id: 'org-1',
  manager_id: 'mgr-1',
  lease_id: 'lease-1',
  amount_cents: 35000,
  signed_at: '2026-01-15T00:00:00.000Z',
  status: 'eligible',
  payment_method: null,
  paid_by: null,
  paid_at: null,
  note: null,
  eligible_at: '2026-04-01T00:00:00.000Z',
  cancelled_at: null,
  cancel_reason: null,
  tenant_name: '  Isaiah Reese  ',
  tenant_email: 'isaiah@example.com',
  unit_number: '2',
  property_name: '743',
  start_date: '2026-01-01',
  lease_status: 'active',
};

const zero = feeToJson({ ...base, rent_months_paid: 0 });
assert(zero.amountDollars === 350, '$350 → amountDollars');
assert(zero.rentMonthsPaid === 0, '0 months paid');
assert(zero.rentMonthsRequired === 3, 'required months exposed');
assert(zero.rentMonthsRemaining === 3, '0 paid → 3 remaining');
assert(zero.tenantName === 'Isaiah Reese', 'tenant name trimmed');
assert(zero.orgId === 'org-1' && zero.leaseId === 'lease-1', 'ids camelCased');

const two = feeToJson({ ...base, rent_months_paid: 2 });
assert(two.rentMonthsRemaining === 1, '2 paid → 1 remaining (not yet payable)');

const three = feeToJson({ ...base, rent_months_paid: 3, status: 'eligible' });
assert(three.rentMonthsRemaining === 0, '3 paid → 0 remaining (payable)');

const over = feeToJson({ ...base, rent_months_paid: 5 });
assert(over.rentMonthsRemaining === 0, 'over-paid months clamp remaining at 0');

const missing = feeToJson({ ...base });
assert(missing.rentMonthsPaid === 0, 'missing rent_months_paid defaults to 0');
assert(missing.rentMonthsRemaining === 3, 'missing months → treat as unpaid');

const blankName = feeToJson({ ...base, tenant_name: '   ', rent_months_paid: 3 });
assert(blankName.tenantName === null, 'whitespace-only tenant name → null');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll lease-signing-fee-json checks passed.');
