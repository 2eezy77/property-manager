/**
 * Turn off landlord utility house cover on 743 and re-open current cycles
 * so tenants pay their lease share (lease says they handle utilities).
 *
 * - properties.utility_house_cover_per_tenant = 0
 * - Fix Dominion live bill to BillingHistory current charges + real period
 * - Supersede bad Aug water duplicate
 * - Recalc splits with no cover; restore notified status on open shares
 *
 * Dry-run: node scripts/remove-utility-house-cover.js
 * Apply:   APPLY=1 node scripts/remove-utility-house-cover.js
 */
const pool = require('../src/db/client');
const { refreshBillSplitsForBill } = require('../src/use-cases/utilities/domain');
const { periodFromDominionStatement } = require('../src/services/dominion-billing.service');

const PROPERTY_ID = 'cccccccc-0000-0000-0000-000000000001';
const ELECTRIC_BILL = '59ffd78b-5ba8-47fd-a451-aa2c101af0b3';
const WATER_CANONICAL = '8e9b23c7-bcf4-4bca-8a84-11ed1dcd4aac';
const WATER_BAD_AUG = 'd5375e87-08ac-4092-b838-f5af3eee629a';
const APPLY = process.env.APPLY === '1';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [prop] } = await client.query(
      `SELECT id, name, utility_house_cover_per_tenant
         FROM properties WHERE id = $1 FOR UPDATE`,
      [PROPERTY_ID]
    );
    console.log('PROP BEFORE', prop);

    if (APPLY) {
      await client.query(
        `UPDATE properties
            SET utility_house_cover_per_tenant = 0,
                updated_at = NOW()
          WHERE id = $1`,
        [PROPERTY_ID]
      );
    }
    console.log('Cover rate → 0');

    // Dominion: restore BillingHistory truth + clear cover columns
    const period = periodFromDominionStatement({
      statementDate: '2026-07-17',
      billingDays: 30,
    });
    console.log('Electric period', period, 'current charges 293.69');

    // Unfreeze prior cover-era waived $0 rows so month refresh can rewrite amounts.
    async function unfreezeForRecalc(billId) {
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'pending', updated_at = NOW()
          WHERE bill_id = $1
            AND status::text IN ('waived', 'notified', 'failed')
            AND COALESCE(amount, 0) = 0`,
        [billId]
      );
    }

    if (APPLY) {
      const { rows: [elec] } = await client.query(
        `UPDATE utility_bills
            SET period_start = $2::date,
                period_end = $3::date,
                due_date = '2026-08-14',
                chargeable_after = $3::date,
                total_amount = 293.69,
                tenant_charge_amount = 293.69,
                statement_balance = 731.70,
                amount_source = 'current_charges',
                house_cover_applied = 0,
                tenant_pool_amount = 293.69,
                status = 'notified',
                settled_at = NULL,
                notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                  || 'House cover removed — tenants pay full share per lease (owner ended $100/tenant cover).'),
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, status, period_start::text, period_end::text,
                    total_amount, house_cover_applied, tenant_pool_amount`,
        [ELECTRIC_BILL, period.period_start, period.period_end]
      );
      console.log('ELECTRIC UPDATED', elec);
      await unfreezeForRecalc(ELECTRIC_BILL);
      await refreshBillSplitsForBill(client, {
        ...elec,
        property_id: PROPERTY_ID,
        service_type: 'electric',
        period_start: period.period_start,
        period_end: period.period_end,
        tenant_charge_amount: 293.69,
        total_amount: 293.69,
      });
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'notified', updated_at = NOW()
          WHERE bill_id = $1 AND status IN ('pending','waived','failed')`,
        [ELECTRIC_BILL]
      );
    }

    // Canonical water (Jun 6 – Jul 9): reopen for tenant pay without cover
    if (APPLY) {
      const { rows: [water] } = await client.query(
        `UPDATE utility_bills
            SET period_start = '2026-06-06',
                period_end = '2026-07-09',
                due_date = '2026-08-04',
                chargeable_after = '2026-07-09',
                house_cover_applied = 0,
                tenant_pool_amount = total_amount,
                status = 'notified',
                settled_at = NULL,
                notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                  || 'House cover removed — tenants pay full water share per lease.'),
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, status, total_amount, house_cover_applied, tenant_pool_amount,
                    period_start::text, period_end::text`,
        [WATER_CANONICAL]
      );
      console.log('WATER UPDATED', water);
      await unfreezeForRecalc(WATER_CANONICAL);
      await refreshBillSplitsForBill(client, {
        ...water,
        property_id: PROPERTY_ID,
        service_type: 'water',
        period_start: '2026-06-06',
        period_end: '2026-07-09',
        tenant_charge_amount: water.total_amount,
        total_amount: water.total_amount,
      });
      await client.query(
        `UPDATE utility_bill_splits
            SET status = 'notified', updated_at = NOW()
          WHERE bill_id = $1 AND status IN ('pending','waived','failed')`,
        [WATER_CANONICAL]
      );
    }

    // Kill bad Aug water duplicate again
    if (APPLY) {
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
                house_cover_applied = 0,
                tenant_pool_amount = 0,
                notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n'
                  || 'Resolved — duplicate of canonical water cycle 8e9b23c7; house cover off.'),
                updated_at = NOW()
          WHERE id = $1`,
        [WATER_BAD_AUG]
      );
      console.log('Bad Aug water duplicate settled');
    }

    // Month refresh rewrites sibling bills as pending — mark current open shares notified once at end.
    if (APPLY) {
      await client.query(
        `UPDATE utility_bill_splits s
            SET status = 'notified', updated_at = NOW()
           FROM utility_bills ub
          WHERE s.bill_id = ub.id
            AND ub.id IN ($1::uuid, $2::uuid)
            AND s.status = 'pending'
            AND s.amount > 0`,
        [ELECTRIC_BILL, WATER_CANONICAL]
      );
    }

    const { rows: open } = await client.query(
      `SELECT ub.id, ub.service_type, ub.status, ub.period_start::text, ub.period_end::text,
              ub.total_amount, ub.house_cover_applied, ub.tenant_pool_amount,
              json_agg(json_build_object('tenant', u.first_name, 'amount', s.amount, 'status', s.status)
                       ORDER BY u.first_name) AS splits
         FROM utility_bills ub
         JOIN utility_bill_splits s ON s.bill_id = ub.id
         JOIN users u ON u.id = s.tenant_id
        WHERE ub.property_id = $1
          AND ub.status::text IN ('draft','notified','charging')
        GROUP BY ub.id
        ORDER BY ub.period_end DESC, ub.service_type`,
      [PROPERTY_ID]
    );
    console.log('OPEN AFTER', JSON.stringify(open, null, 2));

    const { rows: [propAfter] } = await client.query(
      `SELECT utility_house_cover_per_tenant FROM properties WHERE id = $1`,
      [PROPERTY_ID]
    );
    console.log('PROP AFTER', propAfter);

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
