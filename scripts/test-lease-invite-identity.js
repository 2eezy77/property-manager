#!/usr/bin/env node
/**
 * Lease invite + identity QA smoke script.
 *
 * Task 2 covers the invite portion only; identity cases will be appended by the
 * follow-up task.
 */

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../src/db/client');
const {
  createReporter,
  req,
  login,
  section,
  PW,
  MANAGER_PW,
  TENANT_PW,
} = require('./lib/test-helpers');
const { computeCardCashAppFee } = require('../src/services/payment-processing-fee.service');
const {
  applyIdentitySessionUpdate,
  isIdentityVerified,
  tryActivateAfterIdentity,
} = require('../src/services/tenant-identity.service');
const { activateNativeLeaseAfterDeposit } = require('../src/services/native-lease-activate.service');
const identityVerificationAlert = require('../src/services/email-templates/identityVerificationAlert');
const stripeWebhook = require('../src/webhooks/stripe.webhook');

const STAFF_EMAIL = process.env.NATIVE_LEASE_STAFF_EMAIL || 'manager@example.com';
const UNIT_ID = process.env.NATIVE_LEASE_UNIT_ID || '70ecac50-b98d-4243-96a9-5da48a1f7192';

function isoDateDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueInviteEmail() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `lease-invite-${stamp}-${process.pid}-${crypto.randomBytes(3).toString('hex')}@example.com`;
}

function requireStatus(label, response, expected) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function loadTenant(email) {
  const { rows } = await pool.query(
    `SELECT id, email, first_name, last_name, phone, role, org_id
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function loadStaffOrgId(email) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
              u.org_id,
              (
                SELECT p.org_id
                  FROM property_assignments pa
                  JOIN properties p ON p.id = pa.property_id
                 WHERE pa.user_id = u.id
                 ORDER BY p.created_at ASC
                 LIMIT 1
              )
            ) AS org_id
       FROM users u
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1`,
    [email]
  );
  return rows[0]?.org_id || null;
}

async function setTenantPassword(userId) {
  const passwordHash = await bcrypt.hash(TENANT_PW || PW, 12);
  await pool.query(
    `UPDATE users
        SET password_hash = $1,
            email_verified_at = COALESCE(email_verified_at, NOW()),
            updated_at = NOW()
      WHERE id = $2`,
    [passwordHash, userId]
  );
}

