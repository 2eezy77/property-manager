/**
 * Monthly house-cover allocation for utilities.
 * Pure functions — no DB.
 *
 * For a property with utility_house_cover_per_tenant > 0:
 * cover = rate × active leases overlapping the billing month
 * tenant pool = max(0, combined bills − cover), pro-rated onto each bill.
 */

function billingMonthKey(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date && !Number.isNaN(dateStr.getTime())) {
    return dateStr.toISOString().slice(0, 7);
  }
  const s = String(dateStr);
  // ISO / YYYY-MM-DD…
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 7);
  return null;
}

/**
 * Dominion / provider cycles key house-cover month off period_end (statement
 * month), not period_start — mid-month electric must pool with August siblings.
 */
function coverBillingMonthFromBill(bill) {
  if (!bill) return null;
  return billingMonthKey(bill.period_end || bill.period_start || bill.created_at);
}

function monthBounds(yearMonth) {
  const [y, m] = String(yearMonth).split('-').map(Number);
  if (!y || !m) return null;
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function dayOnly(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

/** Lease overlaps calendar month if start <= monthEnd AND end >= monthStart. */
function leasesOverlapMonth(lease, yearMonth) {
  const bounds = monthBounds(yearMonth);
  if (!bounds) return false;
  const ls = dayOnly(lease.start_date);
  const le = dayOnly(lease.end_date) || '9999-12-31';
  if (!ls) return false;
  return ls <= bounds.end && le >= bounds.start;
}

function countActiveLeasesForMonth(leases, yearMonth) {
  return (leases || []).filter((l) => leasesOverlapMonth(l, yearMonth)).length;
}

/**
 * Pro-rate monthly house cover across bills.
 * Amounts are dollars (number). Cent-safe via integer cents; remainder on last bill.
 */
function allocateMonthlyHouseCover({
  bills,
  coverPerTenant,
  activeLeaseCount,
  getAmount,
}) {
  const list = Array.isArray(bills) ? bills : [];
  const amounts = list.map((b) => {
    const raw = Number(getAmount(b));
    const cents = Number.isFinite(raw) ? Math.round(raw * 100) : 0;
    return { id: b.id, cents: Math.max(0, cents) };
  });

  const combinedCents = amounts.reduce((s, a) => s + a.cents, 0);
  const rate = Math.max(0, Number(coverPerTenant) || 0);
  const n = Math.max(0, Number(activeLeaseCount) || 0);
  const coverCents = Math.round(rate * 100) * n;
  const appliedCoverCents = Math.min(coverCents, combinedCents);
  const tenantPoolCents = Math.max(0, combinedCents - appliedCoverCents);

  const byBillId = {};
  if (!amounts.length) {
    return {
      combined: combinedCents / 100,
      coverTotal: coverCents / 100,
      tenantPool: tenantPoolCents / 100,
      byBillId,
    };
  }

  if (combinedCents === 0) {
    for (const a of amounts) {
      byBillId[a.id] = { houseCoverApplied: 0, tenantPoolAmount: 0 };
    }
  } else {
    let allocatedPool = 0;
    let allocatedCover = 0;
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i];
      const isLast = i === amounts.length - 1;
      let poolCents;
      let coverShareCents;
      if (isLast) {
        poolCents = tenantPoolCents - allocatedPool;
        coverShareCents = appliedCoverCents - allocatedCover;
      } else {
        poolCents = Math.floor((tenantPoolCents * a.cents) / combinedCents);
        coverShareCents = Math.floor((appliedCoverCents * a.cents) / combinedCents);
        allocatedPool += poolCents;
        allocatedCover += coverShareCents;
      }
      byBillId[a.id] = {
        houseCoverApplied: coverShareCents / 100,
        tenantPoolAmount: poolCents / 100,
      };
    }
  }

  return {
    combined: combinedCents / 100,
    coverTotal: coverCents / 100,
    tenantPool: tenantPoolCents / 100,
    byBillId,
  };
}

module.exports = {
  billingMonthKey,
  coverBillingMonthFromBill,
  monthBounds,
  leasesOverlapMonth,
  countActiveLeasesForMonth,
  allocateMonthlyHouseCover,
};
