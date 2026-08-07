#!/usr/bin/env node
/**
 * Push a Dominion portal extract into Montero Rentals and refresh electric splits.
 *
 * Input JSON (file path arg or DOMINION_EXTRACT_JSON / stdin):
 * {
 *   "current_charges": 293.69,          // REQUIRED for tenant billing (preferred)
 *   "total_amount_due": 731.70,         // account balance / Amount Due (stored as statement_balance)
 *   "due_date": "2026-08-14",
 *   "statement_date": "2026-07-17",     // period_end when billing_days known
 *   "billing_days": 30,
 *   "period_start": "2026-06-18",       // optional if statement_date + billing_days set
 *   "period_end": "2026-07-17",
 *   "kwh_usage": 1234,                  // archived in notes (no DB column)
 *   "pdf_path": "archive/utilities/dominion-bills/....pdf",
 *   "account_number": "…",              // optional match check
 *   "property_name": "743"
 * }
 *
 * Dry-run by default. APPLY=1 to write.
 * Notify tenants: NOTIFY=1 (sets bill + open splits to notified).
 */
require('../../src/config/env');
const fs = require('fs');
const path = require('path');
const pool = require('../../src/db/client');
const {
  periodFromDominionStatement,
  computeChargeableAfter,
} = require('../../src/services/dominion-billing.service');
const { refreshBillSplitsForBill } = require('../../src/use-cases/utilities/domain');
const { enforceLatestCollectible } = require('../../src/use-cases/utilities/enforce-latest-collectible');

const APPLY = process.env.APPLY === '1';
const NOTIFY = process.env.NOTIFY === '1';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';
const PROPERTY_ID = process.env.PROPERTY_ID || 'cccccccc-0000-0000-0000-000000000001';

