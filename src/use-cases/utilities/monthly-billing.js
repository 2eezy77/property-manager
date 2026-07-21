/**
 * Month-to-month utility billing: one draft per property + service + calendar month.
 */

const {
  computeSplitsForBill,
  getBillSplitAmount,
  loadActiveLeases,
} = require('./domain');

function billingMonth(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  return s.length >= 7 ? s.slice(0, 7) : null;
}

function calendarMonthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return null;
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function minDate(a, b) {
  return a <= b ? a : b;
}

function maxDate(a, b) {
  return a >= b ? a : b;
}

function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

async function refreshBillSplits(client, bill, totalAmount) {
  await client.query('DELETE FROM utility_bill_splits WHERE bill_id = $1', [bill.id]);
  const leases = await loadActiveLeases(
    client,
    bill.property_id,
    bill.period_start,
    bill.period_end
  );
  const splitAmount = totalAmount ?? getBillSplitAmount(bill);
  const splits = await computeSplitsForBill(client, {
    propertyId: bill.property_id,
    service_type: bill.service_type,
    leases,
    bill: { ...bill, tenant_charge_amount: splitAmount, total_amount: bill.total_amount },
    splitAmount,
    period_start: bill.period_start,
    period_end: bill.period_end,
  });
  for (const s of splits) {
    await client.query(
      `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [bill.id, s.leaseId, s.tenantId, s.amount]
    );
  }
  return leases.length;
}

/**
 * Find existing draft for this property + service + billing month (by period_end).
 */
async function findMonthlyDraft(client, propertyId, serviceType, periodEnd) {
  const ym = billingMonth(periodEnd);
  if (!ym) return null;
  const { rows } = await client.query(
    `SELECT *
       FROM utility_bills
      WHERE property_id = $1
        AND service_type = $2
        AND status = 'draft'
        AND to_char(period_end, 'YYYY-MM') = $3
      ORDER BY total_amount DESC, created_at DESC
      LIMIT 1`,
    [propertyId, serviceType, ym]
  );
  return rows[0] || null;
}

function electricAmountFields(parsed) {
  const tenant = parsed.tenant_charge_amount ?? parsed.total_amount;
  return {
    total_amount: tenant,
    tenant_charge_amount: tenant,
    statement_balance: parsed.statement_balance ?? null,
    amount_source: parsed.amount_source ?? null,
    chargeable_after: parsed.chargeable_after ?? parsed.period_end,
    amount_pulled_at: new Date(),
  };
}

/**
 * Merge parsed Gmail row into existing monthly draft or create new draft.
 */
async function upsertMonthlyDraft(client, {
  propertyId,
  createdBy,
  parsed,
  leases,
}) {
  const ym = billingMonth(parsed.period_end);
  const bounds = calendarMonthBounds(ym);
  const electricMeta = parsed.service_type === 'electric' ? electricAmountFields(parsed) : {
    total_amount: parsed.total_amount,
    tenant_charge_amount: parsed.tenant_charge_amount ?? parsed.total_amount,
    statement_balance: parsed.statement_balance ?? null,
    amount_source: parsed.amount_source ?? null,
    chargeable_after: parsed.chargeable_after ?? null,
    amount_pulled_at: parsed.service_type === 'electric' ? new Date() : null,
  };

  const existing = await findMonthlyDraft(client, propertyId, parsed.service_type, parsed.period_end);

  if (existing) {
    const total = Math.max(Number(existing.total_amount), Number(electricMeta.total_amount));
    const tenantCharge = Math.max(
      Number(existing.tenant_charge_amount ?? existing.total_amount),
      Number(electricMeta.tenant_charge_amount)
    );
    const periodStart = bounds?.start || minDate(existing.period_start, parsed.period_start);
    const periodEnd = bounds?.end || maxDate(existing.period_end, parsed.period_end);
    const dueDate = maxDate(existing.due_date, parsed.due_date);
    const notes = [
      existing.notes,
      parsed.notes,
      `(Merged ${parsed.email_subject || 'Gmail import'} into ${monthLabel(ym)} bill.)`,
    ].filter(Boolean).join('\n');

    const { rows: [updated] } = await client.query(
      `UPDATE utility_bills
          SET total_amount = $1,
              tenant_charge_amount = $2,
              statement_balance = COALESCE($3, statement_balance),
              amount_source = COALESCE($4, amount_source),
              chargeable_after = COALESCE($5, chargeable_after),
              amount_pulled_at = COALESCE($6, amount_pulled_at, NOW()),
              period_start = $7,
              period_end = $8,
              due_date = $9,
              provider_name = COALESCE($10, provider_name),
              notes = $11,
              bill_document_url = COALESCE($12, bill_document_url),
              gmail_message_id = COALESCE($13, gmail_message_id),
              updated_at = NOW()
        WHERE id = $14
        RETURNING *`,
      [
        total,
        tenantCharge,
        electricMeta.statement_balance,
        electricMeta.amount_source,
        electricMeta.chargeable_after,
        electricMeta.amount_pulled_at,
        periodStart,
        periodEnd,
        dueDate,
        parsed.provider_name,
        notes,
        parsed.bill_document_url,
        parsed.gmail_message_id,
        existing.id,
      ]
    );
    await refreshBillSplits(client, updated, tenantCharge);
    return { bill: updated, merged: true, billing_month: ym };
  }

  const periodStart = bounds?.start || parsed.period_start;
  const periodEnd = bounds?.end || parsed.period_end;

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
      parsed.service_type,
      parsed.provider_name ?? null,
      periodStart,
      periodEnd,
      electricMeta.total_amount,
      parsed.due_date,
      parsed.notes,
      parsed.bill_document_url,
      parsed.gmail_message_id,
      electricMeta.tenant_charge_amount,
      electricMeta.statement_balance,
      electricMeta.amount_source,
      electricMeta.chargeable_after,
      electricMeta.amount_pulled_at,
    ]
  );

  const splits = await computeSplitsForBill(client, {
    propertyId,
    service_type: parsed.service_type,
    leases,
    bill,
    period_start: periodStart,
    period_end: periodEnd,
  });
  for (const s of splits) {
    await client.query(
      `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [bill.id, s.leaseId, s.tenantId, s.amount]
    );
  }

  return { bill, merged: false, billing_month: ym };
}

module.exports = {
  billingMonth,
  calendarMonthBounds,
  monthLabel,
  minDate,
  maxDate,
  findMonthlyDraft,
  upsertMonthlyDraft,
  refreshBillSplits,
};
