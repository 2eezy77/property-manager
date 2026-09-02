#!/usr/bin/env node
/**
 * UC06 charge-bill validation gates (no DB / Stripe).
 *
 * Run: npm run test:utility-charge-bill-gates
 */
'use strict';

const {
  assertBillAccessibleForCharge,
  assertChargeBillReady,
  classifyEligibleSplitSkip,
} = require('../src/use-cases/utilities/charge-bill-gates');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function throwsCode(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || err.message;
  }
}

const notified = {
  id: 'b1',
  property_id: 'prop-1',
  status: 'notified',
  service_type: 'water',
  dispute_deadline_at: '2020-01-01T00:00:00.000Z',
};

check(
  assertBillAccessibleForCharge({
    bill: notified,
    accessiblePropertyIds: ['prop-1'],
  }) === true,
  'accessible notified bill passes'
);
check(
  throwsCode(() => assertBillAccessibleForCharge({
    bill: null,
    accessiblePropertyIds: ['prop-1'],
  })) === 'NOT_FOUND',
  'missing bill → NOT_FOUND'
);
check(
  throwsCode(() => assertBillAccessibleForCharge({
    bill: notified,
    accessiblePropertyIds: ['other'],
  })) === 'NOT_FOUND',
  'inaccessible property → NOT_FOUND'
);

check(
  assertChargeBillReady({ bill: notified }) === true,
  'notified water bill is ready'
);
check(
  assertChargeBillReady({ bill: { ...notified, status: 'charging' } }) === true,
  'charging status is ready (resume)'
);
check(
  throwsCode(() => assertChargeBillReady({ bill: { ...notified, status: 'draft' } }))
    === 'INVALID_STATE',
  'draft → INVALID_STATE'
);
check(
  throwsCode(() => assertChargeBillReady({ bill: { ...notified, status: 'settled' } }))
    === 'INVALID_STATE',
  'settled → INVALID_STATE'
);

{
  const futureDeadline = {
    ...notified,
    dispute_deadline_at: '2099-06-01T00:00:00.000Z',
  };
  check(
    throwsCode(() => assertChargeBillReady({
      bill: futureDeadline,
      now: new Date('2026-09-01T12:00:00.000Z'),
    })) === 'DEADLINE_NOT_REACHED',
    'open dispute window → DEADLINE_NOT_REACHED'
  );
  check(
    assertChargeBillReady({
      bill: futureDeadline,
      force: true,
      now: new Date('2026-09-01T12:00:00.000Z'),
    }) === true,
    'force=true bypasses dispute deadline'
  );
}

{
  const electricOpen = {
    ...notified,
    service_type: 'electric',
    chargeable_after: '2026-09-15',
    period_end: '2026-09-15',
  };
  check(
    throwsCode(() => assertChargeBillReady({
      bill: electricOpen,
      isElectricChargeable: () => false,
    })) === 'BILLING_PERIOD_OPEN',
    'open electric period → BILLING_PERIOD_OPEN'
  );
  check(
    assertChargeBillReady({
      bill: electricOpen,
      force: true,
      isElectricChargeable: () => false,
    }) === true,
    'force=true bypasses electric period gate'
  );
  check(
    assertChargeBillReady({
      bill: electricOpen,
      isElectricChargeable: () => true,
    }) === true,
    'chargeable electric passes'
  );
}

check(
  classifyEligibleSplitSkip({ bank_account_id: null }) === 'NO_VERIFIED_BANK',
  'no bank → NO_VERIFIED_BANK'
);
check(
  classifyEligibleSplitSkip({ bank_account_id: 'ba-1', link_status: 'needs_relink' })
    === 'ACCOUNT_NEEDS_RELINK',
  'needs_relink → ACCOUNT_NEEDS_RELINK'
);
check(
  classifyEligibleSplitSkip({ bank_account_id: 'ba-1', link_status: 'linked' }) === null,
  'verified linked bank is chargeable'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll utility-charge-bill-gates checks passed.');
