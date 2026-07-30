#!/usr/bin/env node
/**
 * Native lease API smoke test for the local seeded 743 A Ave users.
 */

const assert = require('assert');
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

const STAFF_EMAIL = process.env.NATIVE_LEASE_STAFF_EMAIL || 'manager@example.com';
const TENANT_EMAIL = process.env.NATIVE_LEASE_TENANT_EMAIL || 'tenant@example.com';
const UNIT_ID = process.env.NATIVE_LEASE_UNIT_ID || '70ecac50-b98d-4243-96a9-5da48a1f7192';

function isoDateDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requireStatus(label, response, expected) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

function isStripeAccountRestriction(response) {
  const body = JSON.stringify(response.body || {});
  return response.status >= 500
    && /charges_enabled|charges enabled|account.*restricted|capabilit/i.test(body);
}

async function findSeedTenant() {
  const { rows } = await pool.query(
    `SELECT id, email
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [TENANT_EMAIL]
  );
  assert(rows[0], `Seed tenant not found: ${TENANT_EMAIL}`);
  return rows[0];
}

async function findPendingDeposit(leaseId) {
  const { rows } = await pool.query(
    `SELECT id, amount, payment_type, status, metadata
       FROM payments
      WHERE lease_id = $1
        AND payment_type = 'security_deposit'
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [leaseId]
  );
  return rows[0] || null;
}

async function findSigningFee(leaseId) {
  const { rows } = await pool.query(
    `SELECT id, status
       FROM manager_lease_signing_fees
      WHERE lease_id = $1
      LIMIT 1`,
    [leaseId]
  );
  return rows[0] || null;
}

async function main() {
  const reporter = createReporter();
  let leaseId = null;

  await section('Native lease API flow', async () => {
    const staffToken = await login(STAFF_EMAIL, MANAGER_PW || PW);
    const tenantToken = await login(TENANT_EMAIL, TENANT_PW || PW);
    reporter.ok('staff and tenant can log in');

    const tenant = await findSeedTenant();
    reporter.ok('seed tenant resolved');

    const createRes = await req('POST', '/api/leases/native', {
      unit_id: UNIT_ID,
      tenant_id: tenant.id,
      room_type: 'regular',
      start_date: isoDateDaysFromNow(45),
      end_date: isoDateDaysFromNow(410),
      house_rules: { guestNights: 5 },
    }, staffToken);
    requireStatus('create native lease', createRes, 201);
    leaseId = createRes.body.lease.id;
    assert.strictEqual(Number(createRes.body.lease.monthly_rent), 900);
    assert.strictEqual(createRes.body.lease.signing_provider, 'native');
    assert.strictEqual(createRes.body.lease.status, 'draft');
    reporter.ok('native draft created with regular room defaults');

    const pdfRes = await req('POST', `/api/leases/${leaseId}/native/pdf`, null, staffToken);
    requireStatus('generate native PDF', pdfRes, 200);
    assert(pdfRes.body.pdfPath || pdfRes.body.path, 'PDF response should include a path');
    reporter.ok('native PDF generated');

    const documentRes = await req('GET', `/api/leases/${leaseId}/native/document`, null, tenantToken);
    requireStatus('get native document', documentRes, 200);
    assert(documentRes.body.url?.startsWith('/documents/'), 'native document URL should be served from /documents');
    reporter.ok('native document URL returned to tenant');

    const sendRes = await req('POST', `/api/leases/${leaseId}/native/send`, null, staffToken);
    requireStatus('send native lease', sendRes, 200);
    assert.strictEqual(sendRes.body.lease.status, 'pending_tenant_signature');
    assert.strictEqual(sendRes.body.envelope.provider, 'native');
    assert.strictEqual(sendRes.body.signers.length, 2);
    reporter.ok('native envelope created for tenant then manager');

    const tenantSignRes = await req('POST', `/api/leases/${leaseId}/native/sign`, {
      signedName: 'Local Tenant',
    }, tenantToken);
    requireStatus('tenant native sign', tenantSignRes, 200);
    assert.strictEqual(tenantSignRes.body.lease.status, 'pending_manager_signature');
    reporter.ok('tenant signature advances to manager signature');

    const managerSignRes = await req('POST', `/api/leases/${leaseId}/native/sign`, {
      signedName: 'Local Manager',
    }, staffToken);
    requireStatus('manager native sign', managerSignRes, 200);
    assert.strictEqual(managerSignRes.body.lease.status, 'awaiting_deposit');
    assert(managerSignRes.body.lease.signed_pdf_path, 'signed PDF path should be stored');
    assert(managerSignRes.body.feeId, 'manager signing fee should be ensured');
    reporter.ok('manager signature flattens PDF and awaits deposit');

    const deposit = await findPendingDeposit(leaseId);
    assert(deposit, 'pending security deposit payment should exist');
    assert.strictEqual(Number(deposit.amount), 900);
    assert.strictEqual(deposit.metadata?.source, 'native_lease_activation');
    reporter.ok('pending security deposit payment row created');

    const cardIntentRes = await req('POST', '/api/payments/card/create-intent', {
      leaseId,
      paymentType: 'security_deposit',
    }, tenantToken);
    if (isStripeAccountRestriction(cardIntentRes)) {
      reporter.skip('card security deposit PaymentIntent can be created while awaiting deposit', JSON.stringify(cardIntentRes.body));
    } else {
      requireStatus('card security deposit PaymentIntent', cardIntentRes, 200);
      assert(cardIntentRes.body.clientSecret, 'card intent response should include clientSecret');
      assert(cardIntentRes.body.paymentIntentId, 'card intent response should include paymentIntentId');
      reporter.ok('card security deposit PaymentIntent can be created while awaiting deposit');
    }

    const fee = await findSigningFee(leaseId);
    assert(fee, 'manager signing fee row should exist');
    assert.strictEqual(fee.status, 'pending_rent');
    reporter.ok('manager signing fee row created as pending rent');

    const gateRes = await req('POST', `/api/leases/${leaseId}/documents`, {}, staffToken);
    requireStatus('Rocket Lawyer native gate', gateRes, 400);
    assert.match(gateRes.body.error, /native Montero signing/i);
    reporter.ok('Rocket Lawyer document creation is blocked for native lease');
  });

  reporter.printSummary('NATIVE LEASE API');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
