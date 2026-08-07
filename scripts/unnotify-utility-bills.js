#!/usr/bin/env node
/**
 * Pull open utility bills back to draft and clear tenant utility notifications.
 * Use when auto-notify fired before owner green-light.
 *
 * Dry-run default. APPLY=1 to write.
 */
require('../src/config/env');
const pool = require('../src/db/client');

const APPLY = process.env.APPLY === '1';
const PROPERTY_ID = process.env.PROPERTY_ID || 'cccccccc-0000-0000-0000-000000000001';
const ELECTRIC_ID = '59ffd78b-5ba8-47fd-a451-aa2c101af0b3';
const WATER_CANONICAL = '8e9b23c7-bcf4-4bca-8a84-11ed1dcd4aac';
const WATER_BAD_AUG = 'd5375e87-08ac-4092-b838-f5af3eee629a';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Mode:', APPLY ? 'APPLY' : 'DRY RUN');

    const { rows: open } = await client.query(
      `SELECT id, service_type, status, period_start::text, period_end::text, total_amount
         FROM utility_bills
        WHERE property_id = $1
          AND status::text IN ('notified', 'charging', 'draft')
        ORDER BY service_type, period_end DESC`,
      [PROPERTY_ID]
    );
    console.log('Open before:', open);

    if (APPLY) {
      // Electric: hold as draft (amounts stay; no tenant notify)
      await client.query(
        `UPDATE utility_bills
            SET status = 'draft',
                notified_at = NULL,
                dispute_deadline_at = NULL,
                notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                  || 'Notify held — owner paused auto-notify (awaiting green light).'),
                updated_at = NOW()
          WHERE id = $1`,
        [ELECTRIC_ID]
      );
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'pending', updated_at = NOW()
          WHERE bill_id = $1
            AND status::text IN ('notified', 'pending', 'failed')
            AND amount > 0`,
        [ELECTRIC_ID]
      );

      // Bad Aug water duplicate: settle again (do not leave notified)
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'waived', amount = 0, updated_at = NOW()
          WHERE bill_id = $1`,
        [WATER_BAD_AUG]
      );
      await client.query(
        `UPDATE utility_bills
            SET status = 'settled',
                settled_at = COALESCE(settled_at, NOW()),
                notified_at = NULL,
                dispute_deadline_at = NULL,
                tenant_pool_amount = 0,
                notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                  || 'Settled duplicate Aug calendar cycle — notify undone; canonical is 8e9b23c7.'),
                updated_at = NOW()
          WHERE id = $1`,
        [WATER_BAD_AUG]
      );

      // Canonical water: reopen as draft (not notified)
      await client.query(
        `UPDATE utility_bills
            SET status = 'draft',
                settled_at = NULL,
                notified_at = NULL,
                dispute_deadline_at = NULL,
                period_start = '2026-06-06',
                period_end = '2026-07-09',
                due_date = '2026-08-04',
                house_cover_applied = 0,
                tenant_pool_amount = total_amount,
                notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                  || 'Reopened as draft — notify held pending owner green light.'),
                updated_at = NOW()
          WHERE id = $1`,
        [WATER_CANONICAL]
      );
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'pending', updated_at = NOW()
          WHERE bill_id = $1 AND amount > 0`,
        [WATER_CANONICAL]
      );

      // Hide recent in-app utility_bill notifications for this property
      const { rowCount: hidden } = await client.query(
        `UPDATE notifications n
            SET read_at = COALESCE(read_at, NOW())
           FROM utility_bill_splits s
           JOIN utility_bills ub ON ub.id = s.bill_id
          WHERE n.related_entity_id = s.id
            AND n.type = 'utility_bill'
            AND ub.property_id = $1
            AND n.created_at > NOW() - INTERVAL '30 days'
            AND n.read_at IS NULL`,
        [PROPERTY_ID]
      );
      console.log('Marked utility notifications read:', hidden);
    }

    const { rows: after } = await client.query(
      `SELECT id, service_type, status, period_start::text, period_end::text, total_amount
         FROM utility_bills
        WHERE id = ANY($1::uuid[])
        ORDER BY service_type`,
      [[ELECTRIC_ID, WATER_CANONICAL, WATER_BAD_AUG]]
    );
    console.log('Target bills after:', after);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('Committed — tenants will not see these as notified.');
    } else {
      await client.query('ROLLBACK');
      console.log('Dry-run only. Re-run with APPLY=1.');
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
