#!/usr/bin/env node
/**
 * Regression: manager lease-signing fee cancels when tenant left early;
 * promotes to owed only after 3 succeeded rent months.
 * Pure helpers — no DB.
 *
 * Run: npm run test:lease-signing-eligibility
 */
'use strict';

const assert = require('assert');
const {
  RENT_MONTHS_REQUIRED,
  tenantLeftEarly,
  shouldPromoteSigningFeeToOwed,
} = require('../src/utils/lease-signing-eligibility');

assert.strictEqual(RENT_MONTHS_REQUIRED, 3);

assert.strictEqual(tenantLeftEarly({ lease_status: 'active' }), false);
assert.strictEqual(tenantLeftEarly({ lease_status: 'terminated' }), true);
assert.strictEqual(tenantLeftEarly({ lease_status: 'expired' }), true);
assert.strictEqual(
  tenantLeftEarly({ lease_status: 'active', offboard_moveout_confirmed_at: '2026-08-01' }),
  true
);
assert.strictEqual(
  tenantLeftEarly({ lease_status: 'active', offboard_portal_disabled_at: '2026-08-01' }),
  true
);
assert.strictEqual(
  tenantLeftEarly({
    lease_status: 'active',
    offboarding_started_at: '2026-07-01',
    offboard_keys_returned_at: '2026-07-15',
  }),
  true
);
// Offboarding started alone is not enough — keys must be returned too
assert.strictEqual(
  tenantLeftEarly({
    lease_status: 'active',
    offboarding_started_at: '2026-07-01',
  }),
  false
);

assert.strictEqual(shouldPromoteSigningFeeToOwed(0), false);
assert.strictEqual(shouldPromoteSigningFeeToOwed(2), false);
assert.strictEqual(shouldPromoteSigningFeeToOwed(3), true);
assert.strictEqual(shouldPromoteSigningFeeToOwed(4), true);

console.log('test-lease-signing-eligibility: OK');
