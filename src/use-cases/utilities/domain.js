/**
 * Domain rules shared by UC01 (manual create) and UC09 (Gmail import).
 */

const {
  billingMonthKey,
  monthBounds,
  countActiveLeasesForMonth,
  allocateMonthlyHouseCover,
} = require('./house-cover');

function dayOnly(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

function parseDay(dateStr) {
  return new Date(`${dayOnly(dateStr)}T12:00:00Z`);
}

/** Inclusive calendar days between two dates. */
function inclusiveDays(periodStart, periodEnd) {
  const a = parseDay(periodStart);
  const b = parseDay(periodEnd);
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Split by days each lease overlaps the bill period (move-in/move-out fair share).
 * Tenants with lease.start_date after period_start only pay from their start date.
 */
function computeOccupancySplits(leases, totalAmount, periodStart, periodEnd) {
  const ps = dayOnly(periodStart);
  const pe = dayOnly(periodEnd);
  const billDays = inclusiveDays(ps, pe);
  if (!billDays) return [];

  const weighted = leases
    .map((l) => {
      const ls = dayOnly(l.start_date);
      const le = dayOnly(l.end_date) || pe;
      const effStart = parseDay(ls) > parseDay(ps) ? ls : ps;
      const effEnd = parseDay(le) < parseDay(pe) ? le : pe;
      const days = inclusiveDays(effStart, effEnd);
      return {
        leaseId: l.id,
        tenantId: l.tenant_id,
        days,
        effStart,
        effEnd,
        prorated: ls > ps || le < pe,
      };
    })
    .filter((w) => w.days > 0);

  const totalWeight = weighted.reduce((s, w) => s + w.days, 0);
  if (!totalWeight) return [];

  const totalCents = Math.round(Number(totalAmount) * 100);
  let allocated = 0;

  return weighted.map((w, i) => {
    let cents;
    if (i === weighted.length - 1) {
      cents = totalCents - allocated;
    } else {
      cents = Math.floor((totalCents * w.days) / totalWeight);
      allocated += cents;
    }
    return {
      leaseId: w.leaseId,
      tenantId: w.tenantId,
      amount: (cents / 100).toFixed(2),
      occupancyDays: w.days,
      billDays,
      prorated: w.prorated,
      effectiveStart: w.effStart,
      effectiveEnd: w.effEnd,
    };
  });
}

/**
 * Split electric bill by unit submeter percent when all active units sum to ~100%.
 */
function computeElectricSplits(leases, unitShares, totalAmount, periodStart, periodEnd) {
  const unitIds = [...new Set(leases.map((l) => l.unit_id).filter(Boolean))];
  if (!unitIds.length) {
    return computeOccupancySplits(leases, totalAmount, periodStart, periodEnd);
  }

  const percents = unitIds.map((uid) => unitShares[uid]);
  const allSet = percents.every((p) => p != null && !Number.isNaN(Number(p)));
  const sum = percents.reduce((s, p) => s + Number(p), 0);

  if (!allSet || Math.abs(sum - 100) > 0.01) {
    return computeOccupancySplits(leases, totalAmount, periodStart, periodEnd);
  }

  const totalCents = Math.round(Number(totalAmount) * 100);
  const byUnit = {};
  let allocated = 0;
  unitIds.forEach((uid, i) => {
    let cents;
    if (i === unitIds.length - 1) {
      cents = totalCents - allocated;
    } else {
      cents = Math.round((totalCents * Number(unitShares[uid])) / 100);
      allocated += cents;
    }
    byUnit[uid] = cents;
  });

  const leasesByUnit = {};
  for (const l of leases) {
    if (!leasesByUnit[l.unit_id]) leasesByUnit[l.unit_id] = [];
    leasesByUnit[l.unit_id].push(l);
  }

  const results = [];
  for (const uid of unitIds) {
    const unitLeases = leasesByUnit[uid] || [];
    const unitCents = byUnit[uid];
    const ps = dayOnly(periodStart);
    const pe = dayOnly(periodEnd);

    const weighted = unitLeases
      .map((l) => {
        const ls = dayOnly(l.start_date);
        const le = dayOnly(l.end_date) || pe;
        const effStart = parseDay(ls) > parseDay(ps) ? ls : ps;
        const effEnd = parseDay(le) < parseDay(pe) ? le : pe;
        const days = inclusiveDays(effStart, effEnd);
        return { leaseId: l.id, tenantId: l.tenant_id, days, effStart, effEnd, prorated: ls > ps || le < pe };
      })
      .filter((w) => w.days > 0);

    const unitWeight = weighted.reduce((s, w) => s + w.days, 0);
    if (!unitWeight) continue;

    let unitAllocated = 0;
    weighted.forEach((w, i) => {
      let cents;
      if (i === weighted.length - 1) {
        cents = unitCents - unitAllocated;
      } else {
        cents = Math.floor((unitCents * w.days) / unitWeight);
        unitAllocated += cents;
      }
      results.push({
        leaseId: w.leaseId,
        tenantId: w.tenantId,
        amount: (cents / 100).toFixed(2),
        occupancyDays: w.days,
        billDays: inclusiveDays(ps, pe),
        prorated: w.prorated,
        effectiveStart: w.effStart,
        effectiveEnd: w.effEnd,
        splitBy: 'electric_share_percent',
      });
    });
  }

  return results.length
    ? results
    : computeOccupancySplits(leases, totalAmount, periodStart, periodEnd);
}

function getBillSplitAmount(bill) {
  if (bill.tenant_charge_amount != null && bill.tenant_charge_amount !== '') {
    return Number(bill.tenant_charge_amount);
  }
  return Number(bill.total_amount);
}

/** @deprecated Use period args for proration; equal split only when dates omitted. */
function computeEqualSplits(leases, totalAmount, periodStart, periodEnd) {
  if (periodStart && periodEnd) {
    return computeOccupancySplits(leases, totalAmount, periodStart, periodEnd);
  }
  const n = leases.length;
  if (n === 0) return [];

  const totalCents = Math.round(Number(totalAmount) * 100);
  const baseCents = Math.floor(totalCents / n);
  const remainder = totalCents - baseCents * n;

  return leases.map((l, i) => {
    const cents = baseCents + (i === n - 1 ? remainder : 0);
    return {
      leaseId: l.id,
      tenantId: l.tenant_id,
      amount: (cents / 100).toFixed(2),
    };
  });
}

function normalizeAcct(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Match full account or suffix (Dominion "ending in 3430", InvoiceCloud PP-1055175). */
function accountsMatch(stored, parsed) {
  const a = normalizeAcct(stored);
  const b = normalizeAcct(parsed);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && (a.endsWith(b) || b.endsWith(a))) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(-4) === b.slice(-4)) return true;
  return false;
}

function matchProperty(properties, parsed) {
  if (!properties.length) return null;
  if (parsed.account_number) {
    const byAcct = properties.find((p) =>
      accountsMatch(p.dominion_account_number, parsed.account_number)
      || accountsMatch(p.norfolk_utilities_account_number, parsed.account_number)
    );
    if (byAcct) return byAcct;
  }
  return properties.length === 1 ? properties[0] : null;
}

async function loadActiveLeases(client, propertyId, periodStart, periodEnd) {
  const { rows } = await client.query(
    `SELECT l.id, l.tenant_id, l.monthly_rent, l.start_date, l.end_date,
            un.id AS unit_id, un.unit_number, un.electric_share_percent,
            u.first_name, u.last_name
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN users u ON u.id = l.tenant_id
      WHERE un.property_id = $1
        AND l.status = 'active'
        AND l.start_date <= $3
        AND l.end_date >= $2
      ORDER BY un.unit_number ASC, l.created_at ASC`,
    [propertyId, periodStart, periodEnd]
  );
  return rows;
}

async function loadUnitElectricShares(client, propertyId) {
  const { rows } = await client.query(
    `SELECT id AS unit_id, electric_share_percent
       FROM units
      WHERE property_id = $1
        AND electric_share_percent IS NOT NULL`,
    [propertyId]
  );
  const map = {};
  for (const r of rows) {
    map[r.unit_id] = Number(r.electric_share_percent);
  }
  return map;
}

async function computeSplitsForBill(client, {
  propertyId,
  service_type,
  leases,
  bill,
  splitAmount,
  period_start,
  period_end,
}) {
  const amount = splitAmount ?? getBillSplitAmount(bill);
  if (service_type === 'electric') {
    const unitShares = await loadUnitElectricShares(client, propertyId);
    return computeElectricSplits(leases, unitShares, amount, period_start, period_end);
  }
  return computeOccupancySplits(leases, amount, period_start, period_end);
}

async function loadPropertyHouseCover(client, propertyId) {
  const { rows } = await client.query(
    `SELECT utility_house_cover_per_tenant FROM properties WHERE id = $1`,
    [propertyId]
  );
  return Number(rows[0]?.utility_house_cover_per_tenant || 0);
}

async function listBillsForPropertyMonth(client, propertyId, yearMonth) {
  // Key the house-cover month by period_end (Dominion/HRSD cycles are mid-month;
  // statement/end date is the cycle's billing month, not period_start).
  const { rows } = await client.query(
    `SELECT *
       FROM utility_bills
      WHERE property_id = $1
        AND to_char(COALESCE(period_end, period_start, created_at), 'YYYY-MM') = $2
        AND status IN ('draft', 'notified', 'charging')
      ORDER BY service_type ASC, created_at ASC`,
    [propertyId, yearMonth]
  );
  return rows;
}

async function billHasFrozenSplits(client, billId) {
  const { rows } = await client.query(
    `SELECT 1 FROM utility_bill_splits
      WHERE bill_id = $1 AND status::text = ANY($2::text[])
      LIMIT 1`,
    [billId, ['paid', 'waived', 'charging']]
  );
  return rows.length > 0;
}

/**
 * Apply monthly house cover across a property-month, then refresh mutable bill splits.
 * Frozen bills (paid/waived/charging splits) keep amounts; cover columns still updated.
 */
async function refreshPropertyMonthSplits(client, { propertyId, yearMonth }) {
  const coverPerTenant = await loadPropertyHouseCover(client, propertyId);
  const bills = await listBillsForPropertyMonth(client, propertyId, yearMonth);
  if (!bills.length) return { billsRefreshed: 0, allocation: null, activeLeaseCount: 0, coverPerTenant };

  const bounds = monthBounds(yearMonth);
  const monthLeases = await loadActiveLeases(client, propertyId, bounds.start, bounds.end);
  const activeLeaseCount = countActiveLeasesForMonth(monthLeases, yearMonth);

  const allocation = allocateMonthlyHouseCover({
    bills,
    coverPerTenant,
    activeLeaseCount,
    getAmount: getBillSplitAmount,
  });

  let refreshed = 0;
  let lastSplits = [];
  let lastLeases = monthLeases;

  for (const bill of bills) {
    const frozen = await billHasFrozenSplits(client, bill.id);
    const alloc = allocation.byBillId[bill.id] || {
      houseCoverApplied: 0,
      tenantPoolAmount: getBillSplitAmount(bill),
    };

    await client.query(
      `UPDATE utility_bills
          SET house_cover_applied = $2,
              tenant_pool_amount = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [bill.id, alloc.houseCoverApplied, alloc.tenantPoolAmount]
    );

    if (frozen) continue;

    const leases = await loadActiveLeases(
      client,
      bill.property_id,
      bill.period_start,
      bill.period_end
    );
    const splitAmount = coverPerTenant > 0 ? alloc.tenantPoolAmount : getBillSplitAmount(bill);
    const splits = await computeSplitsForBill(client, {
      propertyId: bill.property_id,
      service_type: bill.service_type,
      leases,
      bill,
      splitAmount,
      period_start: bill.period_start,
      period_end: bill.period_end,
    });

    await client.query('DELETE FROM utility_bill_splits WHERE bill_id = $1', [bill.id]);
    for (const s of splits) {
      await client.query(
        `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
         VALUES ($1,$2,$3,$4,'pending')`,
        [bill.id, s.leaseId, s.tenantId, s.amount]
      );
    }

    const prorated = splits.filter((s) => s.prorated);
    if (prorated.length) {
      const note = prorated
        .map((s) => `${s.occupancyDays}/${s.billDays} days (${s.effectiveStart}–${s.effectiveEnd})`)
        .join('; ');
      await client.query(
        `UPDATE utility_bills
            SET notes = COALESCE(notes, '') || E'\nProrated splits: ' || $2,
                updated_at = NOW()
          WHERE id = $1
            AND COALESCE(notes, '') NOT LIKE '%Prorated splits:%'`,
        [bill.id, note]
      );
    }

    lastSplits = splits;
    lastLeases = leases;
    refreshed += 1;
  }

  return {
    billsRefreshed: refreshed,
    allocation,
    activeLeaseCount,
    coverPerTenant,
    leases: lastLeases.length,
    splits: lastSplits,
  };
}

async function insertBillWithSplits(client, {
  propertyId,
  createdBy,
  service_type,
  provider_name,
  period_start,
  period_end,
  total_amount,
  due_date,
  notes,
  bill_document_url,
  gmail_message_id,
  tenant_charge_amount,
  statement_balance,
  amount_source,
  chargeable_after,
  amount_pulled_at,
  leases: _leases,
}) {
  const { rows: [bill] } = await client.query(
    `INSERT INTO utility_bills
       (property_id, created_by, service_type, provider_name,
        period_start, period_end, total_amount, due_date,
        notes, bill_document_url, gmail_message_id, status,
        tenant_charge_amount, statement_balance, amount_source,
        chargeable_after, amount_pulled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',
             $12,$13,$14,$15,$16)
     RETURNING *`,
    [
      propertyId,
      createdBy,
      service_type,
      provider_name ?? null,
      period_start,
      period_end,
      total_amount,
      due_date,
      notes ?? null,
      bill_document_url ?? null,
      gmail_message_id ?? null,
      tenant_charge_amount ?? null,
      statement_balance ?? null,
      amount_source ?? null,
      chargeable_after ?? null,
      amount_pulled_at ?? null,
    ]
  );

  const ym = billingMonthKey(period_end || period_start || bill.created_at);
  if (ym) {
    await refreshPropertyMonthSplits(client, { propertyId, yearMonth: ym });
  } else {
    await refreshBillSplitsForBill(client, bill);
  }

  const { rows: [fresh] } = await client.query(`SELECT * FROM utility_bills WHERE id = $1`, [bill.id]);
  return fresh || bill;
}

async function refreshBillSplitsForBill(client, bill, { preserveStatuses: _preserveStatuses = ['paid', 'waived'] } = {}) {
  const ym = billingMonthKey(bill.period_end || bill.period_start || bill.created_at);
  if (ym) {
    await refreshPropertyMonthSplits(client, {
      propertyId: bill.property_id,
      yearMonth: ym,
    });
    const { rows: splitRows } = await client.query(
      `SELECT lease_id AS "leaseId", tenant_id AS "tenantId", amount,
              NULL::int AS "occupancyDays", NULL::int AS "billDays",
              false AS prorated, NULL::text AS "effectiveStart", NULL::text AS "effectiveEnd"
         FROM utility_bill_splits
        WHERE bill_id = $1
        ORDER BY created_at ASC`,
      [bill.id]
    );
    // Re-compute enriched split metadata for recalc UI when possible
    const leases = await loadActiveLeases(
      client,
      bill.property_id,
      bill.period_start,
      bill.period_end
    );
    const { rows: [freshBill] } = await client.query(`SELECT * FROM utility_bills WHERE id = $1`, [bill.id]);
    const splitAmount = freshBill?.tenant_pool_amount != null
      ? Number(freshBill.tenant_pool_amount)
      : getBillSplitAmount(freshBill || bill);
    const computed = await computeSplitsForBill(client, {
      propertyId: bill.property_id,
      service_type: bill.service_type,
      leases,
      bill: freshBill || bill,
      splitAmount,
      period_start: bill.period_start,
      period_end: bill.period_end,
    });
    // Prefer computed metadata when amounts still match pending rows
    const splits = computed.length ? computed : splitRows;
    return { leases: leases.length, splits };
  }

  // Fallback: single-bill path without month key
  const leases = await loadActiveLeases(
    client,
    bill.property_id,
    bill.period_start,
    bill.period_end
  );
  const splits = await computeSplitsForBill(client, {
    propertyId: bill.property_id,
    service_type: bill.service_type,
    leases,
    bill,
    period_start: bill.period_start,
    period_end: bill.period_end,
  });

  await client.query('DELETE FROM utility_bill_splits WHERE bill_id = $1', [bill.id]);
  for (const s of splits) {
    await client.query(
      `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [bill.id, s.leaseId, s.tenantId, s.amount]
    );
  }

  return { leases: leases.length, splits };
}

module.exports = {
  computeEqualSplits,
  computeOccupancySplits,
  computeElectricSplits,
  getBillSplitAmount,
  loadUnitElectricShares,
  inclusiveDays,
  refreshBillSplitsForBill,
  refreshPropertyMonthSplits,
  loadPropertyHouseCover,
  listBillsForPropertyMonth,
  normalizeAcct,
  accountsMatch,
  matchProperty,
  loadActiveLeases,
  insertBillWithSplits,
  computeSplitsForBill,
};
