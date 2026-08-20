#!/usr/bin/env node
/**
 * Unit checks for tenant check-in / offboarding status builders.
 * Run: node scripts/test-tenant-lifecycle-status.js
 */
const {
  isOffboardingActive,
  buildOffboardingStatus,
  buildTenantOffboardingStatus,
  resolveStepMeta,
  TENANT_OFFBOARD_STEPS,
  STAFF_OFFBOARD_STEPS,
} = require('../src/services/tenant-offboarding.service');
const {
  buildCheckinStatus,
  buildManagerOnboardingStatus,
  CHECKIN_STEPS,
} = require('../src/services/tenant-checkin.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

// Offboarding activation
assert(isOffboardingActive(null) === false, 'null lease not active');
assert(isOffboardingActive({ status: 'active' }) === false, 'active lease not offboarding');
assert(isOffboardingActive({ status: 'expired' }) === true, 'expired activates offboarding');
assert(isOffboardingActive({ lease_status: 'terminated' }) === true, 'terminated activates');
assert(
  isOffboardingActive({ status: 'active', offboarding_started_at: '2026-08-01' }) === true,
  'explicit started_at activates even if lease still active'
);

const blank = buildOffboardingStatus({ id: 'lease-1', status: 'active' });
assert(blank.active === false && blank.leaseId === 'lease-1', 'inactive status is minimal');

const partial = buildOffboardingStatus({
  id: 'lease-2',
  status: 'expired',
  offboarding_started_at: '2026-08-01',
  offboard_forwarding_confirmed_at: '2026-08-02',
  offboard_keys_returned_at: null,
  offboard_final_charges_ack_at: null,
  offboard_moveout_confirmed_at: null,
  offboard_vivint_revoked_at: '2026-08-03',
});
assert(partial.active === true, 'partial offboarding is active');
assert(partial.forwardingConfirmed === true, 'maps forwardingConfirmed');
assert(partial.keysReturned === false, 'keysReturned false when null');
assert(partial.vivintRevoked === true, 'maps staff vivintRevoked');
assert(partial.completedCount === 2, 'counts tenant+staff done steps');
assert(
  partial.totalSteps === TENANT_OFFBOARD_STEPS.length + STAFF_OFFBOARD_STEPS.length,
  'total includes tenant + staff'
);
assert(partial.tenantStepsComplete === false, 'tenant incomplete until all 4');
assert(partial.allComplete === false, 'allComplete false until every step');

const partialLease = {
  id: 'lease-2',
  status: 'expired',
  offboarding_started_at: '2026-08-01',
  offboard_forwarding_confirmed_at: '2026-08-02',
  offboard_keys_returned_at: null,
  offboard_final_charges_ack_at: null,
  offboard_moveout_confirmed_at: null,
  offboard_vivint_revoked_at: '2026-08-03',
};
const tenantView = buildTenantOffboardingStatus(partialLease);
assert(tenantView.completedCount === 1, 'tenant view counts only tenant steps');
assert(tenantView.totalSteps === TENANT_OFFBOARD_STEPS.length, 'tenant view total is 4');
assert(tenantView.allComplete === false, 'tenant allComplete ignores staff');
assert(tenantView.vivintRevoked === true, 'tenant view still exposes staff flags');

const allDoneRow = {
  id: 'lease-3',
  status: 'terminated',
  offboarding_started_at: '2026-07-01',
  offboard_forwarding_confirmed_at: 'x',
  offboard_keys_returned_at: 'x',
  offboard_final_charges_ack_at: 'x',
  offboard_moveout_confirmed_at: 'x',
  offboard_vivint_revoked_at: 'x',
  offboard_bank_unlinked_at: 'x',
  offboard_utilities_settled_at: 'x',
  offboard_portal_disabled_at: 'x',
};
const done = buildOffboardingStatus(allDoneRow);
assert(done.allComplete === true && done.tenantStepsComplete === true, 'allComplete when every step set');
assert(
  buildTenantOffboardingStatus(allDoneRow).allComplete === true,
  'tenant allComplete when tenant steps done'
);

assert(resolveStepMeta('keysReturned')?.staff === false, 'resolve tenant step');
assert(resolveStepMeta('portalDisabled')?.staff === true, 'resolve staff step');
assert(resolveStepMeta('nope') === null, 'unknown step → null');

// Check-in / manager onboarding
const emptyCheckin = buildCheckinStatus({}, false);
assert(emptyCheckin.completedCount === 0, 'empty checkin zero');
assert(emptyCheckin.totalSteps === CHECKIN_STEPS.length, 'checkin has 4 steps');
assert(emptyCheckin.allComplete === false, 'empty not complete');

const mid = buildCheckinStatus(
  { password_changed_at: 'x', lease_viewed_at: 'x' },
  true
);
assert(mid.passwordChanged && mid.bankLinked && mid.leaseViewed, 'maps three done flags');
assert(mid.maintenanceViewed === false, 'maintenance still open');
assert(mid.completedCount === 3 && mid.allComplete === false, '3/4 not allComplete');

const fullTenant = buildCheckinStatus(
  {
    password_changed_at: 'x',
    lease_viewed_at: 'x',
    maintenance_viewed_at: 'x',
  },
  true
);
assert(fullTenant.allComplete === true, 'tenant checkin complete without vivint');

const mgrIncomplete = buildManagerOnboardingStatus(
  {
    password_changed_at: 'x',
    lease_viewed_at: 'x',
    maintenance_viewed_at: 'x',
  },
  true
);
assert(mgrIncomplete.tenantStepsComplete === true, 'manager sees tenant steps done');
assert(mgrIncomplete.vivintAccessConfigured === false, 'vivint open');
assert(mgrIncomplete.allComplete === false, 'manager allComplete requires vivint');
assert(mgrIncomplete.totalSteps === 5, 'manager total is 5');

const mgrDone = buildManagerOnboardingStatus(
  {
    password_changed_at: 'x',
    lease_viewed_at: 'x',
    maintenance_viewed_at: 'x',
    vivint_access_configured_at: 'x',
  },
  true
);
assert(mgrDone.allComplete === true && mgrDone.completedCount === 5, 'manager allComplete with vivint');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll tenant-lifecycle-status checks passed.');
