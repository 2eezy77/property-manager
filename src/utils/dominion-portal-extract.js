/**
 * Normalize Dominion portal scrape JSON before syncing electric bills.
 * Tenant collectible must be Current Charges — never Total Amount Due alone.
 */

'use strict';

const path = require('path');
const {
  periodFromDominionStatement,
} = require('../services/dominion-billing.service');

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

function normalizeDominionPortalExtract(raw) {
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

module.exports = {
  money,
  day,
  normalizeDominionPortalExtract,
};
