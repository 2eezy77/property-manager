/**
 * Recalculate open utility bill splits (lease-day proration) + latest-bill-only policy.
 */

const pool = require('../../db/client');
const { accessiblePropertyIds } = require('./access');
const {
  refreshBillSplitsForBill,
  getBillSplitAmount,
} = require('./domain');
const { enforceLatestCollectible } = require('./enforce-latest-collectible');

async function executeRecalculateSplits({ userId, role }) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) {
    return { bills_updated: 0, bills: [], collectible_policy: null };
  }

  const client = await pool.connect();
  const billsOut = [];

  try {
    const { rows: bills } = await client.query(
      `SELECT ub.*
         FROM utility_bills ub
        WHERE ub.property_id = ANY($1::uuid[])
          AND ub.status IN ('draft', 'notified', 'charging')
        ORDER BY ub.period_end DESC`,
      [propIds]
    );

    for (const bill of bills) {
      const { splits: computed } = await refreshBillSplitsForBill(client, bill);
      const splitAmount = getBillSplitAmount(bill);

      const tenantRows = [];
      for (const s of computed) {
        const { rows: [u] } = await client.query(
          `SELECT first_name, last_name FROM users WHERE id = $1`,
          [s.tenantId]
        );
        tenantRows.push({
          tenant_id: s.tenantId,
          name: `${u?.first_name || ''} ${u?.last_name || ''}`.trim(),
          amount: s.amount,
          occupancy_days: s.occupancyDays,
          bill_days: s.billDays,
          prorated: s.prorated,
          effective_start: s.effectiveStart,
          effective_end: s.effectiveEnd,
        });
      }

      billsOut.push({
        bill_id: bill.id,
        service_type: bill.service_type,
        period_start: bill.period_start,
        period_end: bill.period_end,
        total_amount: bill.total_amount,
        tenant_charge_amount: splitAmount,
        status: bill.status,
        tenants: tenantRows,
      });
    }

    const policy = { groups: 0, settled_older: 0, splits_waived: 0, latest_reopened: 0 };
    for (const id of propIds) {
      const s = await enforceLatestCollectible(client, { propertyId: id });
      policy.groups += s.groups;
      policy.settled_older += s.settled_older;
      policy.splits_waived += s.splits_waived;
      policy.latest_reopened += s.latest_reopened;
    }

    return {
      bills_updated: billsOut.length,
      bills: billsOut,
      collectible_policy: policy,
    };
  } finally {
    client.release();
  }
}

module.exports = { executeRecalculateSplits };
