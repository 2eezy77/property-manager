/**
 * Tenant move-out checklist — lease-scoped (tenant + staff steps).
 */

const TENANT_OFFBOARD_STEPS = [
  { key: 'forwardingConfirmed', label: 'Forwarding address confirmed', column: 'offboard_forwarding_confirmed_at' },
  { key: 'keysReturned', label: 'Keys returned', column: 'offboard_keys_returned_at' },
  { key: 'finalChargesAck', label: 'Final charges acknowledged', column: 'offboard_final_charges_ack_at' },
  { key: 'moveoutConfirmed', label: 'Move-out walkthrough complete', column: 'offboard_moveout_confirmed_at' },
];

const STAFF_OFFBOARD_STEPS = [
  { key: 'vivintRevoked', label: 'Vivint access revoked', column: 'offboard_vivint_revoked_at', byColumn: 'offboard_vivint_revoked_by' },
  { key: 'bankUnlinked', label: 'Bank unlinked (Plaid)', column: 'offboard_bank_unlinked_at', byColumn: 'offboard_bank_unlinked_by' },
  { key: 'utilitiesSettled', label: 'Final utilities settled', column: 'offboard_utilities_settled_at', byColumn: 'offboard_utilities_settled_by' },
  { key: 'portalDisabled', label: 'Portal access disabled', column: 'offboard_portal_disabled_at', byColumn: 'offboard_portal_disabled_by' },
];

const TENANT_STEP_KEYS = new Set(TENANT_OFFBOARD_STEPS.map((s) => s.key));
const STAFF_STEP_KEYS = new Set(STAFF_OFFBOARD_STEPS.map((s) => s.key));
const ALL_STEP_KEYS = new Set([...TENANT_STEP_KEYS, ...STAFF_STEP_KEYS]);

const OFFBOARDING_LEASE_STATUSES = new Set(['expired', 'terminated']);

function isOffboardingActive(leaseRow) {
  if (!leaseRow) return false;
  if (leaseRow.offboarding_started_at) return true;
  return OFFBOARDING_LEASE_STATUSES.has(leaseRow.lease_status || leaseRow.status);
}

function buildOffboardingStatus(leaseRow) {
  if (!isOffboardingActive(leaseRow)) {
    return { active: false, leaseId: leaseRow?.offboard_lease_id || leaseRow?.id || null };
  }

  const steps = {};
  for (const s of TENANT_OFFBOARD_STEPS) {
    steps[s.key] = !!leaseRow[s.column];
  }
  for (const s of STAFF_OFFBOARD_STEPS) {
    steps[s.key] = !!leaseRow[s.column];
  }

  const tenantDone = TENANT_OFFBOARD_STEPS.filter((s) => steps[s.key]).length;
  const staffDone = STAFF_OFFBOARD_STEPS.filter((s) => steps[s.key]).length;
  const completedCount = tenantDone + staffDone;
  const totalSteps = TENANT_OFFBOARD_STEPS.length + STAFF_OFFBOARD_STEPS.length;

  return {
    active: true,
    leaseId: leaseRow.offboard_lease_id || leaseRow.id,
    leaseStatus: leaseRow.lease_status || leaseRow.status,
    startedAt: leaseRow.offboarding_started_at,
    ...steps,
    completedCount,
    totalSteps,
    tenantStepsComplete: tenantDone >= TENANT_OFFBOARD_STEPS.length,
    allComplete: completedCount >= totalSteps,
  };
}

function buildManagerOffboardingStatus(leaseRow) {
  return buildOffboardingStatus(leaseRow);
}

function buildTenantOffboardingStatus(leaseRow) {
  const base = buildOffboardingStatus(leaseRow);
  if (!base.active) return base;

  const tenantDone = TENANT_OFFBOARD_STEPS.filter((s) => base[s.key]).length;
  return {
    ...base,
    completedCount: tenantDone,
    totalSteps: TENANT_OFFBOARD_STEPS.length,
    allComplete: tenantDone >= TENANT_OFFBOARD_STEPS.length,
  };
}

function resolveStepMeta(stepKey) {
  const tenant = TENANT_OFFBOARD_STEPS.find((s) => s.key === stepKey);
  if (tenant) return { ...tenant, staff: false };
  const staff = STAFF_OFFBOARD_STEPS.find((s) => s.key === stepKey);
  if (staff) return { ...staff, staff: true };
  return null;
}

module.exports = {
  TENANT_OFFBOARD_STEPS,
  STAFF_OFFBOARD_STEPS,
  TENANT_STEP_KEYS,
  STAFF_STEP_KEYS,
  ALL_STEP_KEYS,
  isOffboardingActive,
  buildOffboardingStatus,
  buildManagerOffboardingStatus,
  buildTenantOffboardingStatus,
  resolveStepMeta,
};