function money(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function day(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function loadPayload() {
  const arg = process.argv[2];
  if (arg && arg !== '-') {
    return JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
  }
  if (process.env.DOMINION_EXTRACT_JSON) {
    return JSON.parse(process.env.DOMINION_EXTRACT_JSON);
  }
  const stdin = fs.readFileSync(0, 'utf8').trim();
  if (!stdin) {
    throw new Error('Pass a JSON file path, DOMINION_EXTRACT_JSON, or stdin JSON');
  }
  return JSON.parse(stdin);
}

function normalize(raw) {
  const current = money(raw.current_charges ?? raw.tenant_charge_amount ?? raw.currentCharges);
  const balance = money(raw.total_amount_due ?? raw.statement_balance ?? raw.amount_due ?? raw.totalAmountDue);
  // Tenant collectible = Current Charges. Never bill the full account balance.
  const tenantCharge = current != null ? current : null;
  if (tenantCharge == null) {
    throw new Error('current_charges is required (do not sync Total Amount Due alone as the tenant bill)');
  }

  let period_start = day(raw.period_start ?? raw.periodStart);
  let period_end = day(raw.period_end ?? raw.periodEnd ?? raw.statement_date ?? raw.statementDate);
  const billingDays = Number(raw.billing_days ?? raw.billingDays) || null;
  const statementDate = day(raw.statement_date ?? raw.statementDate ?? period_end);

  if ((!period_start || !period_end) && statementDate && billingDays) {
    const p = periodFromDominionStatement({ statementDate, billingDays });
    period_start = period_start || p.period_start;
    period_end = period_end || p.period_end;
  }
  if (!period_start || !period_end) {
    throw new Error('Need period_start/period_end or statement_date + billing_days');
  }

  const due_date = day(raw.due_date ?? raw.dueDate) || period_end;
  const kwh = raw.kwh_usage ?? raw.kwh ?? raw.total_kwh ?? null;
  const pdfPath = raw.pdf_path || raw.pdfPath || null;
  let bill_document_url = raw.bill_document_url || null;
  if (!bill_document_url && pdfPath) {
    // Archive-relative path; utility_bills stores URL text only (no PDF blob column).
    bill_document_url = path.isAbsolute(pdfPath)
      ? `file://${pdfPath}`
      : `archive:${path.normalize(pdfPath).replace(/\\/g, '/')}`;
  }

  return {
    current_charges: tenantCharge,
    statement_balance: balance,
    amount_source: current != null ? 'current_charges' : 'amount_due_fallback',
    period_start,
    period_end,
    due_date,
    billing_days: billingDays,
    statement_date: statementDate,
    kwh_usage: kwh,
    pdf_path: pdfPath,
    bill_document_url,
    account_number: raw.account_number || raw.accountNumber || null,
    notes_extra: raw.notes || null,
  };
}

async function main() {
  const payload = normalize(loadPayload());
  console.log('Mode:', APPLY ? 'APPLY' : 'DRY RUN', NOTIFY ? '+ NOTIFY' : '');
  console.log('Payload:', payload);

  if (payload.pdf_path && !fs.existsSync(payload.pdf_path)) {
    console.warn('WARNING: pdf_path does not exist yet:', payload.pdf_path);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [prop] } = await client.query(
      `SELECT id, name, dominion_account_number
         FROM properties WHERE id = $1 FOR UPDATE`,
      [PROPERTY_ID]
    );
    if (!prop) throw new Error(`Property ${PROPERTY_ID} not found`);
    console.log('Property:', prop);

    const { rows: [owner] } = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [OWNER_EMAIL]
    );
    if (!owner) throw new Error(`Owner ${OWNER_EMAIL} not found`);

    // Prefer open bill in same period_end month; else insert new draft.
    const ym = payload.period_end.slice(0, 7);
    const { rows: existingRows } = await client.query(
      `SELECT *
         FROM utility_bills
        WHERE property_id = $1
          AND service_type = 'electric'
          AND to_char(COALESCE(period_end, period_start), 'YYYY-MM') = $2
          AND status::text IN ('draft', 'notified', 'charging')
        ORDER BY
          CASE status::text WHEN 'notified' THEN 0 WHEN 'charging' THEN 1 ELSE 2 END,
          created_at DESC
        LIMIT 1`,
      [PROPERTY_ID, ym]
    );
    const existing = existingRows[0] || null;

    const noteLines = [
      existing?.notes || null,
      'Dominion portal sync',
      `Current charges $${payload.current_charges.toFixed(2)}`,
      payload.statement_balance != null
        ? `Total amount due / statement balance $${Number(payload.statement_balance).toFixed(2)}`
        : null,
      payload.kwh_usage != null ? `kWh usage ${payload.kwh_usage}` : null,
      payload.billing_days != null ? `Billing days ${payload.billing_days}` : null,
      payload.pdf_path ? `PDF archived at ${payload.pdf_path}` : null,
      payload.notes_extra,
      `Synced at ${new Date().toISOString()}`,
    ].filter(Boolean);

    const chargeableAfter = computeChargeableAfter(payload.period_end);
    let bill;

    if (APPLY) {
      if (existing) {
        const { rows: [updated] } = await client.query(
          `UPDATE utility_bills
              SET period_start = $2,
                  period_end = $3,
                  due_date = $4,
                  chargeable_after = $5,
                  total_amount = $6,
                  tenant_charge_amount = $6,
                  statement_balance = COALESCE($7, statement_balance),
                  amount_source = $8,
                  amount_pulled_at = NOW(),
                  bill_document_url = COALESCE($9, bill_document_url),
                  provider_name = COALESCE(provider_name, 'Dominion Energy'),
                  notes = $10,
                  status = CASE WHEN $11::boolean THEN 'notified' ELSE status END,
                  settled_at = NULL,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [
            existing.id,
            payload.period_start,
            payload.period_end,
            payload.due_date,
            chargeableAfter,
            payload.current_charges,
            payload.statement_balance,
            payload.amount_source,
            payload.bill_document_url,
            noteLines.join('\n'),
            NOTIFY,
          ]
        );
        bill = updated;
        console.log('Updated bill', bill.id);
      } else {
        const { rows: [created] } = await client.query(
          `INSERT INTO utility_bills
             (property_id, created_by, service_type, provider_name,
              period_start, period_end, total_amount, due_date,
              notes, bill_document_url, gmail_message_id, status,
              tenant_charge_amount, statement_balance, amount_source,
              chargeable_after, amount_pulled_at)
           VALUES ($1,$2,'electric','Dominion Energy',$3,$4,$5,$6,$7,$8,$9,
                   CASE WHEN $10::boolean THEN 'notified' ELSE 'draft' END,
                   $5,$11,$12,$13,NOW())
           RETURNING *`,
          [
            PROPERTY_ID,
            owner.id,
            payload.period_start,
            payload.period_end,
            payload.current_charges,
            payload.due_date,
            noteLines.join('\n'),
            payload.bill_document_url,
            `dominion-portal-${payload.period_end}`,
            NOTIFY,
            payload.statement_balance,
            payload.amount_source,
            chargeableAfter,
          ]
        );
        bill = created;
        console.log('Created bill', bill.id);
      }

      const result = await refreshBillSplitsForBill(client, bill);
      if (NOTIFY) {
        await client.query(
          `UPDATE utility_bill_splits
              SET status = 'notified', updated_at = NOW()
            WHERE bill_id = $1
              AND status::text IN ('pending', 'failed', 'draft')
              AND amount > 0`,
          [bill.id]
        );
      }
      await enforceLatestCollectible(client, PROPERTY_ID, 'electric');

      const { rows: splits } = await client.query(
        `SELECT u.first_name, s.amount, s.status
           FROM utility_bill_splits s
           JOIN users u ON u.id = s.tenant_id
          WHERE s.bill_id = $1
          ORDER BY u.first_name`,
        [bill.id]
      );
      console.log('Splits:', splits);
      console.log('refresh meta leases/splits:', result.leases, result.splits?.length);
      await client.query('COMMIT');
      console.log('Committed');
    } else {
      console.log(existing ? `Would update ${existing.id}` : 'Would insert new electric bill');
      await client.query('ROLLBACK');
      console.log('Dry-run only. Re-run with APPLY=1.');
    }

    // Always write extract sidecar next to PDF / under archive
    const outDir = path.join('archive', 'utilities', 'dominion-bills');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `extract-${payload.period_end}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify({ ...payload, synced_at: new Date().toISOString(), apply: APPLY }, null, 2)}\n`);
    console.log('Wrote', outFile);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
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
