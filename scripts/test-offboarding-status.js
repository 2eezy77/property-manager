#!/usr/bin/env node
/**
 * Regression: tenant/staff move-out checklist status builders.
 * Wrong active/completed counts drift portal UX and signing-fee left-early gates.
 *
 * Run: npm run test:offboarding-status
 */
'use strict';

const assert = require('assert');
const {
  TENANT_OFFBOARD_STEPS,
  STAFF_OFFBOARD_STEPS,
  isOffboardingActive,
  buildOffboardingStatus,
  buildTenantOffboardingStatus,
  resolveStepMeta,
} = require('../src/services/tenant-offboarding.service');

assert.strictEqual(isOffboardingActive(null), false);
assert.strictEqual(isOffboardingActive({ status: 'active' }), false);
assert.strictEqual(isOffboardingActive({ status: 'expired' }), true);
assert.strictEqual(isOffboardingActive({ status: 'terminated' }), true);
assert.strictEqual(
  isOffboardingActive({ status: 'active', offboarding_started_at: '2026-08-01' }),
  true
);
assert.strictEqual(
  isOffboardingActive({ lease_status: 'expired', status: 'active' }),
  true,
  'lease_status wins when present'
);

const inactive = buildOffboardingStatus({ id: 'lease-1', status: 'active' });
assert.deepStrictEqual(inactive, { active: false, leaseId: 'lease-1' });

const started = buildOffboardingStatus({
  id: 'lease-2',
  status: 'active',
  offboarding_started_at: '2026-08-01T00:00:00Z',
  offboard_keys_returned_at: '2026-08-02T00:00:00Z',
  offboard_vivint_revoked_at: '2026-08-03T00:00:00Z',
});
assert.strictEqual(started.active, true);
assert.strictEqual(started.leaseId, 'lease-2');
assert.strictEqual(started.keysReturned, true);
assert.strictEqual(started.forwardingConfirmed, false);
assert.strictEqual(started.vivintRevoked, true);
assert.strictEqual(started.completedCount, 2);
assert.strictEqual(
  started.totalSteps,
  TENANT_OFFBOARD_STEPS.length + STAFF_OFFBOARD_STEPS.length
);
assert.strictEqual(started.tenantStepsComplete, false);
assert.strictEqual(started.allComplete, false);

const tenantView = buildTenantOffboardingStatus({
  id: 'lease-2',
  status: 'active',
  offboarding_started_at: '2026-08-01T00:00:00Z',
  offboard_keys_returned_at: '2026-08-02T00:00:00Z',
  offboard_vivint_revoked_at: '2026-08-03T00:00:00Z',
});
assert.strictEqual(tenantView.completedCount, 1, 'tenant view counts only tenant steps');
assert.strictEqual(tenantView.totalSteps, TENANT_OFFBOARD_STEPS.length);
assert.strictEqual(tenantView.allComplete, false);
assert.strictEqual(tenantView.vivintRevoked, true, 'staff fields still present on payload');

const allTenantDone = {};
for (const step of TENANT_OFFBOARD_STEPS) {
  allTenantDone[step.column] = '2026-08-10T00:00:00Z';
}
const tenantComplete = buildTenantOffboardingStatus({
  id: 'lease-3',
  status: 'terminated',
  offboarding_started_at: '2026-08-01T00:00:00Z',
  ...allTenantDone,
});
assert.strictEqual(tenantComplete.allComplete, true);
assert.strictEqual(tenantComplete.completedCount, TENANT_OFFBOARD_STEPS.length);

const keysMeta = resolveStepMeta('keysReturned');
assert.strictEqual(keysMeta.staff, false);
assert.strictEqual(keysMeta.column, 'offboard_keys_returned_at');

const vivintMeta = resolveStepMeta('vivintRevoked');
assert.strictEqual(vivintMeta.staff, true);
assert.strictEqual(vivintMeta.byColumn, 'offboard_vivint_revoked_by');

assert.strictEqual(resolveStepMeta('notARealStep'), null);

console.log('test-offboarding-status: OK');
