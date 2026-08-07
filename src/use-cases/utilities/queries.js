const pool = require('../../db/client');
const { accessiblePropertyIds } = require('./access');
const {
  billingMonthKey,
  allocateMonthlyHouseCover,
  countActiveLeasesForMonth,
  monthBounds,
} = require('./house-cover');
const { getBillSplitAmount, loadActiveLeases } = require('./domain');

async function fetchBillWithSplits(db, billId) {
  const { rows: bills } = await db.query(
    `SELECT ub.*,
            p.name AS property_name, p.address_line1, p.city, p.state,
            p.utility_house_cover_per_tenant
       FROM utility_bills ub
       JOIN properties p ON p.id = ub.property_id
      WHERE ub.id = $1`,
    [billId]
  );
  if (!bills[0]) return null;

  const { rows: splits } = await db.query(
    `SELECT s.id, s.lease_id, s.tenant_id, s.amount, s.status,
            s.payment_id, s.disputed_at, s.dispute_reason,
            s.waived_at, s.waived_by, s.created_at, s.updated_at,
            u.first_name, u.last_name, u.email,
            un.unit_number,
            ba.id IS NOT NULL AS has_verified_bank,
            ba.account_mask,
            ba.institution_name,
            p.status AS payment_status,
            p.stripe_payment_intent_id,
            p.paid_at,
            p.failure_reason
       FROM utility_bill_splits s
       JOIN users u ON u.id = s.tenant_id
       JOIN leases l ON l.id = s.lease_id
       JOIN units un ON un.id = l.unit_id
       LEFT JOIN bank_accounts ba
              ON ba.user_id = s.tenant_id
             AND ba.is_default = TRUE
             AND ba.status = 'verified'
       LEFT JOIN payments p ON p.id = s.payment_id
      WHERE s.bill_id = $1
      ORDER BY un.unit_number ASC`,
    [billId]
  );

  const bill = bills[0];
  const coverRate = Number(bill.utility_house_cover_per_tenant || 0);
  if (coverRate > 0) {
    const ym = billingMonthKey(bill.period_end || bill.period_start || bill.created_at);
    if (ym) {
      const bounds = monthBounds(ym);
      const { rows: siblings } = await db.query(
        `SELECT *
           FROM utility_bills
          WHERE property_id = $1
            AND to_char(COALESCE(period_end, period_start, created_at), 'YYYY-MM') = $2
            AND status IN ('draft', 'notified', 'charging')
          ORDER BY service_type ASC, created_at ASC`,
        [bill.property_id, ym]
      );
      const leases = await loadActiveLeases(db, bill.property_id, bounds.start, bounds.end);
      const activeCount = countActiveLeasesForMonth(leases, ym);
      const alloc = allocateMonthlyHouseCover({
        bills: siblings,
        coverPerTenant: coverRate,
        activeLeaseCount: activeCount,
        getAmount: getBillSplitAmount,
      });
      bill.month_combined_total = alloc.combined;
      bill.house_cover_total = alloc.coverTotal;
      bill.month_tenant_pool = alloc.tenantPool;
      bill.month_active_tenant_count = activeCount;
    }
  }

  return { bill, splits };
}

async function listBills(userId, role, { status, property_id } = {}) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) return [];

  const conditions = ['ub.property_id = ANY($1)'];
  const params = [propIds];
  if (status) {
    params.push(status);
    conditions.push(`ub.status = $${params.length}`);
  }
  if (property_id) {
    params.push(property_id);
    conditions.push(`ub.property_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT ub.*,
            to_char(ub.period_end, 'YYYY-MM') AS billing_month,
            p.name AS property_name,
            p.address_line1,
            p.city, p.state,
            (SELECT COUNT(*) FROM utility_bill_splits s WHERE s.bill_id = ub.id) AS split_count,
            (SELECT COUNT(*) FROM utility_bill_splits s
              WHERE s.bill_id = ub.id AND s.status = 'paid') AS paid_count,
            (SELECT COUNT(*) FROM utility_bill_splits s
              WHERE s.bill_id = ub.id AND s.status = 'disputed') AS disputed_count
       FROM utility_bills ub
       JOIN properties p ON p.id = ub.property_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ub.period_end DESC, ub.created_at DESC
      LIMIT 200`,
    params
  );
  return rows;
}

async function getBillForStaff(billId, userId, role) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) return null;

  const detail = await fetchBillWithSplits(pool, billId);
  if (!detail || !propIds.includes(detail.bill.property_id)) return null;
  return detail;
}

