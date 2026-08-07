/**
 * Reconcile Dominion BillingHistory export vs live electric bills for 743.
 *
 * Latest statement (2026-07-17):
 *   Current Charges $293.69  ← tenant collectible
 *   Total Account Balance $731.70 ← NOT tenant charge (was wrongly used)
 *   Billing days 30 → period 2026-06-18 – 2026-07-17, due 2026-08-14
 *
 * Dry-run: node scripts/reconcile-dominion-billing-history.js
 * Apply:   APPLY=1 node scripts/reconcile-dominion-billing-history.js
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/client');
const { refreshBillSplitsForBill } = require('../src/use-cases/utilities/domain');

const LIVE_BILL = '59ffd78b-5ba8-47fd-a451-aa2c101af0b3';
const APPLY = process.env.APPLY === '1';

function loadLatestStatement() {
  const csvPath = path.join(__dirname, '../archive/utilities/dominion-billing-history.csv');
  const [header, ...lines] = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  const row = lines[0].split(',');
  const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  return {
    statementDate: obj.statement_date,
    dueDate: obj.due_date,
    billingDays: Number(obj.billing_days),
    currentCharges: Number(obj.current_charges),
    accountBalance: Number(obj.total_account_balance),
    periodStart: obj.period_start,
    periodEnd: obj.period_end,
  };
}

async function main() {
  const stmt = loadLatestStatement();
  console.log('LATEST STATEMENT', stmt);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [bill] } = await client.query(
      `SELECT * FROM utility_bills WHERE id = $1 FOR UPDATE`,
      [LIVE_BILL]
    );
    if (!bill) throw new Error(`Bill ${LIVE_BILL} not found`);
    console.log('BEFORE', {
      id: bill.id,
      status: bill.status,
      period_start: bill.period_start,
      period_end: bill.period_end,
      due_date: bill.due_date,
      total_amount: bill.total_amount,
      tenant_charge_amount: bill.tenant_charge_amount,
      statement_balance: bill.statement_balance,
      amount_source: bill.amount_source,
      house_cover_applied: bill.house_cover_applied,
      tenant_pool_amount: bill.tenant_pool_amount,
    });

    const note =
      `Dominion BillingHistory reconcile: current charges $${stmt.currentCharges.toFixed(2)} `
      + `(was wrongly using account balance $${stmt.accountBalance.toFixed(2)}); `
      + `service period ${stmt.periodStart}–${stmt.periodEnd} `
      + `(${stmt.billingDays} billing days; statement ${stmt.statementDate}); due ${stmt.dueDate}.`;

    if (APPLY) {
      const { rows: [updated] } = await client.query(
        `UPDATE utility_bills
            SET period_start = $2::date,
                period_end = $3::date,
                due_date = $4::date,
                chargeable_after = $3::date,
                total_amount = $5,
                tenant_charge_amount = $5,
                statement_balance = $6,
                amount_source = 'current_charges',
                notes = CASE
                  WHEN notes ILIKE '%Dominion BillingHistory reconcile%' THEN notes
                  ELSE trim(both E'\\n' from coalesce(notes,'') || E'\\n' || $7)
                END,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [
          LIVE_BILL,
          stmt.periodStart,
          stmt.periodEnd,
          stmt.dueDate,
          stmt.currentCharges,
          stmt.accountBalance,
          note,
        ]
      );

      await refreshBillSplitsForBill(client, updated);

      // $0 tenant pool after house cover → waive open splits; keep bill notified/settled cleanly
      const { rows: [fresh] } = await client.query(
        `SELECT id, status, tenant_pool_amount, house_cover_applied,
                period_start::text, period_end::text, due_date::text,
                total_amount, tenant_charge_amount, amount_source
           FROM utility_bills WHERE id = $1`,
        [LIVE_BILL]
      );
      console.log('AFTER AMOUNTS', fresh);

      if (Number(fresh.tenant_pool_amount || 0) <= 0.009) {
        await client.query(
          `UPDATE utility_bill_splits
              SET status = 'waived',
                  amount = 0,
                  updated_at = NOW()
            WHERE bill_id = $1
              AND status::text IN ('pending','notified','failed','charging')`,
          [LIVE_BILL]
        );
        await client.query(
          `UPDATE utility_bills
              SET status = 'settled',
                  settled_at = COALESCE(settled_at, NOW()),
                  notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                    || 'Settled — current charges fully covered by house cover after BillingHistory reconcile.'),
                  updated_at = NOW()
            WHERE id = $1 AND status <> 'settled'`,
          [LIVE_BILL]
        );
      } else if (fresh.status === 'notified') {
        await client.query(
          `UPDATE utility_bill_splits
              SET status = 'notified', updated_at = NOW()
            WHERE bill_id = $1 AND status = 'pending'`,
          [LIVE_BILL]
        );
      }

      const splits = await client.query(
        `SELECT u.first_name, s.amount, s.status
           FROM utility_bill_splits s
           JOIN users u ON u.id = s.tenant_id
          WHERE s.bill_id = $1
          ORDER BY u.first_name`,
        [LIVE_BILL]
      );
      console.log('SPLITS', splits.rows);
    } else {
      console.log('Would set current charges', stmt.currentCharges, 'period', stmt.periodStart, '→', stmt.periodEnd);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log('APPLY=1 committed');
    } else {
      await client.query('ROLLBACK');
      console.log('Dry-run only (ROLLBACK). Re-run with APPLY=1 to commit.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