function createActivationClient({ status = 'awaiting_deposit', identityStatus = null } = {}) {
  const state = {
    lease: {
      id: 'lease-activation-test',
      status,
      signing_provider: 'native',
      deposit_paid_at: null,
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

async function runActivationGateChecks(reporter) {
  const noIdentity = createActivationClient({ identityStatus: null });
  const noIdentityResult = await activateNativeLeaseAfterDeposit(noIdentity, 'lease-activation-test');
  assert.strictEqual(noIdentityResult.status, 'awaiting_identity');
  assert.strictEqual(noIdentity.state.lease.status, 'awaiting_identity');
  assert(noIdentity.state.lease.deposit_paid_at, 'deposit timestamp should be set while awaiting identity');
  reporter.ok('deposit success without verified identity moves native lease to awaiting_identity');

  const unverified = createActivationClient({ identityStatus: 'requires_input' });
  const unverifiedResult = await activateNativeLeaseAfterDeposit(unverified, 'lease-activation-test');
  assert.strictEqual(unverifiedResult.status, 'awaiting_identity');
  reporter.ok('deposit success with incomplete identity keeps native lease awaiting_identity');

  const verified = createActivationClient({ identityStatus: 'verified' });
  const verifiedResult = await activateNativeLeaseAfterDeposit(verified, 'lease-activation-test');
  assert.strictEqual(verifiedResult.status, 'active');
  assert(verified.state.lease.deposit_paid_at, 'active transition should set deposit timestamp');
  reporter.ok('deposit success with verified identity activates native lease');

  const identityFirst = createActivationClient({ status: 'awaiting_deposit', identityStatus: 'verified' });
  const identityFirstResult = await tryActivateAfterIdentity(identityFirst, 'lease-activation-test');
  assert.strictEqual(identityFirstResult, null);
  assert.strictEqual(identityFirst.state.lease.status, 'awaiting_deposit');
  reporter.ok('identity verified before deposit leaves native lease awaiting_deposit');

  const awaitingIdentity = createActivationClient({ status: 'awaiting_identity', identityStatus: 'verified' });
  const awaitingIdentityResult = await tryActivateAfterIdentity(awaitingIdentity, 'lease-activation-test');
  assert.strictEqual(awaitingIdentityResult.status, 'active');
  assert.strictEqual(awaitingIdentity.state.lease.status, 'active');
  reporter.ok('identity verified after deposit activates native lease');
}

async function runVerifiedIdentityTerminalCheck(reporter) {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const verifiedRow = {
    id: 'identity-terminal-test',
    lease_id: 'lease-terminal-test',
    tenant_id: 'tenant-terminal-test',
    stripe_verification_session_id: 'vs_terminal_test',
    status: 'verified',
    verified_at: new Date('2026-01-01T00:00:00Z'),
    legal_name: 'Verified Tenant',
    date_of_birth: '1990-01-02',
    address_line1: '123 Verified St',
    ssn_last4: '6789',
  };
  const client = {
    updateCount: 0,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rows: [] };
      }
      if (normalized.startsWith('select') && normalized.includes('from tenant_identity_verifications')) {
        assert.deepStrictEqual(params, ['vs_terminal_test']);
        return { rows: [verifiedRow] };
      }
      if (normalized.startsWith('update tenant_identity_verifications')) {
        this.updateCount += 1;
        return {
          rows: [{
            ...verifiedRow,
            status: params[1],
            last_error_code: params[2],
            last_error_reason: params[3],
            legal_name: params[4] || verifiedRow.legal_name,
          }],
        };
      }
      throw new Error(`Unexpected terminal identity query: ${sql}`);
    },
    release() {},
  };

  pool.connect = async () => client;
  pool.query = async () => ({ rows: [] });
  try {
    const result = await applyIdentitySessionUpdate({
      id: 'vs_terminal_test',
      status: 'requires_input',
      last_error: { code: 'document_unverified', reason: 'blurry_image' },
      verified_outputs: {
        first_name: 'Downgrade',
        last_name: 'Attempt',
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(result.status, 'verified');
    assert.strictEqual(result.legal_name, 'Verified Tenant');
    assert.strictEqual(client.updateCount, 0, 'verified identity rows should not be overwritten by later downgrade webhooks');
    reporter.ok('verified identity ignores out-of-order downgrade webhooks');
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }
}

function createChargeSucceededClient({ identityStatus }) {
  const state = {
    lease: {
      id: 'lease-charge-test',
      status: 'awaiting_deposit',
      signing_provider: 'native',
      deposit_paid_at: null,
    },
    identity: identityStatus ? { status: identityStatus } : null,
    payment: {
      id: 'payment-charge-test',
      lease_id: 'lease-charge-test',
      tenant_id: 'tenant-charge-test',
      amount: '1000.00',
      payment_type: 'security_deposit',
      status: 'processing',
    },
    notifications: [],
    lateFeesTouched: false,
    splitTouched: false,
  };

  const client = {
    state,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rows: [] };
      }
      if (normalized.startsWith('update payments')) {
        assert.deepStrictEqual(params, ['ch_charge_deposit', 'evt_charge_deposit']);
        state.payment.status = 'succeeded';
        state.payment.stripe_charge_id = params[0];
        state.payment.stripe_webhook_event_id = params[1];
        state.payment.paid_at = state.payment.paid_at || new Date();
        return { rows: [state.payment] };
      }
      if (normalized.startsWith('select') && normalized.includes('from leases')) {
        assert.deepStrictEqual(params, ['lease-charge-test']);
        return { rows: [state.lease] };
      }
      if (normalized.startsWith('select') && normalized.includes('from tenant_identity_verifications')) {
        assert.deepStrictEqual(params, ['lease-charge-test']);
        return { rows: state.identity ? [state.identity] : [] };
      }
      if (normalized.startsWith('update leases') && normalized.includes("status = 'awaiting_identity'")) {
        state.lease.status = 'awaiting_identity';
        state.lease.deposit_paid_at = state.lease.deposit_paid_at || new Date();
        return { rows: [{ id: state.lease.id, status: state.lease.status }] };
      }
      if (normalized.startsWith('update leases') && normalized.includes("status = 'active'")) {
        state.lease.status = 'active';
        state.lease.deposit_paid_at = state.lease.deposit_paid_at || new Date();
        return { rows: [{ id: state.lease.id, status: state.lease.status }] };
      }
      if (normalized.startsWith('insert into notifications')) {
        state.notifications.push({ params, sql });
        return { rows: [] };
      }
      if (normalized.startsWith('update late_fees')) {
        state.lateFeesTouched = true;
        throw new Error('security deposit charge should not mark rent late fees paid');
      }
      if (normalized.includes('payment_splits')) {
        state.splitTouched = true;
        throw new Error('security deposit charge should not create rent payment splits');
      }
      throw new Error(`Unexpected charge success query: ${sql}`);
    },
    release() {},
  };
  return client;
}

