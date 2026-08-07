/**
 * UC10 — Combine draft utility bills into one row per property + service + calendar month.
 *
 * IMPORTANT: Do NOT snap provider-parsed service periods (HRSD mid-month, Dominion
 * statement cycles) to calendar month bounds. Only snap when every draft in the
 * group already looks like a calendar-month default.
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
const {
  dayOnly,
  isCalendarMonthPeriod,
  groupHasProviderPeriod,
} = require('./period-utils');

/** Prefer trusted electric Current Charges over Amount Due fallbacks when merging. */
function pickMergeAmount(bills) {
  const electricTrusted = bills.filter(
    (b) => b.service_type === 'electric' && b.amount_source === 'current_charges'
  );
  const poolBills = electricTrusted.length ? electricTrusted : bills;
  return Math.max(...poolBills.map((b) => Number(b.tenant_charge_amount ?? b.total_amount) || 0));
}

/** Prefer a bill that carries a real provider period as keeper. */
function sortKeeperFirst(bills) {
  return [...bills].sort((a, b) => {
    const aProv = !isCalendarMonthPeriod(a.period_start, a.period_end) ? 1 : 0;
    const bProv = !isCalendarMonthPeriod(b.period_start, b.period_end) ? 1 : 0;
    if (bProv !== aProv) return bProv - aProv;
    const aTrusted = a.amount_source === 'current_charges' ? 1 : 0;
    const bTrusted = b.amount_source === 'current_charges' ? 1 : 0;
    if (bTrusted !== aTrusted) return bTrusted - aTrusted;
    const amt = Number(b.total_amount) - Number(a.total_amount);
    if (amt !== 0) return amt;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

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
      const preserveProvider = groupHasProviderPeriod(bills);

      if (bills.length > 1) {
        const ordered = sortKeeperFirst(bills);
        const keeper = ordered[0];
        const others = ordered.slice(1);

        let total = pickMergeAmount(ordered);
        let periodStart = dayOnly(keeper.period_start);
        let periodEnd = dayOnly(keeper.period_end);
        let dueDate = dayOnly(keeper.due_date);
        const noteParts = [keeper.notes];

        for (const o of others) {
          periodStart = minDate(periodStart, dayOnly(o.period_start));
          periodEnd = maxDate(periodEnd, dayOnly(o.period_end));
          dueDate = maxDate(dueDate, dayOnly(o.due_date));
          if (o.notes) noteParts.push(o.notes);
          removed += 1;
        }

        const writeStart = preserveProvider ? periodStart : bounds.start;
        const writeEnd = preserveProvider ? periodEnd : bounds.end;

        noteParts.push(
          preserveProvider
            ? `(Combined ${bills.length} Gmail imports; preserved provider service period for ${monthLabel(ym)}.)`
            : `(Combined ${bills.length} Gmail imports into ${monthLabel(ym)} bill.)`
        );

        const { rows: [updated] } = await client.query(
          `UPDATE utility_bills
              SET total_amount = $1,
                  tenant_charge_amount = COALESCE(tenant_charge_amount, $1),
                  period_start = $2,
                  period_end = $3,
                  due_date = $4,
                  notes = $5,
                  updated_at = NOW()
            WHERE id = $6
            RETURNING *`,
          [total, writeStart, writeEnd, dueDate, noteParts.filter(Boolean).join('\n'), keeper.id]
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
          preserved_provider_period: preserveProvider,
        });
      } else {
        const [bill] = bills;
        if (preserveProvider) {
          continue;
        }
        const start = dayOnly(bill.period_start);
        const end = dayOnly(bill.period_end);
        const needsNorm = start !== bounds.start || end !== bounds.end;
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

module.exports = {
  executeCombineMonthlyDrafts,
  isCalendarMonthPeriod,
  groupHasProviderPeriod,
};
