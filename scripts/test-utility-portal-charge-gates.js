#!/usr/bin/env node
/**
 * Portal utility pay eligibility gates (LEASE_NOT_FOUND / NOTHING_DUE / LEASE_MISMATCH).
 *
 * Run: npm run test:utility-portal-charge-gates
 */
'use strict';

const {
  PAYABLE_SPLIT_STATUSES,
  assertLeaseReadyForPortalCharge,
  assertSplitsReadyForPortalCharge,
  assertPortalChargeClaimComplete,
} = require('../src/services/utility-portal-charge-gates');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function expectCode(fn, code, msg) {
  try {
    fn();
    check(false, `${msg} — expected throw ${code}`);
  } catch (err) {
    check(err.code === code, `${msg} — got ${err.code}: ${err.message}`);
  }
}

check(
  PAYABLE_SPLIT_STATUSES.slice().sort().join(',') === 'disputed,failed,notified,pending',
  'payable statuses stay pending/notified/disputed/failed'
);

expectCode(
  () => assertLeaseReadyForPortalCharge(null),
  'LEASE_NOT_FOUND',
  'missing lease'
);
expectCode(
  () => assertLeaseReadyForPortalCharge({ status: 'ended' }),
  'LEASE_NOT_FOUND',
  'inactive lease'
);
check(
  assertLeaseReadyForPortalCharge({ status: 'active' }) === true,
  'active lease passes'
);

const openElectric = {
  split_id: 's1',
  bill_id: 'b1',
  lease_id: 'lease-a',
  amount: 12.345,
  split_status: 'notified',
  service_type: 'electric',
  due_date: '2026-08-20',
  payment_id: null,
};
const openWater = {
  split_id: 's2',
  bill_id: 'b2',
  lease_id: 'lease-a',
  amount: 7.655,
  split_status: 'failed',
  service_type: 'water',
  due_date: '2026-08-15',
  payment_id: null,
};

expectCode(
  () => assertSplitsReadyForPortalCharge([], { leaseId: 'lease-a' }),
  'NOTHING_DUE',
  'empty splits'
);

expectCode(
  () => assertSplitsReadyForPortalCharge(
    [{ ...openElectric, lease_id: 'other' }],
    { leaseId: 'lease-a' }
  ),
  'LEASE_MISMATCH',
  'split lease mismatch'
);

expectCode(
  () => assertSplitsReadyForPortalCharge(
    [{ ...openElectric, payment_id: 'pay-x' }],
    { leaseId: 'lease-a' }
  ),
  'NOTHING_DUE',
  'already claimed split'
);

expectCode(
  () => assertSplitsReadyForPortalCharge(
    [{ ...openElectric, split_status: 'charging' }],
    { leaseId: 'lease-a' }
  ),
  'NOTHING_DUE',
  'charging status not payable'
);

expectCode(
  () => assertSplitsReadyForPortalCharge(
    [{ ...openElectric, amount: 0.004 }],
    { leaseId: 'lease-a' }
  ),
  'NOTHING_DUE',
  'dust amount'
);

{
  const ready = assertSplitsReadyForPortalCharge([openElectric, openWater], {
    leaseId: 'lease-a',
  });
  check(ready.amountDollars === 20, `combined amount $20, got ${ready.amountDollars}`);
  check(ready.amountCents === 2000, `combined cents 2000, got ${ready.amountCents}`);
  check(
    ready.description === 'Utility shares (electric, water)',
    `multi-service description, got ${ready.description}`
  );
  check(ready.splitIds.join(',') === 's1,s2', 'split ids preserved');
  check(ready.billIds.sort().join(',') === 'b1,b2', 'unique bill ids');
  check(ready.dueDate === '2026-08-15', 'earliest due date wins');
}

{
  const single = assertSplitsReadyForPortalCharge([openElectric], { leaseId: 'lease-a' });
  check(
    single.description === 'Utility share (electric)',
    `single-service description, got ${single.description}`
  );
}

expectCode(
  () => assertPortalChargeClaimComplete(1, ['s1', 's2']),
  'NOTHING_DUE',
  'partial claim race'
);
check(
  assertPortalChargeClaimComplete(2, ['s1', 's2']) === true,
  'full claim passes'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll utility-portal-charge-gates checks passed.');
