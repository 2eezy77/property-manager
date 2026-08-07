/**
 * Correct the live HRSD / Norfolk water bill period to match the provider portal:
 *   Billing Period: 06/06/2026 - 07/09/2026
 *   Due: 08/04/2026
 *   Amount: $165.74
 *
 * Dry-run: node scripts/fix-water-billing-period.js
 * Apply:   APPLY=1 node scripts/fix-water-billing-period.js
 */
const pool = require('../src/db/client');
const { refreshBillSplitsForBill } = require('../src/use-cases/utilities/domain');

const BILL_ID = '8e9b23c7-bcf4-4bca-8a84-11ed1dcd4aac';
const APPLY = process.env.APPLY === '1';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [bill] } = await client.query(
      `SELECT id, service_type, status, period_start::text, period_end::text,
              due_date::text, total_amount, chargeable_after::text, notes, property_id
         FROM utility_bills WHERE id = $1 FOR UPDATE`,
      [BILL_ID]
    );
    if (!bill) throw new Error(`Bill ${BILL_ID} not found`);
    console.log('BEFORE', bill);

    const noteLine = 'Period corrected from provider portal: 06/06/2026 – 07/09/2026, due 08/04/2026 (was wrongly Aug 1–31).';
    if (APPLY) {
      const { rows: [updated] } = await client.query(
        `UPDATE utility_bills
            SET period_start = '2026-06-06',
                period_end = '2026-07-09',
                due_date = '2026-08-04',
                chargeable_after = '2026-07-09',
                notes = CASE
                  WHEN notes ILIKE '%Period corrected from provider portal%' THEN notes
                  ELSE trim(both E'\\n' from coalesce(notes,'') || E'\\n' || $2)
                END,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, period_start::text, period_end::text, due_date::text,
                    chargeable_after::text, status, total_amount`,
        [BILL_ID, noteLine]
      );
      console.log('UPDATED', updated);
      await refreshBillSplitsForBill(client, { ...bill, ...updated, property_id: bill.property_id });
      // Also refresh prior wrong August month so stale cover isn't left hanging
      const { refreshPropertyMonthSplits } = require('../src/use-cases/utilities/domain');
      if (typeof refreshPropertyMonthSplits === 'function') {
        await refreshPropertyMonthSplits(client, {
          propertyId: bill.property_id,
          yearMonth: '2026-08',
        });
      }
    }

    const { rows: [after] } = await client.query(
      `SELECT id, period_start::text, period_end::text, due_date::text,
              chargeable_after::text, house_cover_applied, tenant_pool_amount, status
         FROM utility_bills WHERE id = $1`,
      [BILL_ID]
    );
    console.log('AFTER', after);

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
