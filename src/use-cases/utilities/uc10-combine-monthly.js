/**
 * UC10 — Combine draft utility bills into one row per property + service + calendar month.
 */

const pool = require('../../db/client');
const { accessiblePropertyIds } = require('./access');
const {
  billingMonth,
  calendarMonthBounds,
  monthLabel,
  minDate,
  maxDate,
  refreshBillSplits,
} = require('./monthly-billing');

async function executeCombineMonthlyDrafts({ userId, role }) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) {
    return { merged: 0, removed: 0, normalized: 0, bills: [] };
  }

  const { rows: drafts } = await pool.query(
    `SELECT *
       FROM utility_bills
      WHERE status = 'draft'
        AND property_id = ANY($1::uuid[])
      ORDER BY property_id, service_type, period_end, created_at`,
    [propIds]
  );

  const groups = new Map();
  for (const bill of drafts) {
    const ym = billingMonth(bill.period_end);
    if (!ym) continue;
    const key = `${bill.property_id}|${bill.service_type}|${ym}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bill);
  }

  let merged = 0;
  let removed = 0;
  let normalized = 0;
  const summary = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [key, bills] of groups) {
      const ym = key.split('|')[2];
      const bounds = calendarMonthBounds(ym);
      if (!bounds) continue;

      if (bills.length > 1) {
        bills.sort((a, b) => {
          const amt = Number(b.total_amount) - Number(a.total_amount);
          if (amt !== 0) return amt;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        const keeper = bills[0];
        const others = bills.slice(1);

        let total = Number(keeper.total_amount);
        let periodStart = keeper.period_start;
        let periodEnd = keeper.period_end;
        let dueDate = keeper.due_date;
        const noteParts = [keeper.notes];

        for (const o of others) {
          total = Math.max(total, Number(o.total_amount));
          periodStart = minDate(periodStart, o.period_start);
          periodEnd = maxDate(periodEnd, o.period_end);
          dueDate = maxDate(dueDate, o.due_date);
          if (o.notes) noteParts.push(o.notes);
          removed += 1;
        }

        noteParts.push(`(Combined ${bills.length} Gmail imports into ${monthLabel(ym)} bill.)`);

        const { rows: [updated] } = await client.query(
          `UPDATE utility_bills
              SET total_amount = $1,
                  period_start = $2,
                  period_end = $3,
                  due_date = $4,
                  notes = $5,
                  updated_at = NOW()
            WHERE id = $6
            RETURNING *`,
          [total, bounds.start, bounds.end, dueDate, noteParts.filter(Boolean).join('\n'), keeper.id]
        );

        for (const o of others) {
          await client.query('DELETE FROM utility_bills WHERE id = $1', [o.id]);
        }

        await refreshBillSplits(client, updated, total);
        merged += 1;
        summary.push({
          billing_month: ym,
          service_type: keeper.service_type,
          property_id: keeper.property_id,
          combined_count: bills.length,
          total_amount: total,
        });
      } else {
        const [bill] = bills;
        const needsNorm = bill.period_start !== bounds.start || bill.period_end !== bounds.end;
        if (needsNorm) {
          const { rows: [updated] } = await client.query(
            `UPDATE utility_bills
                SET period_start = $1, period_end = $2, updated_at = NOW()
              WHERE id = $3
              RETURNING *`,
            [bounds.start, bounds.end, bill.id]
          );
          await refreshBillSplits(client, updated, Number(updated.total_amount));
          normalized += 1;
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { merged, removed, normalized, bills: summary };
}

module.exports = { executeCombineMonthlyDrafts };
