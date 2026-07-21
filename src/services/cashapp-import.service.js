/**
 * Parse Cash App CSV and allocate P2P credits to monthly rent periods.
 * Tenants paying $450 biweekly are paired into $900/month buckets.
 */

const fs = require('fs');
const { periodForMonth, recordManualPayment } = require('./manual-payment.service');

const SENDER_ALIASES = {
  isaiah: 'isaiah',
  'isaiah reese': 'isaiah',
  'stone buckley': 'stone',
  stone: 'stone',
  'buckley stone': 'stone',
  'lily fortman': 'lily',
  lily: 'lily',
};

const EMAIL_CASHAPP_KEY = [
  [/buckley|stone/i, 'stone'],
  [/isaiah/i, 'isaiah'],
  [/lily/i, 'lily'],
  [/davontay|gara/i, 'davontaye'],
  [/osanin/i, 'osanin'],
];

function parseMoney(raw) {
  if (raw == null || raw === '') return 0;
  return parseFloat(String(raw).replace(/[$,]/g, '')) || 0;
}

function parseCashAppCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((h, i) => [h, (cols[i] || '').replace(/^"|"$/g, '')]));
    if (row['Transaction Type'] !== 'P2P') return null;
    if (row.Status && row.Status !== 'COMPLETE') return null;

    const amount = parseMoney(row['Net Amount'] || row.Amount);
    if (amount <= 0) return null;

    const dateStr = row.Date || '';
    const { date, dateIso } = parseCashAppDate(dateStr);
    if (!date) return null;

    const senderKey = normalizeSender(row['Name of sender/receiver'] || '');

    return {
      transactionId: row['Transaction ID'] || '',
      date,
      dateIso,
      amount,
      notes: row.Notes || '',
      sender: row['Name of sender/receiver'] || '',
      senderKey,
    };
  }).filter(Boolean);
}

