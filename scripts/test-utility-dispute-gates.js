#!/usr/bin/env node
/**
 * Utility UC04/UC05 dispute validation gates (no DB).
 * Run: node scripts/test-utility-dispute-gates.js
 */
'use strict';

const {
  assertDisputeAllowed,
  assertWaiveAllowed,
  assertRejectDisputeAllowed,
} = require('../src/use-cases/utilities/dispute-gates');

let failed = 0;
function assert(cond, msg) {
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

const openSplit = {
  tenant_id: 't1',
  status: 'notified',
  dispute_deadline_at: '2099-01-01T00:00:00.000Z',
};

assert(
  assertDisputeAllowed({
    tenantId: 't1',
    split: openSplit,
    reason: '  Wrong meter  ',
    now: new Date('2026-08-01T00:00:00.000Z'),
  }) === 'Wrong meter',
  'trims dispute reason on success'
);

assert(
  throwsCode(() => assertDisputeAllowed({ tenantId: 't1', split: openSplit, reason: '   ' })) === 'MISSING_REASON',
  'blank reason → MISSING_REASON'
);
assert(
  throwsCode(() => assertDisputeAllowed({ tenantId: 't1', split: null, reason: 'x' })) === 'NOT_FOUND',
  'missing split → NOT_FOUND'
);
assert(
  throwsCode(() => assertDisputeAllowed({ tenantId: 'other', split: openSplit, reason: 'x' })) === 'FORBIDDEN',
  'other tenant → FORBIDDEN'
);
assert(
  throwsCode(() => assertDisputeAllowed({
    tenantId: 't1',
    split: { ...openSplit, status: 'paid' },
    reason: 'x',
  })) === 'INVALID_STATE',
  'non-notified status → INVALID_STATE'
);
assert(
  throwsCode(() => assertDisputeAllowed({
    tenantId: 't1',
    split: { ...openSplit, dispute_deadline_at: '2020-01-01T00:00:00.000Z' },
    reason: 'x',
    now: new Date('2026-08-01T00:00:00.000Z'),
  })) === 'DEADLINE_PASSED',
  'past deadline → DEADLINE_PASSED'
);
assert(
  throwsCode(() => assertDisputeAllowed({
    tenantId: 't1',
    split: { ...openSplit, dispute_deadline_at: null },
    reason: 'x',
  })) === 'DEADLINE_PASSED',
  'null deadline → DEADLINE_PASSED'
);

assert(assertWaiveAllowed({ status: 'disputed' }) === true, 'can waive disputed split');
assert(assertWaiveAllowed({ status: 'notified' }) === true, 'can waive notified split');
assert(throwsCode(() => assertWaiveAllowed({ status: 'paid' })) === 'INVALID_STATE', 'cannot waive paid');
assert(throwsCode(() => assertWaiveAllowed({ status: 'waived' })) === 'INVALID_STATE', 'cannot waive already waived');
assert(throwsCode(() => assertWaiveAllowed(null)) === 'NOT_FOUND', 'waive missing split → NOT_FOUND');

assert(assertRejectDisputeAllowed({ status: 'disputed' }) === true, 'can reject disputed');
assert(
  throwsCode(() => assertRejectDisputeAllowed({ status: 'notified' })) === 'INVALID_STATE',
  'cannot reject non-disputed'
);
assert(throwsCode(() => assertRejectDisputeAllowed(null)) === 'NOT_FOUND', 'reject missing split → NOT_FOUND');

if (failed) {
  console.error(`\ntest-utility-dispute-gates: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-utility-dispute-gates: OK');