async function runChargeSucceededDepositGateChecks(reporter) {
  assert(
    stripeWebhook.__test?.onChargeSucceeded,
    'stripe webhook should expose onChargeSucceeded for unit-level regression coverage'
  );

  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    const awaitingIdentityClient = createChargeSucceededClient({ identityStatus: null });
    pool.connect = async () => awaitingIdentityClient;
    await stripeWebhook.__test.onChargeSucceeded({ id: 'ch_charge_deposit', payment_intent: 'pi_charge_deposit' }, 'evt_charge_deposit');
    assert.strictEqual(awaitingIdentityClient.state.lease.status, 'awaiting_identity');
    assert(awaitingIdentityClient.state.lease.deposit_paid_at, 'charge success should stamp deposit_paid_at');
    assert.strictEqual(awaitingIdentityClient.state.lateFeesTouched, false);
    assert.strictEqual(awaitingIdentityClient.state.splitTouched, false);
    assert.match(awaitingIdentityClient.state.notifications[0].params[1], /security deposit/i);
    reporter.ok('charge.succeeded deposit without verified identity moves native lease to awaiting_identity');

    const activeClient = createChargeSucceededClient({ identityStatus: 'verified' });
    pool.connect = async () => activeClient;
    await stripeWebhook.__test.onChargeSucceeded({ id: 'ch_charge_deposit', payment_intent: 'pi_charge_deposit' }, 'evt_charge_deposit');
    assert.strictEqual(activeClient.state.lease.status, 'active');
    assert(activeClient.state.lease.deposit_paid_at, 'charge success should stamp deposit_paid_at before activation');
    assert.strictEqual(activeClient.state.lateFeesTouched, false);
    assert.strictEqual(activeClient.state.splitTouched, false);
    reporter.ok('charge.succeeded deposit with verified identity activates native lease');
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }
}

function runIdentityAlertTemplateChecks(reporter) {
  const { html, text } = identityVerificationAlert.render({
    tenantName: 'Invited Tenant',
    tenantEmail: 'tenant@example.com',
    status: 'requires_input',
    reason: 'SSN 123-45-6789 could not be verified',
    unitLabel: 'Unit 1',
    propertyName: '743 A Ave',
  });
  assert(!html.includes('123-45-6789'), 'HTML alert should redact SSN-like strings');
  assert(!text.includes('123-45-6789'), 'text alert should redact SSN-like strings');
  reporter.ok('identity failure staff alert redacts SSN-like strings');
}