function parseCashAppDate(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { date: null, dateIso: null };
  const dateIso = `${m[1]}-${m[2]}-${m[3]}`;
  return { date: new Date(`${dateIso}T12:00:00`), dateIso };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeSender(name) {
  const key = name.trim().toLowerCase();
  return SENDER_ALIASES[key] || key;
}

/** Cash App notes that are deposit credits, not rent. */
function isDepositPayment(row) {
  const notes = String(row?.notes || '').toLowerCase();
  return /\bsecurity\s*deposit\b|\bsec(?:urity)?\s*dep\b|\btowards?\s+(?:the\s+)?deposit\b|\bdeposit\b/.test(notes)
    && !/\brent\b/.test(notes);
}

function splitRentAndDepositRows(rows) {
  const rentRows = [];
  const depositRows = [];
  for (const row of rows) {
    if (isDepositPayment(row)) depositRows.push(row);
    else rentRows.push(row);
  }
  return { rentRows, depositRows };
}

function monthKey(year, monthIndex0) {
  return `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`;
}

function monthLabel(year, monthIndex0) {
  return new Date(year, monthIndex0, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function mapCashAppPart(p) {
  return {
    transactionId: p.transactionId,
    dateIso: p.dateIso,
    amount: p.amount,
    notes: p.notes,
    sender: p.sender,
  };
}

/**
 * Allocate by calendar month (payment date). Matches how tenants think about "June rent".
 * Months with total > monthlyRent close at monthlyRent; excess is reported, not rolled forward.
 */
function allocateCalendarMonths(payments, monthlyRent) {
  const byYm = new Map();
  for (const p of payments) {
    const ym = p.dateIso.slice(0, 7);
    if (!byYm.has(ym)) byYm.set(ym, []);
    byYm.get(ym).push(p);
  }

  const months = [];
  const unallocated = [];
  const overages = [];

  for (const ym of [...byYm.keys()].sort()) {
    const parts = byYm.get(ym).sort((a, b) => a.date - b.date);
    const total = parts.reduce((s, p) => s + p.amount, 0);
    const [y, m] = ym.split('-').map(Number);
    const period = periodForMonth(y, m - 1);

    if (total >= monthlyRent - 0.01) {
      months.push({
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: monthLabel(y, m - 1),
        amount: monthlyRent,
        paidAt: parts[parts.length - 1].dateIso,
        parts: parts.map(mapCashAppPart),
      });
      if (total > monthlyRent + 0.01) {
        overages.push({ ym, excess: Math.round((total - monthlyRent) * 100) / 100 });
      }
    } else if (total > 0.001) {
      unallocated.push({
        type: 'partial_month',
        month: monthLabel(y, m - 1),
        periodStart: period.start,
        periodEnd: period.end,
        amount: total,
        expected: monthlyRent,
        shortfall: Math.round((monthlyRent - total) * 100) / 100,
        paidAt: parts[parts.length - 1].dateIso,
        parts: parts.map(mapCashAppPart),
      });
    }
  }

  return { months, unallocated, overages };
}

/**
 * Allocate payments into rent months using chronological bucketing.
 * Each bucket holds up to monthlyRent; overflow rolls to the next month.
 */
function allocateRentMonths(payments, monthlyRent) {
  const sorted = [...payments].sort((a, b) => a.date - b.date);
  const closed = [];
  let bucket = null;
  let nextBucketStart = null;

  const advanceMonth = (year, monthIndex0) => {
    if (monthIndex0 >= 11) return { year: year + 1, month: 0 };
    return { year, month: monthIndex0 + 1 };
  };

  const startBucket = (payDate) => {
    if (nextBucketStart) {
      bucket = {
        year: nextBucketStart.year,
        month: nextBucketStart.month,
        parts: [],
        total: 0,
      };
      nextBucketStart = null;
      return;
    }
    bucket = {
      year: payDate.getFullYear(),
      month: payDate.getMonth(),
      parts: [],
      total: 0,
    };
  };

  const closeBucket = () => {
    const period = periodForMonth(bucket.year, bucket.month);
    closed.push({
      periodStart: period.start,
      periodEnd: period.end,
      periodLabel: monthLabel(bucket.year, bucket.month),
      amount: monthlyRent,
      paidAt: bucket.parts[bucket.parts.length - 1].dateIso,
      parts: bucket.parts.map(part => ({
        transactionId: part.transactionId,
        dateIso: part.dateIso,
        amount: part.amount,
        notes: part.notes,
        sender: part.sender,
      })),
    });
    nextBucketStart = advanceMonth(bucket.year, bucket.month);
    bucket = null;
  };

  for (const p of sorted) {
    let remaining = p.amount;

    while (remaining > 0.001) {
      if (!bucket) startBucket(p.date);

      const need = monthlyRent - bucket.total;
      const apply = Math.min(remaining, need);

      bucket.parts.push({
        transactionId: p.transactionId,
        dateIso: p.dateIso,
        amount: apply,
        notes: p.notes,
        sender: p.sender,
        date: p.date,
      });
      bucket.total += apply;
      remaining -= apply;

      if (bucket.total >= monthlyRent - 0.01) {
        closeBucket();
      }
    }
  }

  const unallocated = [];
  if (bucket && bucket.total > 0.001) {
    const period = periodForMonth(bucket.year, bucket.month);
    unallocated.push({
      type: 'partial_month',
      month: monthLabel(bucket.year, bucket.month),
      periodStart: period.start,
      periodEnd: period.end,
      amount: bucket.total,
      expected: monthlyRent,
      shortfall: Math.round((monthlyRent - bucket.total) * 100) / 100,
      paidAt: bucket.parts[bucket.parts.length - 1].dateIso,
      parts: bucket.parts.map(part => ({
        transactionId: part.transactionId,
        dateIso: part.dateIso,
        amount: part.amount,
        notes: part.notes,
        sender: part.sender,
      })),
    });
  }

  return { months: closed, unallocated };
}

function filterByLeaseStart(allocations, leaseStartDate) {
  const leaseStart = new Date(leaseStartDate);
  const leaseMonthStart = new Date(leaseStart.getFullYear(), leaseStart.getMonth(), 1);

  return {
    months: allocations.months.filter(m => new Date(`${m.periodStart}T12:00:00`) >= leaseMonthStart),
    unallocated: allocations.unallocated,
  };
}

/** Move rent paid shortly before lease start (e.g. June payment for July lease) to the first lease month. */
function reallocatePreLeaseMonths(allocations, tenant) {
  const leaseStart = new Date(tenant.start_date);
  const firstLeasePeriod = periodForMonth(leaseStart.getFullYear(), leaseStart.getMonth());
  const leaseMonthDate = new Date(`${firstLeasePeriod.start}T12:00:00`);
  const windowStart = new Date(leaseMonthDate);
  windowStart.setDate(windowStart.getDate() - 45);
  const monthlyRent = parseFloat(tenant.monthly_rent);

  const kept = [];
  const preLease = [];

  for (const m of allocations.months) {
    const ps = new Date(`${m.periodStart}T12:00:00`);
    if (ps < leaseMonthDate) preLease.push(m);
    else kept.push(m);
  }

  if (
    preLease.length
    && !kept.some((m) => m.periodStart === firstLeasePeriod.start)
  ) {
    const parts = preLease.flatMap((m) => m.parts);
    const total = parts.reduce((s, p) => s + p.amount, 0);
    const lastPaid = [...parts].sort((a, b) => a.dateIso.localeCompare(b.dateIso)).at(-1)?.dateIso;
    const earlyEnough = parts.some((p) => new Date(`${p.dateIso}T12:00:00`) >= windowStart);
    if (earlyEnough && total >= monthlyRent - 0.01) {
      kept.push({
        periodStart: firstLeasePeriod.start,
        periodEnd: firstLeasePeriod.end,
        periodLabel: monthLabel(leaseStart.getFullYear(), leaseStart.getMonth()),
        amount: monthlyRent,
        paidAt: lastPaid,
        parts,
      });
    }
  }

  return { months: kept, unallocated: allocations.unallocated, overages: allocations.overages };
}

async function load743CashAppTenants(db) {
  const { rows } = await db.query(
    `SELECT u.id AS tenant_id,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name,
            u.first_name,
            u.last_name,
            u.email,
            l.id AS lease_id,
            l.monthly_rent,
            l.start_date
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE p.name ILIKE '%743%' OR p.address_line1 ILIKE '%743%'`
  );

  return rows
    .map((r) => {
      const cashAppKey = deriveCashAppKey(r.email, r.first_name, r.last_name);
      return cashAppKey ? { ...r, cashAppKey } : null;
    })
    .filter(Boolean);
}

function deriveCashAppKey(email, firstName, lastName) {
  const hay = `${email || ''} ${firstName || ''} ${lastName || ''}`;
  for (const [re, key] of EMAIL_CASHAPP_KEY) {
    if (re.test(hay)) return key;
  }
  return null;
}

async function removeCashAppPeriods(client, tenantId, periodStarts) {
  if (!periodStarts.length) return 0;
  const { rows } = await client.query(
    `SELECT id FROM payments
      WHERE tenant_id = $1
        AND period_start = ANY($2::date[])
        AND metadata->>'source' = 'cash_app_import'`,
    [tenantId, periodStarts]
  );
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  await client.query('DELETE FROM payment_splits WHERE payment_id = ANY($1::uuid[])', [ids]);
  await client.query(
    `UPDATE utility_bill_splits SET payment_id = NULL WHERE payment_id = ANY($1::uuid[])`,
    [ids]
  );
  await client.query(
    `UPDATE late_fees SET payment_id = NULL WHERE payment_id = ANY($1::uuid[])`,
    [ids]
  );
  const del = await client.query('DELETE FROM payments WHERE id = ANY($1::uuid[])', [ids]);
  return del.rowCount;
}

async function removeSupersededPartials(client, leaseId, periodStart) {
  await client.query(
    `DELETE FROM payments
      WHERE lease_id = $1
        AND period_start = $2::date
        AND status = 'succeeded'
        AND metadata->>'partial_rent' = 'true'
        AND metadata->>'source' = 'cash_app_import'`,
    [leaseId, periodStart]
  );
}

async function syncExistingImports(client, t, m, paymentId) {
  const refs = m.parts.map((p) => p.transactionId).filter(Boolean).join(', ');
  await client.query(
    `UPDATE payments
        SET paid_at = $1::timestamptz,
            amount = $2,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $4`,
    [
      `${m.paidAt}T12:00:00`,
      m.amount,
      JSON.stringify({
        source: 'cash_app_import',
        payment_method: 'cash_app',
        partial_rent: false,
        cash_app_parts: m.parts,
        external_reference: refs,
      }),
      paymentId,
    ]
  );
  await removeSupersededPartials(client, t.leaseId, m.periodStart);
}

async function applyDepositCredits(client, t) {
  const credits = t.depositCredits || [];
  if (!credits.length) return { applied: 0, remaining: null, skipped: 0 };

  const { rows: pendingRows } = await client.query(
    `SELECT id, amount, metadata
       FROM payments
      WHERE lease_id = $1
        AND payment_type = 'security_deposit'
        AND status = 'pending'
      ORDER BY due_date ASC
      LIMIT 1
      FOR UPDATE`,
    [t.leaseId]
  );
  if (!pendingRows[0]) {
    return { applied: 0, remaining: null, skipped: credits.length, warning: 'no pending deposit' };
  }

  const pending = pendingRows[0];
  const meta = pending.metadata || {};
  const already = new Set(
    (meta.cash_app_deposit_parts || [])
      .map((p) => p.transactionId)
      .filter(Boolean)
  );

  const fresh = credits.filter((c) => c.transactionId && !already.has(c.transactionId));
  if (!fresh.length) {
    return {
      applied: 0,
      remaining: parseFloat(pending.amount),
      skipped: credits.length,
    };
  }

  const creditTotal = fresh.reduce((s, p) => s + p.amount, 0);
  const owed = parseFloat(pending.amount);
  const applyAmt = Math.min(creditTotal, owed);
  const remaining = Math.round((owed - applyAmt) * 100) / 100;
  const allParts = [...(meta.cash_app_deposit_parts || []), ...fresh];
  const paidTotal = Math.round(
    ((Number(meta.deposit_paid_total) || 0) + applyAmt) * 100
  ) / 100;
  const refs = allParts.map((p) => p.transactionId).filter(Boolean).join(', ');

  if (remaining <= 0.01) {
    await client.query(
      `UPDATE payments
          SET status = 'succeeded',
              amount = $1,
              paid_at = $2::timestamptz,
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $4`,
      [
        owed,
        `${fresh[fresh.length - 1].dateIso}T12:00:00`,
        JSON.stringify({
          source: 'cash_app_import',
          payment_method: 'cash_app',
          partial_deposit: false,
          deposit_paid_total: paidTotal,
          cash_app_deposit_parts: allParts,
          external_reference: refs,
          notes: fresh.map((p) => p.notes).filter(Boolean).join(' | ') || 'Security deposit via Cash App',
        }),
        pending.id,
      ]
    );
    return { applied: applyAmt, remaining: 0, skipped: credits.length - fresh.length };
  }

  await client.query(
    `UPDATE payments
        SET amount = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $3`,
    [
      remaining,
      JSON.stringify({
        source: meta.source || 'lease_signing',
        payment_method: 'cash_app',
        partial_deposit: true,
        deposit_paid_total: paidTotal,
        cash_app_deposit_parts: allParts,
        external_reference: refs,
        notes: `Partial security deposit — $${paidTotal.toFixed(2)} received via Cash App; $${remaining.toFixed(2)} still owed.`,
        last_deposit_credit_at: new Date().toISOString(),
      }),
      pending.id,
    ]
  );

  return { applied: applyAmt, remaining, skipped: credits.length - fresh.length };
}

async function applyCashAppImportPlan(db, plan) {
  const client = await db.connect();
  let inserted = 0;
  let skipped = 0;
  let synced = 0;
  let cleared = 0;
  let depositApplied = 0;
  const depositResults = [];

  try {
    for (const t of plan.tenants) {
      for (const m of t.months) {
        const removed = await removeCashAppPeriods(client, t.tenantId, [m.periodStart]);
        cleared += removed;

        await client.query('BEGIN');
        const refs = m.parts.map((p) => p.transactionId).filter(Boolean).join(', ');
        const result = await recordManualPayment(client, {
          leaseId: t.leaseId,
          tenantId: t.tenantId,
          amount: m.amount,
          paidAt: m.paidAt,
          periodStart: m.periodStart,
          periodEnd: m.periodEnd,
          paymentMethod: 'cash_app',
          reference: refs,
          notes: m.parts.map((p) => p.notes).filter(Boolean).join(' | ') || null,
          metadataExtra: {
            source: 'cash_app_import',
            cash_app_parts: m.parts,
          },
        });
        await client.query('COMMIT');

        if (result.skipped) {
          skipped++;
          await syncExistingImports(client, t, m, result.paymentId);
          synced++;
        } else {
          await removeSupersededPartials(client, t.leaseId, m.periodStart);
          inserted++;
        }
      }

      for (const u of t.unallocated) {
        if (u.type !== 'partial_month') continue;

        const { rows: existingFull } = await client.query(
          `SELECT id FROM payments
            WHERE lease_id = $1
              AND period_start = $2::date
              AND status = 'succeeded'
              AND COALESCE(metadata->>'partial_rent', '') <> 'true'
              AND metadata->>'source' = 'cash_app_import'`,
          [t.leaseId, u.periodStart]
        );
        if (existingFull.length) continue;

        const part = u.parts[0];
        await client.query('BEGIN');
        const result = await recordManualPayment(client, {
          leaseId: t.leaseId,
          tenantId: t.tenantId,
          amount: u.amount,
          paidAt: u.paidAt,
          periodStart: u.periodStart,
          periodEnd: u.periodEnd,
          paymentMethod: 'cash_app',
          reference: part?.transactionId || null,
          notes: part?.notes || `Partial rent — ${u.month}`,
          allowPartial: true,
          metadataExtra: {
            source: 'cash_app_import',
            partial_rent: true,
            cash_app_parts: u.parts,
          },
        });
        await client.query('COMMIT');

        if (result.skipped) skipped++;
        else inserted++;
      }

      if ((t.depositCredits || []).length) {
        await client.query('BEGIN');
        const dep = await applyDepositCredits(client, t);
        await client.query('COMMIT');
        depositApplied += dep.applied || 0;
        depositResults.push({
          name: t.name,
          applied: dep.applied,
          remaining: dep.remaining,
          skipped: dep.skipped,
          warning: dep.warning || null,
        });
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { inserted, skipped, synced, cleared, depositApplied, depositResults };
}

function buildImportPlanFromRows(allRows, tenants, senderKeys) {
  const plan = { tenants: [], warnings: [] };

  for (const key of senderKeys) {
    const tenant = tenants.find(t => t.cashAppKey === key);
    if (!tenant) {
      plan.warnings.push(`No tenant mapped for Cash App sender key "${key}"`);
      continue;
    }

    const tenantRows = allRows.filter((r) => r.senderKey === key);
    const { rentRows, depositRows } = splitRentAndDepositRows(tenantRows);
    const monthlyRent = parseFloat(tenant.monthly_rent);
    // From May 2026 onward, use payment date month (biweekly $450 halves stay in that month).
    const cutoff = new Date('2026-05-01T12:00:00');
    const beforeCutoff = rentRows.filter((p) => p.date < cutoff);
    const fromCutoff = rentRows.filter((p) => p.date >= cutoff);

    const hist = allocateRentMonths(beforeCutoff, monthlyRent);
    const recent = fromCutoff.length
      ? allocateCalendarMonths(fromCutoff, monthlyRent)
      : { months: [], unallocated: [], overages: [] };

    for (const o of recent.overages || []) {
      plan.warnings.push(
        `${tenant.name}: ${o.ym} Cash App total exceeds $${monthlyRent} by $${o.excess} (only $${monthlyRent} imported as rent)`
      );
    }

    let allocations = {
      months: [...hist.months, ...recent.months],
      unallocated: [...hist.unallocated, ...recent.unallocated],
    };

    allocations = reallocatePreLeaseMonths(allocations, tenant);

    const fullPeriods = new Set(allocations.months.map((m) => m.periodStart));
    allocations.unallocated = allocations.unallocated.filter(
      (u) => !fullPeriods.has(u.periodStart) && u.amount >= 50
    );

    allocations = filterByLeaseStart(allocations, tenant.start_date);

    const monthsWithinLease = allocations.months.filter(m => {
      const ps = new Date(`${m.periodStart}T12:00:00`);
      const leaseStart = new Date(tenant.start_date);
      return ps >= new Date(leaseStart.getFullYear(), leaseStart.getMonth(), 1);
    });

    for (const m of monthsWithinLease) {
      if (Math.abs(m.amount - monthlyRent) > 0.01) {
        plan.warnings.push(`${tenant.name}: ${m.periodLabel} amount ${m.amount} != rent ${monthlyRent}`);
      }
    }

    const depositCredits = depositRows
      .slice()
      .sort((a, b) => a.date - b.date)
      .map((p) => ({
        transactionId: p.transactionId,
        dateIso: p.dateIso,
        amount: p.amount,
        notes: p.notes,
        sender: p.sender,
      }));

    if (depositCredits.length) {
      const depositTotal = depositCredits.reduce((s, p) => s + p.amount, 0);
      plan.warnings.push(
        `${tenant.name}: $${depositTotal.toFixed(2)} Cash App tagged as security deposit (not applied to rent)`
      );
    }

    plan.tenants.push({
      key,
      name: tenant.name,
      leaseId: tenant.lease_id,
      tenantId: tenant.tenant_id,
      monthlyRent,
      rawPayments: tenantRows,
      months: monthsWithinLease,
      unallocated: allocations.unallocated,
      depositCredits,
    });
  }

  return plan;
}

function buildImportPlan({ csvPath, tenants, senderKeys }) {
  const keys = senderKeys || [...new Set(tenants.map((t) => t.cashAppKey).filter(Boolean))];
  const rows = parseCashAppCsv(csvPath);
  return buildImportPlanFromRows(rows, tenants, keys);
}

module.exports = {
  parseCashAppCsv,
  allocateRentMonths,
  allocateCalendarMonths,
  buildImportPlan,
  buildImportPlanFromRows,
  load743CashAppTenants,
  applyCashAppImportPlan,
  deriveCashAppKey,
  normalizeSender,
  isDepositPayment,
  splitRentAndDepositRows,
};
