#!/usr/bin/env node
/**
 * Upsert pending security deposit for a tenant.
 *   node scripts/upsert-security-deposit.js <email> <amount> <due-date YYYY-MM-DD>
 */
require('../src/config/env');
const pool = require('../src/db/client');

async function main() {
  const email = process.argv[2];
  const amount = parseFloat(process.argv[3]);
  const dueDate = process.argv[4];
  if (!email || !Number.isFinite(amount) || !dueDate) {
    console.error('Usage: node scripts/upsert-security-deposit.js <email> <amount> <due-date>');
    process.exit(1);
  }

  const periodStart = `${dueDate.slice(0, 7)}-01`;
  const periodEnd = dueDate;

  const { rows: [t] } = await pool.query(
    `SELECT u.id AS tenant_id, l.id AS lease_id
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
      WHERE LOWER(u.email) = LOWER($1)`,
    [email]
  );
  if (!t) {
    console.error(`No active lease for ${email}`);
    process.exit(1);
  }

  await pool.query(
    `UPDATE leases SET security_deposit = $1, updated_at = NOW() WHERE id = $2`,
    [amount, t.lease_id]
  );

  const { rows: existing } = await pool.query(
    `SELECT id, status FROM payments
      WHERE lease_id = $1 AND payment_type = 'security_deposit'
        AND status IN ('pending','processing','succeeded')
      ORDER BY created_at DESC LIMIT 1`,
    [t.lease_id]
  );

  if (existing[0]?.status === 'succeeded') {
    console.log(`Already paid (payment ${existing[0].id})`);
    await pool.end();
    return;
  }

  let paymentId;
  if (existing[0]) {
    const { rows: [u] } = await pool.query(
      `UPDATE payments
          SET amount = $1, due_date = $2::date, period_start = $3::date, period_end = $4::date,
              status = 'pending', updated_at = NOW()
        WHERE id = $5 RETURNING id`,
      [amount, dueDate, periodStart, periodEnd, existing[0].id]
    );
    paymentId = u.id;
  } else {
    const { rows: [ins] } = await pool.query(
      `INSERT INTO payments (lease_id, tenant_id, amount, currency, status, payment_type,
         period_start, period_end, due_date, metadata)
       VALUES ($1,$2,$3,'USD','pending','security_deposit',$4::date,$5::date,$6::date,$7)
       RETURNING id`,
      [t.lease_id, t.tenant_id, amount, periodStart, periodEnd, dueDate,
        JSON.stringify({ description: 'Security deposit' })]
    );
    paymentId = ins.id;
  }

  console.log(`Lease ${t.lease_id}: security deposit $${amount} due ${dueDate} (payment ${paymentId})`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
