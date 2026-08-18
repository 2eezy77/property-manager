#!/usr/bin/env node
/**
 * Unit checks for native VA lease UI step derivation from lease.status.
 * Wrong mapping skips deposit or identity gates on Finish Lease.
 * Run: node scripts/test-native-lease-step.js
 */
'use strict';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

(async () => {
  const { deriveNativeLeaseStep } = await import('../client/src/utils/nativeLeaseHelpers.js');

  assert(deriveNativeLeaseStep(null) === null, 'missing lease has no step');
  assert(
    deriveNativeLeaseStep({ signing_provider: 'rocket_lawyer', status: 'active' }) === null,
    'non-native leases do not use native steps'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'draft' }) === 'draft',
    'draft → draft'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'pending_tenant_signature' }) === 'sign_tenant',
    'pending_tenant_signature → sign_tenant'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'pending_manager_signature' }) === 'sign_manager',
    'pending_manager_signature → sign_manager'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'awaiting_deposit' }) === 'pay_deposit',
    'awaiting_deposit → pay_deposit'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'awaiting_identity' }) === 'verify_identity',
    'awaiting_identity → verify_identity'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'active' }) === 'active',
    'active → active'
  );
  assert(
    deriveNativeLeaseStep({ signing_provider: 'native', status: 'terminated' }) === 'terminated',
    'unknown statuses pass through'
  );

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll native lease step checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
