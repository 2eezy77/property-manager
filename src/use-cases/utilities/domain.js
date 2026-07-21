/**
 * Domain rules shared by UC01 (manual create) and UC09 (Gmail import).
 */

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
  leases,
}) {
  const billMeta = {
    total_amount,
    tenant_charge_amount: tenant_charge_amount ?? null,
  };
  const splitAmount = getBillSplitAmount(billMeta);

  const splits = await computeSplitsForBill(client, {
    propertyId,
    service_type,
    leases,
    bill: billMeta,
    splitAmount,
    period_start,
    period_end,
  });

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

  for (const s of splits) {
    await client.query(
      `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [bill.id, s.leaseId, s.tenantId, s.amount]
    );
  }

  return bill;
}

async function refreshBillSplitsForBill(client, bill, { preserveStatuses = ['paid', 'waived'] } = {}) {
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
  normalizeAcct,
  accountsMatch,
  matchProperty,
  loadActiveLeases,
  insertBillWithSplits,
  computeSplitsForBill,
};
