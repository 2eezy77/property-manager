#!/usr/bin/env node
/**
 * Send sample payment notification emails (rent due, received, failed).
 *
 *   npm run test:payment-emails
 *
 * Routes all mail to EMAIL_DEV_OVERRIDE (default: josemontero2002@gmail.com).
 * Updates owner login email for testing. Staff alerts: manager To, owner Cc (override).
 *
 * Requires Gmail connected with send scope — reconnect in Manager → Utilities
 * if you previously connected read-only only.
 */

process.env.EMAIL_DEV_OVERRIDE = process.env.EMAIL_DEV_OVERRIDE || 'josemontero2002@gmail.com';

require('../src/config/env');

const pool = require('../src/db/client');
const {
  notifyPaymentReceived,
  notifyPaymentFailed,
  notifyRentDue,
  sendRentDueReminders,
} = require('../src/services/payment-email.service');
const { sendEmail } = require('../src/services/email.service');

const TEST_EMAIL = process.env.EMAIL_DEV_OVERRIDE;
const ISAAC_OLD = 'josemontero2002@gmail.com';
const MANAGER_EMAIL = 'konstantinhazlett@yahoo.com';

let passed = 0;
let failed = 0;

function ok(label) { passed++; console.log(`  ✓ ${label}`); }
function fail(label, detail) { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }

