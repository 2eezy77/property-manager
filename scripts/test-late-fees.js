/**
 * Late payment + late fee smoke test.
 * Usage: npm run test:late-fees
 */
const pool = require('../src/db/client');
const {
  TENANT_PW, MANAGER_PW, createReporter, req, login,
} = require('./lib/test-helpers');

const TENANT = process.env.SMOKE_TEST_TENANT_EMAIL || 'isaiahreese13@outlook.com';
const { ok, fail, printSummary } = createReporter();

async function main() {
  console.log('\n── Late payments & late fees ──\n');

  let mgrToken;
  try {
    mgrToken = await login('konstantinhazlett@yahoo.com', MANAGER_PW);
  } catch (e) {
    console.warn('  (manager login skipped — rate limit?)');
  }

  // 1. Lease config
  const { rows: [lease] } = await pool.query(
    `SELECT l.id, l.tenant_id, l.monthly_rent, l.grace_period_days,
            l.late_fee_type, l.late_fee_amount, l.late_fee_cap,
            u.email, u.first_name, u.last_name
       FROM leases l
       JOIN users u ON u.id = l.tenant_id
      WHERE u.email = $1 AND l.status = 'active'
      LIMIT 1`,
    [TENANT]
  );
  if (!lease) { fail('Find active lease for Isaiah'); process.exit(1); }
  ok(`Lease found — rent $${lease.monthly_rent}, grace ${lease.grace_period_days}d, late fee $${lease.late_fee_amount} (${lease.late_fee_type})`);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const overdueDue = new Date();
  overdueDue.setDate(overdueDue.getDate() - (lease.grace_period_days + 3));
  const overdueDueStr = overdueDue.toISOString().slice(0, 10);

  // Clean prior test rows for this lease/month
  await pool.query(
    `DELETE FROM late_fees WHERE payment_id IN (
       SELECT id FROM payments WHERE lease_id = $1 AND period_start = $2 AND metadata->>'qa_late_fee' = 'true'
     )`,
    [lease.id, monthStart]
  );
  await pool.query(
    `DELETE FROM payments WHERE lease_id = $1 AND period_start = $2 AND metadata->>'qa_late_fee' = 'true'`,
    [lease.id, monthStart]
  );

  // 2. Seed overdue pending rent (source=manual so manager ledger includes it; qa_late_fee for cleanup)
  const { rows: [payment] } = await pool.query(
    `INSERT INTO payments
       (lease_id, tenant_id, amount, currency, status, payment_type,
        period_start, period_end, due_date, metadata)
     VALUES ($1,$2,$3,'USD','pending','rent',$4,$5,$6,'{"qa_late_fee":"true"}'::jsonb)
     RETURNING id, due_date`,
    [lease.id, lease.tenant_id, lease.monthly_rent, monthStart, monthEnd, overdueDueStr]
  );
  ok(`Seeded overdue pending rent (due ${payment.due_date}, status pending)`);

  // 3. Run late fee calculation (same as daily cron)
  const { rows: [calc] } = await pool.query(`SELECT calculate_and_insert_late_fees() AS inserted`);
  Number(calc.inserted) >= 1
    ? ok(`calculate_and_insert_late_fees() inserted ${calc.inserted} fee(s)`)
    : fail('Late fee function', `expected ≥1, got ${calc.inserted}`);

  const { rows: fees } = await pool.query(
    `SELECT id, amount, days_overdue, status FROM late_fees WHERE payment_id = $1`,
    [payment.id]
  );
  fees.length === 1 && Number(fees[0].amount) === Number(lease.late_fee_amount)
    ? ok(`Late fee row: $${fees[0].amount}, ${fees[0].days_overdue}d overdue, status=${fees[0].status}`)
    : fail('Late fee row', JSON.stringify(fees));

  // Idempotent — second run should insert 0
  const { rows: [calc2] } = await pool.query(`SELECT calculate_and_insert_late_fees() AS inserted`);
  Number(calc2.inserted) === 0 ? ok('Late fee calc is idempotent (no duplicate fees)') : fail('Duplicate fees', calc2.inserted);

  // 4. Tenant balance API
  const token = await login(TENANT, TENANT_PW);
  const bal = await req('GET', '/api/payments/balance', null, token);
  if (bal.status !== 200) {
    fail('GET /balance', bal.status);
  } else {
    const lateBal = bal.body.lateFeeBalance;
    const rent = bal.body.lease?.monthlyRent;
    const cp = bal.body.currentPayment;
    lateBal === Number(lease.late_fee_amount)
      ? ok(`Balance API lateFeeBalance = $${lateBal}`)
      : fail('lateFeeBalance', `got ${lateBal}, expected ${lease.late_fee_amount}`);
    cp?.id === payment.id && cp?.status === 'pending'
      ? ok('Balance API shows pending currentPayment for this month')
      : fail('currentPayment', JSON.stringify(cp));
    ok(`Total due would be $${rent + lateBal} (rent + late fees)`);

    const rentBilling = require('../src/services/rent-billing.service');
    const breakdown = await rentBilling.computeChargeBreakdown(pool, lease.id);
    breakdown.totalAmount === rent + lateBal
      ? ok(`Charge breakdown: rent $${breakdown.rentAmount} + fees $${breakdown.lateFeeAmount} = $${breakdown.totalAmount}`)
      : fail('Charge breakdown', JSON.stringify(breakdown));
  }

  // 5. Manager scope + outstanding stats (ledger hides qa_late_fee rows by design)
  if (mgrToken) {
    const mgr = await req('GET', '/api/payments/manager?status=pending', null, mgrToken);
    Number(mgr.body.stats?.outstanding) > 0
      ? ok(`Manager stats outstanding = $${mgr.body.stats.outstanding}`)
      : fail('Manager outstanding stat', JSON.stringify(mgr.body.stats));

    const { rows: [inScope] } = await pool.query(
      `SELECT 1 FROM payments p
         JOIN leases l ON l.id = p.lease_id
         JOIN units un ON un.id = l.unit_id
         JOIN users mgr ON mgr.email = 'konstantinhazlett@yahoo.com'
        WHERE p.id = $1 AND un.property_id = ANY(
          SELECT p2.id FROM properties p2 WHERE p2.org_id = mgr.org_id
        )`,
      [payment.id]
    );
    inScope
      ? ok('Manager org scope includes seeded pending payment')
      : fail('Manager scope', 'payment outside manager org');
  } else {
    console.log('  ○ Manager payment checks skipped (no token)');
  }

  // 6. Simulate rent paid — late fees cleared (webhook logic)
  await pool.query(
    `UPDATE payments SET status = 'succeeded', paid_at = NOW() WHERE id = $1`,
    [payment.id]
  );
  await pool.query(
    `UPDATE late_fees SET status = 'paid', applied_at = NOW()
      WHERE lease_id = $1 AND status IN ('pending','applied')`,
    [lease.id]
  );

  const bal2 = await req('GET', '/api/payments/balance', null, token);
  bal2.body.lateFeeBalance === 0
    ? ok('After rent paid, lateFeeBalance = 0')
    : fail('Late fees not cleared', String(bal2.body.lateFeeBalance));

  // 7. Percent late fee math (isolated)
  const { rows: [pctLease] } = await pool.query(
    `SELECT id, tenant_id, monthly_rent, grace_period_days, late_fee_amount, late_fee_cap
       FROM leases WHERE id = $1`,
    [lease.id]
  );
  await pool.query(`UPDATE leases SET late_fee_type = 'percent', late_fee_amount = 5, late_fee_cap = 50 WHERE id = $1`, [lease.id]);

  await pool.query(`DELETE FROM late_fees WHERE payment_id = $1`, [payment.id]);
  await pool.query(`UPDATE payments SET status = 'pending', paid_at = NULL WHERE id = $1`, [payment.id]);

  await pool.query(`SELECT calculate_and_insert_late_fees()`);
  const { rows: [pctFee] } = await pool.query(`SELECT amount FROM late_fees WHERE payment_id = $1`, [payment.id]);
  const expectedPct = Math.min(Math.round(Number(pctLease.monthly_rent) * 5) / 100, 50);
  Number(pctFee.amount) === expectedPct
    ? ok(`Percent late fee: 5% of $${pctLease.monthly_rent} = $${pctFee.amount} (cap $50)`)
    : fail('Percent fee calc', `got ${pctFee.amount}, expected ${expectedPct}`);

  // Restore lease + cleanup
  await pool.query(
    `UPDATE leases SET late_fee_type = 'flat', late_fee_amount = $2, late_fee_cap = NULL WHERE id = $1`,
    [lease.id, lease.late_fee_amount]
  );
  await pool.query(`DELETE FROM late_fees WHERE payment_id = $1`, [payment.id]);
  await pool.query(`DELETE FROM payments WHERE id = $1`, [payment.id]);
  ok('Cleaned up test payment and fees');

  await pool.end();

  printSummary('LATE FEES TEST');
}

main().catch(e => { console.error(e); process.exit(1); });
