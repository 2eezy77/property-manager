/**
 * Reconcile HRSD PaymentHistory export vs live water bills for 743.
 *
 * - Supersede the bad Aug 1–31 notified duplicate of the $165.74 cycle
 * - Keep canonical bill 8e9b23c7 (Jun 6 – Jul 9, due Aug 4)
 * - Annotate settled water bills that match owner payment amounts/dates
 *
 * Dry-run: node scripts/reconcile-hrsd-payment-history.js
 * Apply:   APPLY=1 node scripts/reconcile-hrsd-payment-history.js
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/client');

const PROPERTY_ID = 'cccccccc-0000-0000-0000-000000000001';
const CANONICAL_BILL = '8e9b23c7-bcf4-4bca-8a84-11ed1dcd4aac';
const BAD_AUG_DUP = 'd5375e87-08ac-4092-b838-f5af3eee629a';
const APPLY = process.env.APPLY === '1';

function loadPayments() {
  const csvPath = path.join(__dirname, '../archive/utilities/hrsd-3491396160-payment-history.csv');
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('Account')) break;
    const [dateRaw, amountRaw, source, conf, status] = line.split(',');
    if (!dateRaw || !amountRaw) continue;
    const amount = Math.abs(Number(amountRaw));
    const paidAt = dateRaw.slice(0, 10);
    if (!Number.isFinite(amount) || amount < 1) continue;
    rows.push({
      paidAt,
      amount,
      source: source || null,
      confirmationId: conf || null,
      status: status || null,
    });
  }
  return rows;
}

async function main() {
  const payments = loadPayments();
  console.log('HRSD payments loaded:', payments.length);
  console.log('Latest:', payments[payments.length - 1]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [canonical] } = await client.query(
      `SELECT id, status, period_start::text, period_end::text, due_date::text, total_amount
         FROM utility_bills WHERE id = $1`,
      [CANONICAL_BILL]
    );
    console.log('CANONICAL', canonical);

    const { rows: [bad] } = await client.query(
      `SELECT id, status, period_start::text, period_end::text, due_date::text, total_amount
         FROM utility_bills WHERE id = $1 FOR UPDATE`,
      [BAD_AUG_DUP]
    );
    console.log('BAD_AUG_DUP', bad);

    if (bad && bad.status !== 'settled') {
      const note = `Resolved — duplicate of canonical HRSD cycle ${CANONICAL_BILL} (portal period 06/06/2026–07/09/2026). Superseded from owner PaymentHistory reconcile.`;
      console.log('Will settle bad August duplicate');
      if (APPLY) {
        await client.query(
          `UPDATE utility_bill_splits
              SET status = 'waived', updated_at = NOW()
            WHERE bill_id = $1 AND status IN ('pending','notified','failed','charging')`,
          [BAD_AUG_DUP]
        );
        await client.query(
          `UPDATE utility_bills
              SET status = 'settled',
                  settled_at = COALESCE(settled_at, NOW()),
                  notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n' || $2),
                  updated_at = NOW()
            WHERE id = $1`,
          [BAD_AUG_DUP, note]
        );
      }
    } else {
      console.log('Bad August duplicate already settled or missing');
    }

    // Annotate exact amount matches (recent) with owner payment confirmation
    for (const p of payments.slice(-8)) {
      const { rows } = await client.query(
        `SELECT id, total_amount::numeric, period_start::text, period_end::text, status, notes
           FROM utility_bills
          WHERE property_id = $1
            AND service_type = 'water'
            AND provider_name ILIKE '%HRSD%'
            AND ABS(total_amount::numeric - $2::numeric) < 0.011
            AND period_end::date <= ($3::date + INTERVAL '45 days')
            AND period_end::date >= ($3::date - INTERVAL '75 days')
          ORDER BY ABS(EXTRACT(EPOCH FROM (due_date::timestamp - $3::timestamp))) ASC
          LIMIT 1`,
        [PROPERTY_ID, p.amount, p.paidAt]
      );
      if (!rows[0]) {
        console.log('No bill match for payment', p);
        continue;
      }
      const bill = rows[0];
      if (String(bill.notes || '').includes(`hrsd_owner_payment:${p.confirmationId || p.paidAt}`)) {
        console.log('Already annotated', bill.id, p.amount);
        continue;
      }
      console.log('Annotate', bill.id, bill.total_amount, '← owner paid', p.paidAt, p.amount, p.confirmationId);
      if (APPLY) {
        await client.query(
          `UPDATE utility_bills
              SET notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n' || $2),
                  updated_at = NOW()
            WHERE id = $1`,
          [
            bill.id,
            `Owner paid HRSD ${p.paidAt} $${Number(p.amount).toFixed(2)} via ${p.source || 'card'} (conf ${p.confirmationId || 'n/a'}); hrsd_owner_payment:${p.confirmationId || p.paidAt}`,
          ]
        );
      }
    }

    const { rows: open } = await client.query(
      `SELECT id, status, period_start::text, period_end::text, due_date::text, total_amount
         FROM utility_bills
        WHERE property_id = $1 AND service_type = 'water'
          AND status::text IN ('draft','notified','charging')
        ORDER BY created_at DESC`,
      [PROPERTY_ID]
    );
    console.log('OPEN WATER AFTER', open);

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
