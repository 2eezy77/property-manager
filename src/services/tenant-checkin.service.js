/**
 * Tenant move-in checklist (4 steps) — shared by tenant self-service and staff views.
 */

const CHECKIN_STEPS = [
  { key: 'passwordChanged', label: 'Password changed' },
  { key: 'bankLinked', label: 'Bank linked' },
  { key: 'leaseViewed', label: 'Lease reviewed' },
  { key: 'maintenanceViewed', label: 'Maintenance viewed' },
];

/** Manager-only step (Konstantin programs Vivint codes/keys per tenant). */
const STAFF_ONBOARDING_STEPS = [
  { key: 'vivintAccessConfigured', label: 'Vivint access configured' },
];

function buildCheckinStatus(userRow, hasVerifiedBank) {
  const passwordChanged = !!userRow?.password_changed_at;
  const bankLinked = !!hasVerifiedBank;
  const leaseViewed = !!userRow?.lease_viewed_at;
  const maintenanceViewed = !!userRow?.maintenance_viewed_at;

  const steps = {
    passwordChanged,
    bankLinked,
    leaseViewed,
    maintenanceViewed,
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalSteps = CHECKIN_STEPS.length;

  return {
    ...steps,
    completedCount,
    totalSteps,
    allComplete: completedCount >= totalSteps,
  };
}

function buildManagerOnboardingStatus(userRow, hasVerifiedBank) {
  const base = buildCheckinStatus(userRow, hasVerifiedBank);
  const vivintAccessConfigured = !!userRow?.vivint_access_configured_at;
  const completedCount = base.completedCount + (vivintAccessConfigured ? 1 : 0);
  const totalSteps = base.totalSteps + STAFF_ONBOARDING_STEPS.length;

  return {
    ...base,
    vivintAccessConfigured,
    completedCount,
    totalSteps,
    tenantStepsComplete: base.allComplete,
    allComplete: base.allComplete && vivintAccessConfigured,
  };
}

module.exports = {
  CHECKIN_STEPS,
  STAFF_ONBOARDING_STEPS,
  buildCheckinStatus,
  buildManagerOnboardingStatus,
};
