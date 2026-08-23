#!/usr/bin/env node
/**
 * Tenant move-in checklist + manager Vivint onboarding status.
 * Run: node scripts/test-tenant-checkin-status.js
 */
'use strict';

const assert = require('assert');
const {
  CHECKIN_STEPS,
  STAFF_ONBOARDING_STEPS,
  buildCheckinStatus,
  buildManagerOnboardingStatus,
} = require('../src/services/tenant-checkin.service');

assert.strictEqual(CHECKIN_STEPS.length, 4, 'tenant checklist has 4 steps');
assert.strictEqual(STAFF_ONBOARDING_STEPS.length, 1, 'manager has Vivint step');

const empty = buildCheckinStatus({}, false);
assert.strictEqual(empty.completedCount, 0);
assert.strictEqual(empty.totalSteps, 4);
assert.strictEqual(empty.allComplete, false);
assert.strictEqual(empty.bankLinked, false);

const partial = buildCheckinStatus(
  {
    password_changed_at: '2026-08-01T00:00:00Z',
    lease_viewed_at: '2026-08-02T00:00:00Z',
  },
  true
);
assert.strictEqual(partial.passwordChanged, true);
assert.strictEqual(partial.bankLinked, true);
assert.strictEqual(partial.leaseViewed, true);
assert.strictEqual(partial.maintenanceViewed, false);
assert.strictEqual(partial.completedCount, 3);
assert.strictEqual(partial.allComplete, false);

const complete = buildCheckinStatus(
  {
    password_changed_at: '2026-08-01T00:00:00Z',
    lease_viewed_at: '2026-08-02T00:00:00Z',
    maintenance_viewed_at: '2026-08-03T00:00:00Z',
  },
  true
);
assert.strictEqual(complete.completedCount, 4);
assert.strictEqual(complete.allComplete, true);

const managerIncomplete = buildManagerOnboardingStatus(
  {
    password_changed_at: '2026-08-01T00:00:00Z',
    lease_viewed_at: '2026-08-02T00:00:00Z',
    maintenance_viewed_at: '2026-08-03T00:00:00Z',
  },
  true
);
assert.strictEqual(managerIncomplete.tenantStepsComplete, true);
assert.strictEqual(managerIncomplete.vivintAccessConfigured, false);
assert.strictEqual(managerIncomplete.totalSteps, 5);
assert.strictEqual(managerIncomplete.completedCount, 4);
assert.strictEqual(managerIncomplete.allComplete, false);

const managerDone = buildManagerOnboardingStatus(
  {
    password_changed_at: '2026-08-01T00:00:00Z',
    lease_viewed_at: '2026-08-02T00:00:00Z',
    maintenance_viewed_at: '2026-08-03T00:00:00Z',
    vivint_access_configured_at: '2026-08-04T00:00:00Z',
  },
  true
);
assert.strictEqual(managerDone.vivintAccessConfigured, true);
assert.strictEqual(managerDone.completedCount, 5);
assert.strictEqual(managerDone.allComplete, true);

console.log('All tenant-checkin-status checks passed.');