async function seedLeaseLessTenant(orgId) {
  const email = uniqueInviteEmail();
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const { rows } = await pool.query(
    `INSERT INTO users
       (email, password_hash, role, first_name, last_name, phone, org_id, email_verified_at)
     VALUES ($1, $2, 'tenant', $3, $4, $5, $6, NULL)
     RETURNING id, email, org_id`,
    [email, passwordHash, 'Leaseless', 'Picker', '757-555-0100', orgId]
  );
  return rows[0];
}

async function main() {
  const reporter = createReporter();

  await section('Native activation gate', async () => {
    await runActivationGateChecks(reporter);
    await runVerifiedIdentityTerminalCheck(reporter);
    await runChargeSucceededDepositGateChecks(reporter);
    runIdentityAlertTemplateChecks(reporter);
  });
  if (process.env.LEASE_INVITE_IDENTITY_ACTIVATION_ONLY === '1') {
    reporter.printSummary('LEASE INVITE IDENTITY ACTIVATION');
    return;
  }

  await section('Lease create tenant invite', async () => {
    const staffToken = await login(STAFF_EMAIL, MANAGER_PW || PW);
    reporter.ok('staff can log in');

    const orgId = await loadStaffOrgId(STAFF_EMAIL);
    assert(orgId, 'staff user should resolve to an org_id');
    const leaseLessTenant = await seedLeaseLessTenant(orgId);
    const leaseLessPickerRes = await req('GET', '/api/tenants?for_lease_create=1', null, staffToken);
    requireStatus('lease-less tenant picker list', leaseLessPickerRes, 200);
    const leaseLessMatch = leaseLessPickerRes.body.tenants.find((t) => t.id === leaseLessTenant.id);
    assert(leaseLessMatch, 'lease-less org tenant should appear in for_lease_create picker');
    assert.strictEqual(leaseLessMatch.lease_id, null, 'lease-less tenant should have null lease_id');
    reporter.ok('lease-create tenant picker includes org tenant without lease (UNION branch)');

    const missingPhoneRes = await req('POST', '/api/leases/native', {
      unit_id: UNIT_ID,
      room_type: 'regular',
      start_date: isoDateDaysFromNow(55),
      end_date: isoDateDaysFromNow(420),
      invite: {
        email: uniqueInviteEmail(),
        first_name: 'Invite',
        last_name: 'MissingPhone',
      },
    }, staffToken);
    requireStatus('invite missing phone validation', missingPhoneRes, 400);
    assert.match(
      `${missingPhoneRes.body.error || ''} ${missingPhoneRes.body.code || ''}`,
      /phone/i,
      'missing phone response should mention phone'
    );
    reporter.ok('invite without phone is rejected with phone validation');

    const inviteEmail = uniqueInviteEmail();
    const createRes = await req('POST', '/api/leases/native', {
      unit_id: UNIT_ID,
      room_type: 'regular',
      start_date: isoDateDaysFromNow(60),
      end_date: isoDateDaysFromNow(425),
      invite: {
        email: inviteEmail,
        first_name: 'Invited',
        last_name: 'Tenant',
        phone: '757-555-0199',
      },
    }, staffToken);
    requireStatus('create native lease with invite', createRes, 201);
    assert.strictEqual(createRes.body.lease.status, 'draft');
    assert.strictEqual(createRes.body.lease.signing_provider, 'native');
    assert.strictEqual(createRes.body.tenant.email, inviteEmail);
    assert.strictEqual(createRes.body.lease.tenant_id, createRes.body.tenant.id);
    assert.strictEqual(typeof createRes.body.inviteSent, 'boolean');
    reporter.ok('native draft lease is created for invited tenant');

    const tenant = await loadTenant(inviteEmail);
    assert(tenant, 'invited tenant user should exist');
    assert.strictEqual(tenant.role, 'tenant');
    assert(tenant.org_id, 'invited tenant should have org_id');
    assert.strictEqual(tenant.phone, '757-555-0199');
    reporter.ok('invited tenant user has org_id and phone');

    const tenantsRes = await req('GET', '/api/tenants?for_lease_create=1', null, staffToken);
    requireStatus('tenant picker list', tenantsRes, 200);
    assert(
      tenantsRes.body.tenants.some((t) => t.id === tenant.id),
      'GET /api/tenants?for_lease_create=1 should include invited org tenant'
    );
    reporter.ok('lease-create tenant picker includes invited org tenant');

    await setTenantPassword(tenant.id);
    const tenantToken = await login(inviteEmail, TENANT_PW || PW);
    const noFeeSessionRes = await req(
      'POST',
      `/api/leases/${createRes.body.lease.id}/identity/session`,
      null,
      tenantToken
    );
    assert(
      [400, 402].includes(noFeeSessionRes.status),
      `identity session without fee should be rejected, got ${noFeeSessionRes.status} ${JSON.stringify(noFeeSessionRes.body)}`
    );
    assert.strictEqual(noFeeSessionRes.body.code || noFeeSessionRes.body.error, 'IDENTITY_FEE_REQUIRED');
    reporter.ok('identity session is blocked until tenant pays the identity fee');

    const feeRes = await req(
      'POST',
      `/api/leases/${createRes.body.lease.id}/identity/fee`,
      null,
      tenantToken
    );
    requireStatus('identity fee intent', feeRes, 200);
    const expectedFee = computeCardCashAppFee(150);
    assert.strictEqual(feeRes.body.baseAmount, expectedFee.baseAmount);
    assert.strictEqual(feeRes.body.processingFee, expectedFee.processingFee);
    assert.strictEqual(feeRes.body.amount, expectedFee.totalAmount);
    assert(feeRes.body.clientSecret, 'fee intent should return a Stripe client secret');
    assert(feeRes.body.paymentId, 'fee intent should return a payment row id');
    reporter.ok('identity fee intent uses locked base amount and card processing fee');

    await pool.query(
      `UPDATE payments
          SET status = 'succeeded',
              paid_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [feeRes.body.paymentId]
    );
    const paidSessionRes = await req(
      'POST',
      `/api/leases/${createRes.body.lease.id}/identity/session`,
      null,
      tenantToken
    );
    if (paidSessionRes.status === 503 && paidSessionRes.body.error === 'STRIPE_IDENTITY_UNAVAILABLE') {
      reporter.skip('identity hosted session creates after fee', paidSessionRes.body.message || 'Stripe Identity unavailable');
    } else {
      requireStatus('identity hosted session after fee', paidSessionRes, 200);
      assert(paidSessionRes.body.url, 'identity session should return hosted Stripe URL');
      assert(paidSessionRes.body.sessionId, 'identity session should return Stripe session id');
      reporter.ok('identity hosted session is created after fee payment');

      await applyIdentitySessionUpdate({
        id: paidSessionRes.body.sessionId,
        status: 'verified',
        metadata: {
          lease_id: createRes.body.lease.id,
          tenant_id: tenant.id,
        },
        verified_outputs: {
          first_name: 'Invited',
          last_name: 'Tenant',
          dob: { year: 1990, month: 1, day: 2 },
          address: {
            line1: '123 Test St',
            city: 'Norfolk',
            state: 'VA',
            postal_code: '23510',
          },
        },
      });
      assert.strictEqual(await isIdentityVerified(createRes.body.lease.id), true);
      reporter.ok('identity session update marks the lease identity verified');
    }

    const duplicateRes = await req('POST', '/api/leases/native', {
      unit_id: UNIT_ID,
      room_type: 'regular',
      start_date: isoDateDaysFromNow(65),
      end_date: isoDateDaysFromNow(430),
      invite: {
        email: inviteEmail.toUpperCase(),
        first_name: 'Invited',
        phone: '757-555-0199',
      },
    }, staffToken);
    requireStatus('duplicate tenant invite', duplicateRes, 409);
    assert.strictEqual(duplicateRes.body.code, 'USE_EXISTING_TENANT');
    assert.match(duplicateRes.body.error || '', /Existing tenant/i);
    reporter.ok('duplicate tenant invite asks staff to use Existing tenant');
  });

  reporter.printSummary('LEASE INVITE API');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
