#!/usr/bin/env node
/**
 * Regression: native VA lease activation after deposit / identity.
 * Without verified Identity, deposit settlement must leave the lease in
 * awaiting_identity — never jump to active. Pure mock client (no DB).
 *
 * Run: npm run test:native-lease-activate
 */
'use strict';

const assert = require('assert');
const { activateNativeLeaseAfterDeposit } = require('../src/services/native-lease-activate.service');
const { tryActivateAfterIdentity } = require('../src/services/tenant-identity.service');

function createActivationClient({
  status = 'awaiting_deposit',
  identityStatus = null,
  signingProvider = 'native',
  depositPaidAt = null,
} = {}) {
  const state = {
    lease: {
      id: 'lease-activation-test',
      status,
      signing_provider: signingProvider,
      deposit_paid_at: depositPaidAt,
    },
    identity: identityStatus ? { status: identityStatus } : null,
  };

  return {
    state,
    async query(sql, params) {
      assert.deepStrictEqual(params, ['lease-activation-test']);
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.startsWith('select') && normalized.includes('from leases')) {
        return { rows: [state.lease] };
      }

      if (normalized.startsWith('select') && normalized.includes('from tenant_identity_verifications')) {
        return { rows: state.identity ? [state.identity] : [] };
      }

      if (normalized.startsWith('update leases') && normalized.includes("status = 'awaiting_identity'")) {
        if (state.lease.signing_provider !== 'native') return { rows: [] };
        state.lease.status = 'awaiting_identity';
        state.lease.deposit_paid_at = state.lease.deposit_paid_at || new Date();
        return { rows: [{ id: state.lease.id, status: state.lease.status }] };
      }

      if (normalized.startsWith('update leases') && normalized.includes("status = 'active'")) {
        if (state.lease.signing_provider !== 'native') return { rows: [] };
        if (state.lease.status !== 'awaiting_deposit' && state.lease.status !== 'awaiting_identity') {
          return { rows: [] };
        }
        state.lease.status = 'active';
        state.lease.deposit_paid_at = state.lease.deposit_paid_at || new Date();
        return { rows: [{ id: state.lease.id, status: state.lease.status }] };
      }

      throw new Error(`Unexpected activation query: ${sql}`);
    },
  };
}

async function run() {
  const noIdentity = createActivationClient({ identityStatus: null });
  const noIdentityResult = await activateNativeLeaseAfterDeposit(noIdentity, 'lease-activation-test');
  assert.strictEqual(noIdentityResult.status, 'awaiting_identity');
  assert.strictEqual(noIdentity.state.lease.status, 'awaiting_identity');
  assert.ok(noIdentity.state.lease.deposit_paid_at, 'deposit timestamp while awaiting identity');

  const unverified = createActivationClient({ identityStatus: 'requires_input' });
  const unverifiedResult = await activateNativeLeaseAfterDeposit(unverified, 'lease-activation-test');
  assert.strictEqual(unverifiedResult.status, 'awaiting_identity');

  const processing = createActivationClient({ identityStatus: 'processing' });
  const processingResult = await activateNativeLeaseAfterDeposit(processing, 'lease-activation-test');
  assert.strictEqual(processingResult.status, 'awaiting_identity');

  const verified = createActivationClient({ identityStatus: 'verified' });
  const verifiedResult = await activateNativeLeaseAfterDeposit(verified, 'lease-activation-test');
  assert.strictEqual(verifiedResult.status, 'active');
  assert.ok(verified.state.lease.deposit_paid_at);

  const fromAwaitingIdentity = createActivationClient({
    status: 'awaiting_identity',
    identityStatus: 'verified',
    depositPaidAt: new Date('2026-08-01T00:00:00Z'),
  });
  const lateVerify = await activateNativeLeaseAfterDeposit(fromAwaitingIdentity, 'lease-activation-test');
  assert.strictEqual(lateVerify.status, 'active');

  const draft = createActivationClient({ status: 'draft', identityStatus: 'verified' });
  assert.strictEqual(await activateNativeLeaseAfterDeposit(draft, 'lease-activation-test'), null);

  const legacy = createActivationClient({
    identityStatus: 'verified',
    signingProvider: 'rocketlawyer',
  });
  assert.strictEqual(await activateNativeLeaseAfterDeposit(legacy, 'lease-activation-test'), null);

  const identityFirst = createActivationClient({
    status: 'awaiting_deposit',
    identityStatus: 'verified',
  });
  assert.strictEqual(await tryActivateAfterIdentity(identityFirst, 'lease-activation-test'), null);
  assert.strictEqual(identityFirst.state.lease.status, 'awaiting_deposit');

  const awaitingIdentity = createActivationClient({
    status: 'awaiting_identity',
    identityStatus: 'verified',
    depositPaidAt: new Date('2026-08-01T00:00:00Z'),
  });
  const afterIdentity = await tryActivateAfterIdentity(awaitingIdentity, 'lease-activation-test');
  assert.strictEqual(afterIdentity.status, 'active');
  assert.strictEqual(awaitingIdentity.state.lease.status, 'active');

  console.log('test-native-lease-activate: OK');
}

run().catch((err) => {
  console.error('test-native-lease-activate: FAIL', err);
  process.exit(1);
});