async function getTenantSplits(tenantId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.amount, s.status, s.dispute_reason, s.disputed_at,
            s.created_at,
            ub.id AS bill_id,
            ub.service_type, ub.provider_name,
            ub.period_start, ub.period_end, ub.due_date,
            ub.dispute_deadline_at, ub.status AS bill_status,
            ub.house_cover_applied, ub.tenant_pool_amount,
            pr.utility_house_cover_per_tenant,
            p.id AS payment_id,
            p.status AS payment_status
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN properties pr ON pr.id = ub.property_id
       LEFT JOIN payments p ON p.id = s.payment_id
      WHERE s.tenant_id = $1
      ORDER BY ub.created_at DESC
      LIMIT 50`,
    [tenantId]
  );
  return rows;
}

async function listBalances(userId, role, { filter = 'owes' } = {}) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) {
    return {
      rows: [],
      totals: {
        open_amount: 0,
        disputed_amount: 0,
        overdue_count: 0,
        paid_amount: 0,
        row_count: 0,
      },
    };
  }

  const filterKey = String(filter || 'owes').toLowerCase();
  const statusFilter = {
    owes: `s.status IN ('notified', 'disputed', 'pending', 'failed')`,
    disputed: `s.status = 'disputed'`,
    charging: `s.status = 'charging'`,
    failed: `s.status = 'failed'`,
    paid: `s.status IN ('paid', 'waived')`,
    all: `TRUE`,
  };
  const statusSql = statusFilter[filterKey] || statusFilter.owes;

  const { rows } = await pool.query(
    `SELECT s.id AS split_id,
            s.tenant_id,
            s.amount,
            s.status AS split_status,
            s.dispute_reason,
            s.disputed_at,
            ub.id AS bill_id,
            ub.service_type,
            ub.period_start,
            ub.period_end,
            ub.status AS bill_status,
            ub.notified_at,
            ub.dispute_deadline_at,
            ub.due_date,
            p.name AS property_name,
            un.unit_number,
            u.first_name,
            u.last_name,
            u.email,
            CASE
              WHEN ub.notified_at IS NULL THEN NULL
              ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ub.notified_at)) / 86400))::int
            END AS days_open
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN properties p ON p.id = ub.property_id
       JOIN leases l ON l.id = s.lease_id
       JOIN units un ON un.id = l.unit_id
       JOIN users u ON u.id = s.tenant_id
      WHERE ub.property_id = ANY($1)
        AND (${statusSql})
      ORDER BY
        CASE s.status
          WHEN 'disputed' THEN 0
          WHEN 'failed' THEN 1
          WHEN 'notified' THEN 2
          WHEN 'pending' THEN 3
          WHEN 'charging' THEN 4
          ELSE 5
        END,
        ub.notified_at ASC NULLS LAST,
        u.last_name ASC`,
    [propIds]
  );

  let openAmount = 0;
  let disputedAmount = 0;
  let overdueCount = 0;
  let paidAmount = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    if (['notified', 'disputed', 'pending', 'failed', 'charging'].includes(r.split_status)) {
      openAmount += amt;
    }
    if (r.split_status === 'disputed') disputedAmount += amt;
    if (
      ['notified', 'disputed', 'failed'].includes(r.split_status)
      && r.days_open != null
      && r.days_open >= 7
    ) {
      overdueCount += 1;
    }
    if (r.split_status === 'paid' || r.split_status === 'waived') {
      paidAmount += amt;
    }
  }

  // Board header totals always reflect open book (not just current filter)
  const { rows: [agg] } = await pool.query(
    `SELECT
        COALESCE(SUM(s.amount) FILTER (
          WHERE s.status IN ('notified', 'disputed', 'pending', 'failed', 'charging')
        ), 0)::numeric AS open_amount,
        COALESCE(SUM(s.amount) FILTER (WHERE s.status = 'disputed'), 0)::numeric AS disputed_amount,
        COUNT(*) FILTER (
          WHERE s.status IN ('notified', 'disputed', 'failed')
            AND ub.notified_at IS NOT NULL
            AND ub.notified_at <= NOW() - INTERVAL '7 days'
        )::int AS overdue_count
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
      WHERE ub.property_id = ANY($1)`,
    [propIds]
  );

  return {
    rows,
    totals: {
      open_amount: Number(agg?.open_amount ?? openAmount),
      disputed_amount: Number(agg?.disputed_amount ?? disputedAmount),
      overdue_count: Number(agg?.overdue_count ?? overdueCount),
      paid_amount: paidAmount,
      row_count: rows.length,
    },
    filter: filterKey,
  };
}

module.exports = {
  fetchBillWithSplits,
  listBills,
  getBillForStaff,
  getTenantSplits,
  listBalances,
};
