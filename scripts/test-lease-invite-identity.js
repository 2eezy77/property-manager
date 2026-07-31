#!/usr/bin/env node
/**
 * Lease invite + identity QA smoke script.
 *
 * Task 2 covers the invite portion only; identity cases will be appended by the
 * follow-up task.
 */

const assert = require('assert');
const crypto = require('crypto');
const pool = require('../src/db/client');
const {
  createReporter,
  req,
  login,
  section,
  PW,
  MANAGER_PW,
} = require('./lib/test-helpers');

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

async function main() {
  const reporter = createReporter();

  await section('Lease create tenant invite', async () => {
    const staffToken = await login(STAFF_EMAIL, MANAGER_PW || PW);
    reporter.ok('staff can log in');

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
