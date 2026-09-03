#!/usr/bin/env node
/**
 * UC01 create-bill + draft-delete validation gates (no DB).
 *
 * Run: npm run test:utility-create-bill-gates
 */
'use strict';

const {
  assertCreateBillParams,
  assertDraftBillDeletable,
} = require('../src/use-cases/utilities/create-bill-gates');

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

const valid = {
  property_id: 'prop-1',
  service_type: 'electric',
  period_start: '2026-07-01',
  period_end: '2026-07-31',
  total_amount: 294.12,
  due_date: '2026-08-15',
  provider_name: 'Dominion',
};

{
  const out = assertCreateBillParams(valid);
  check(out.property_id === 'prop-1', 'valid body returns property_id');
  check(out.provider_name === 'Dominion', 'valid body keeps optional provider');
}

check(
  throwsCode(() => assertCreateBillParams({ ...valid, property_id: null })) === 'MISSING_PARAMS',
  'missing property_id → MISSING_PARAMS'
);
check(
  throwsCode(() => assertCreateBillParams({ ...valid, due_date: '' })) === 'MISSING_PARAMS',
  'blank due_date → MISSING_PARAMS'
);
check(
  throwsCode(() => assertCreateBillParams({ ...valid, total_amount: 0 })) === 'MISSING_PARAMS',
  'zero total_amount is falsy → MISSING_PARAMS (same gate as omitted amount)'
);
check(
  throwsCode(() => assertCreateBillParams({ ...valid, total_amount: '0' })) === 'INVALID_AMOUNT',
  'string "0" passes presence check then → INVALID_AMOUNT'
);
check(
  throwsCode(() => assertCreateBillParams({ ...valid, total_amount: -5 })) === 'INVALID_AMOUNT',
  'negative total_amount → INVALID_AMOUNT'
);
check(
  throwsCode(() => assertCreateBillParams({})) === 'MISSING_PARAMS',
  'empty body → MISSING_PARAMS'
);

const draft = { id: 'b1', property_id: 'prop-1', status: 'draft' };
check(
  assertDraftBillDeletable({ bill: draft, accessiblePropertyIds: ['prop-1'] }) === true,
  'draft on accessible property can delete'
);
check(
  throwsCode(() => assertDraftBillDeletable({ bill: null, accessiblePropertyIds: ['prop-1'] }))
    === 'NOT_FOUND',
  'missing bill → NOT_FOUND'
);
check(
  throwsCode(() => assertDraftBillDeletable({
    bill: draft,
    accessiblePropertyIds: ['other'],
  })) === 'NOT_FOUND',
  'inaccessible property → NOT_FOUND'
);
check(
  throwsCode(() => assertDraftBillDeletable({
    bill: { ...draft, status: 'notified' },
    accessiblePropertyIds: ['prop-1'],
  })) === 'INVALID_STATE',
  'notified bill → INVALID_STATE'
);
check(
  throwsCode(() => assertDraftBillDeletable({
    bill: { ...draft, status: 'settled' },
    accessiblePropertyIds: ['prop-1'],
  })) === 'INVALID_STATE',
  'settled bill → INVALID_STATE'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll utility-create-bill-gates checks passed.');