async function ensureTestAccounts() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [isaac] } = await client.query(
      `SELECT id FROM users WHERE email IN ($1, $2) ORDER BY CASE WHEN email = $2 THEN 0 ELSE 1 END LIMIT 1`,
      [ISAAC_OLD, TEST_EMAIL]
    );
    if (isaac) {
      await client.query(
        `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2 AND email <> $1`,
        [TEST_EMAIL, isaac.id]
      );
    }

    await client.query(
      `UPDATE users SET org_id = (SELECT id FROM organizations LIMIT 1), updated_at = NOW()
        WHERE email IN ($1, $2) AND org_id IS NULL`,
      [ISAAC_OLD, MANAGER_EMAIL]
    );

    await client.query('COMMIT');
    ok(`Owner email set to ${TEST_EMAIL} (login + notifications)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getSamplePayment() {
  const { rows } = await pool.query(
    `SELECT p.id, p.tenant_id, p.lease_id, p.amount, p.due_date, p.status,
            pay.org_id
       FROM payments p
       JOIN leases l ON l.id = p.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN properties pay ON pay.id = u.property_id
      WHERE p.payment_type = 'rent'
        AND EXISTS (SELECT 1 FROM gmail_oauth_tokens g WHERE g.org_id = pay.org_id)
      ORDER BY p.created_at DESC
      LIMIT 1`
  );
  if (rows[0]) return rows[0];

  const { rows: fallback } = await pool.query(
    `SELECT p.id, p.tenant_id, p.lease_id, p.amount, p.due_date, p.status,
            pay.org_id
       FROM payments p
       JOIN leases l ON l.id = p.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN properties pay ON pay.id = u.property_id
      WHERE p.payment_type = 'rent'
      ORDER BY p.created_at DESC
      LIMIT 1`
  );
  return fallback[0] || null;
}

async function main() {
  console.log('\nPayment email test');
  console.log(`  Override recipient: ${TEST_EMAIL}\n`);

  try {
    await ensureTestAccounts();
  } catch (err) {
    fail('Update test accounts', err.message);
    process.exit(1);
  }

  const { rows: [conn] } = await pool.query(
    `SELECT gmail_address FROM gmail_oauth_tokens LIMIT 1`
  );
  if (!conn?.gmail_address) {
    fail('Gmail connected', 'Connect Gmail in Manager → Utilities first');
    process.exit(1);
  }
  ok(`Gmail sender: ${conn.gmail_address}`);

  try {
    const ping = await sendEmail({
      orgId: (await pool.query(`SELECT org_id FROM gmail_oauth_tokens LIMIT 1`)).rows[0]?.org_id,
      to: TEST_EMAIL,
      subject: '[PM Test] Email delivery check',
      text: 'If you received this, Gmail send is working for payment notifications.',
    });
    if (ping.sent) ok('Gmail send (ping)');
    else fail('Gmail send (ping)', ping.skipped || 'not sent');
  } catch (err) {
    fail('Gmail send (ping)', err.message);
    if (/insufficient|scope|403|Forbidden/i.test(err.message)) {
      console.log('\n  → Re-authorize Gmail with send permission:');
      console.log('    1. Revoke old access: https://myaccount.google.com/permissions');
      console.log('    2. Log in as owner, open Manager → Utilities → Connect Gmail');
      console.log('       Or run: node scripts/print-gmail-connect-url.js');
      console.log('    3. Approve both read and send scopes, then re-run this test.\n');
      try {
        const http = require('http');
        const login = await new Promise((resolve, reject) => {
          if (!process.env.SMOKE_TEST_PASSWORD) {
            console.log('\n  → Set SMOKE_TEST_PASSWORD to generate a Gmail connect URL.\n');
            process.exit(1);
          }
          const body = JSON.stringify({ email: TEST_EMAIL, password: process.env.SMOKE_TEST_PASSWORD });
          const r = http.request({
            hostname: 'localhost', port: 8080, path: '/auth/login', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          }, (res) => {
            let d = ''; res.on('data', c => { d += c; });
            res.on('end', () => resolve(JSON.parse(d)));
          });
          r.on('error', reject);
          r.write(body);
          r.end();
        });
        if (login.accessToken) {
          const url = await new Promise((resolve, reject) => {
            const r = http.request({
              hostname: 'localhost', port: 8080, path: '/api/utilities/gmail/connect', method: 'GET',
              headers: { Authorization: `Bearer ${login.accessToken}` },
            }, (res) => {
              let d = ''; res.on('data', c => { d += c; });
              res.on('end', () => resolve(JSON.parse(d).url));
            });
            r.on('error', reject);
            r.end();
          });
          if (url) console.log(`  Connect URL:\n  ${url}\n`);
        }
      } catch (_) { /* server may be down */ }
    }
    process.exit(1);
  }

  const sample = await getSamplePayment();
  if (!sample) {
    fail('Sample payment', 'No rent payment rows — run rent billing or seed data first');
    process.exit(1);
  }

  const fakePaymentId = sample.id;

  try {
    const due = await notifyRentDue({
      paymentId: fakePaymentId,
      tenantId: sample.tenant_id,
      leaseId: sample.lease_id,
      amount: sample.amount,
      dueDate: sample.due_date,
    });
    if (due.sent || due.skipped === 'already_sent') ok('Rent due reminder');
    else fail('Rent due reminder', due.skipped);
  } catch (err) {
    fail('Rent due reminder', err.message);
  }

  try {
    const received = await notifyPaymentReceived({
      paymentId: fakePaymentId,
      tenantId: sample.tenant_id,
      leaseId: sample.lease_id,
      amount: sample.amount,
      paymentType: 'rent',
    });
    if (received.sent) ok('Payment received (tenant + staff)');
    else fail('Payment received', received.skipped);
  } catch (err) {
    fail('Payment received', err.message);
  }

  try {
    const failedPay = await notifyPaymentFailed({
      paymentId: fakePaymentId,
      tenantId: sample.tenant_id,
      leaseId: sample.lease_id,
      amount: sample.amount,
      paymentType: 'rent',
      failureReason: 'Test failure — insufficient funds (sandbox)',
    });
    if (failedPay.sent) ok('Payment failed (tenant + staff)');
    else fail('Payment failed', failedPay.skipped);
  } catch (err) {
    fail('Payment failed', err.message);
  }

  try {
    const batch = await sendRentDueReminders();
    ok(`Rent billing batch scan (${batch.dueSent} due, ${batch.overdueSent} overdue new sends)`);
  } catch (err) {
    fail('Rent billing batch', err.message);
  }

  console.log(`\nDone: ${passed} passed, ${failed} failed`);
  console.log(`Check ${TEST_EMAIL} for 3–4 messages from ${conn.gmail_address}.\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
