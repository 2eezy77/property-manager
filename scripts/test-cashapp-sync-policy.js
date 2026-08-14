/**
 * Unit tests for Cash App sync terminal-failure / utility unlock policy (PR #42).
 * Run: node scripts/test-cashapp-sync-policy.js
 */
const assert = require('assert');
const {
  isTerminalCashAppPiFailure,
  shouldMarkCashAppSyncFailed,
  isFailableLocalCashAppStatus,
  cashAppSyncFailureReason,
  shouldUnlockUtilitySplitsOnCashAppSyncFail,
  shouldMarkUtilityPaidOnCashAppSyncSuccess,
} = require('../src/services/cashapp-sync-policy');

assert.strictEqual(isTerminalCashAppPiFailure('canceled'), true);
assert.strictEqual(isTerminalCashAppPiFailure('requires_payment_method'), true);
assert.strictEqual(isTerminalCashAppPiFailure('processing'), false);
assert.strictEqual(isTerminalCashAppPiFailure('requires_action'), false);
assert.strictEqual(isTerminalCashAppPiFailure('succeeded'), false);

// Stale last_payment_error while still processing must NOT enter fail branch.
assert.strictEqual(shouldMarkCashAppSyncFailed('processing', 'pending'), false);
assert.strictEqual(shouldMarkCashAppSyncFailed('processing', 'processing'), false);
assert.strictEqual(shouldMarkCashAppSyncFailed('requires_action', 'pending'), false);

assert.strictEqual(shouldMarkCashAppSyncFailed('canceled', 'pending'), true);
assert.strictEqual(shouldMarkCashAppSyncFailed('requires_payment_method', 'processing'), true);
// Already-succeeded local payment: never re-fail / unlock.
assert.strictEqual(shouldMarkCashAppSyncFailed('canceled', 'succeeded'), false);
assert.strictEqual(shouldMarkCashAppSyncFailed('requires_payment_method', 'succeeded'), false);

assert.strictEqual(isFailableLocalCashAppStatus('pending'), true);
assert.strictEqual(isFailableLocalCashAppStatus('processing'), true);
assert.strictEqual(isFailableLocalCashAppStatus('succeeded'), false);
assert.strictEqual(isFailableLocalCashAppStatus('failed'), false);

assert.strictEqual(
  cashAppSyncFailureReason({ last_payment_error: { message: 'Insufficient funds' } }),
  'Insufficient funds'
);
assert.strictEqual(
  cashAppSyncFailureReason({}),
  'Cash App payment was not completed.'
);

assert.strictEqual(
  shouldUnlockUtilitySplitsOnCashAppSyncFail({ id: 'p1', payment_type: 'utility' }),
  true
);
assert.strictEqual(
  shouldUnlockUtilitySplitsOnCashAppSyncFail({ id: 'p1', payment_type: 'rent' }),
  false
);
assert.strictEqual(shouldUnlockUtilitySplitsOnCashAppSyncFail(undefined), false);
assert.strictEqual(shouldUnlockUtilitySplitsOnCashAppSyncFail(null), false);

assert.strictEqual(
  shouldMarkUtilityPaidOnCashAppSyncSuccess({ rowCount: 1, paymentType: 'utility' }),
  true
);
assert.strictEqual(
  shouldMarkUtilityPaidOnCashAppSyncSuccess({ rowCount: 0, paymentType: 'utility' }),
  false
);
assert.strictEqual(
  shouldMarkUtilityPaidOnCashAppSyncSuccess({ rowCount: 1, paymentType: 'rent' }),
  false
);

console.log('test-cashapp-sync-policy OK');
