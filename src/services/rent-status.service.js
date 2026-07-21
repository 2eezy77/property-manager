/**
 * Per-tenant rent status for staff (owner + property manager): up to date, late, email?
 * Uses summed payments for the month — partial payments show paid vs remaining, not full rent.
 */

const pool = require('../db/client');
const { accessiblePropertyIds } = require('../utils/property-access');
const { ledgerPaymentWhere } = require('../utils/payment-ledger');

function monthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return {
    monthStart: start.toISOString().slice(0, 10),
    monthEnd: end.toISOString().slice(0, 10),
    monthLabel: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

function money(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function isPastGrace(dueDate, graceDays) {
  if (!dueDate) return false;
  const due = new Date(`${dueDate}T12:00:00`);
  const graceEnd = new Date(due);
  graceEnd.setDate(graceEnd.getDate() + Number(graceDays ?? 5));
  return new Date() > graceEnd;
}

function rentBalances(row) {
  const rent = Number(row.monthly_rent || 0);
  const paid = Number(row.paid_amount_this_month || 0);
  const pending = Number(row.pending_amount_this_month || 0);
  const remaining = Math.max(0, Math.round((rent - paid) * 100) / 100);
  const fullyPaid = rent > 0 && paid >= rent - 0.01;
  const hasPartial = paid > 0.01 && !fullyPaid;
  return { rent, paid, pending, remaining, fullyPaid, hasPartial };
}

function partialDetail(paid, rent, remaining, extraParts = []) {
  const parts = [`Paid ${money(paid)} of ${money(rent)}`, `${money(remaining)} still owed`];
  return parts.concat(extraParts).join(' · ');
}

function paymentMethodSuffix(methods) {
  if (!methods) return '';
  return ` via ${methods}`;
}

function classifyRow(row, monthLabel) {
  const lateFees = Number(row.late_fees_pending || 0);
  const unit = row.unit_number ? `Unit ${row.unit_number}` : '';
  const { rent, paid, pending, remaining, fullyPaid, hasPartial } = rentBalances(row);

  const needsRelink = row.bank_link_status === 'needs_relink';
  const base = {
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    unitNumber: row.unit_number,
    unitLine: unit,
    monthlyRent: rent,
    paidAmount: paid,
    remainingAmount: remaining,
    bankLinkStatus: row.bank_link_status || null,
    needsRelink,
  };

  const overdueDays = Number(row.max_days_overdue || 0);
  const pastGrace = isPastGrace(row.invoice_due_date, row.grace_period_days);
  const hasLateFee = lateFees > 0;
  const isLate = hasLateFee || overdueDays > 0 || pastGrace;

  if (fullyPaid) {
    return {
      ...base,
      status: 'up_to_date',
      statusLabel: 'Up to date',
      shouldEmail: false,
      emailHint: null,
      emailSubject: null,
      detail: `Paid ${money(paid)} for ${monthLabel}${paymentMethodSuffix(row.payment_methods)}`,
      rowStatus: 'ok',
    };
  }

  if (hasPartial) {
    const extra = [];
    if (hasLateFee) extra.push(`${money(lateFees)} late fee`);
    if (overdueDays > 0) extra.push(`${overdueDays} days overdue`);
    if (pending > 0) extra.push(`${money(pending)} ACH in progress`);
    return {
      ...base,
      status: isLate ? 'late' : 'partial',
      statusLabel: isLate ? 'Late — balance due' : 'Partial payment',
      shouldEmail: isLate,
      emailHint: isLate ? 'Email reminder' : null,
      emailSubject: isLate ? `Rent balance due — ${monthLabel}` : null,
      detail: partialDetail(paid, rent, remaining, extra) + paymentMethodSuffix(row.payment_methods),
      rowStatus: isLate ? 'danger' : 'warn',
    };
  }

  if (row.pending_this_month && !row.failed_this_month) {
    const dueLeft = Math.max(0, rent - pending);
    return {
      ...base,
      status: 'pending',
      statusLabel: 'Processing',
      shouldEmail: false,
      emailHint: null,
      emailSubject: null,
      detail:
        pending >= rent - 0.01
          ? `${money(pending)} ACH in progress for ${monthLabel}`
          : `${money(pending)} processing · ${money(dueLeft)} still due`,
      rowStatus: 'info',
    };
  }

  if (row.failed_this_month) {
    return {
      ...base,
      status: 'late',
      statusLabel: 'Late',
      shouldEmail: true,
      emailHint: 'Email tenant',
      emailSubject: `Rent payment failed — ${monthLabel}`,
      detail: `${money(remaining)} still owed · bank debit failed`,
      rowStatus: 'danger',
    };
  }

  if (isLate) {
    const parts = [`${money(remaining)} rent still owed`];
    if (hasLateFee) parts.push(`${money(lateFees)} late fee`);
    if (overdueDays > 0) parts.push(`${overdueDays} days overdue`);
    return {
      ...base,
      status: 'late',
      statusLabel: 'Late',
      shouldEmail: true,
      emailHint: 'Email reminder',
      emailSubject: `Rent reminder — ${monthLabel}`,
      detail: parts.join(' · '),
      rowStatus: 'danger',
    };
  }

  return {
    ...base,
    status: 'due',
    statusLabel: 'Due soon',
    shouldEmail: false,
    emailHint: null,
    emailSubject: null,
    detail: `${money(remaining)} due · still in grace period — wait before emailing`,
    rowStatus: 'warn',
  };
}

async function queryCollectionsRows(propIds) {
  if (!propIds.length) return [];
  const { rows } = await pool.query(
    `SELECT u.id AS tenant_id, u.email,
            TRIM(u.first_name || ' ' || u.last_name) AS name,
            un.unit_number,
            l.id AS lease_id,
            l.status AS lease_status,
            COALESCE((
              SELECT SUM(p.amount)::numeric
                FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type IN ('rent', 'security_deposit')
                 AND p.status IN ('failed', 'pending')
            ), 0) AS unpaid_payments,
            COALESCE((
              SELECT SUM(lf.amount)::numeric
                FROM late_fees lf
               WHERE lf.lease_id = l.id AND lf.status IN ('pending', 'applied')
            ), 0) AS late_fees_pending
       FROM leases l
       JOIN users u ON u.id = l.tenant_id AND u.role = 'tenant'
       JOIN units un ON un.id = l.unit_id
      WHERE un.property_id = ANY($1)
        AND l.status IN ('terminated', 'expired')
        AND (
          EXISTS (
            SELECT 1 FROM payments p
             WHERE p.lease_id = l.id
               AND p.payment_type IN ('rent', 'security_deposit')
               AND p.status IN ('failed', 'pending')
          )
          OR EXISTS (
            SELECT 1 FROM late_fees lf
             WHERE lf.lease_id = l.id AND lf.status IN ('pending', 'applied')
          )
        )
      ORDER BY u.last_name, u.first_name`,
    [propIds]
  );
  return rows;
}

function classifyCollectionsRow(row) {
  const unpaid = Number(row.unpaid_payments || 0);
  const lateFees = Number(row.late_fees_pending || 0);
  const totalOwed = Math.round((unpaid + lateFees) * 100) / 100;
  const unit = row.unit_number ? `Unit ${row.unit_number}` : '';
  const parts = [];
  if (unpaid > 0) parts.push(`${money(unpaid)} unpaid rent/deposit`);
  if (lateFees > 0) parts.push(`${money(lateFees)} late fee`);
  return {
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    unitNumber: row.unit_number,
    unitLine: unit,
    monthlyRent: null,
    paidAmount: 0,
    remainingAmount: totalOwed,
    status: 'collections',
    statusLabel: 'Collections',
    shouldEmail: totalOwed > 0,
    emailHint: 'Email for balance',
    emailSubject: 'Outstanding balance — 743 A Ave',
    detail: parts.length ? parts.join(' · ') : `${money(totalOwed)} owed`,
    rowStatus: 'danger',
    leaseStatus: row.lease_status,
    collections: true,
  };
}

async function queryRentRows(propIds, monthStart, monthEnd) {
  if (!propIds.length) return [];
  const ledger = ledgerPaymentWhere('p');
  const { rows } = await pool.query(
    `SELECT u.id AS tenant_id, u.email,
            TRIM(u.first_name || ' ' || u.last_name) AS name,
            un.unit_number,
            l.monthly_rent::numeric AS monthly_rent,
            COALESCE(l.grace_period_days, 5) AS grace_period_days,
            COALESCE((
              SELECT SUM(p.amount)::numeric
                FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type = 'rent'
                 AND p.status = 'succeeded'
                 AND p.period_start >= $2::date
                 AND p.period_start < $3::date
                 AND ${ledger}
            ), 0) AS paid_amount_this_month,
            (
              SELECT string_agg(DISTINCT
                CASE
                  WHEN COALESCE(p.metadata->>'payment_method', '') = 'cash_app' THEN 'Cash App'
                  WHEN p.stripe_payment_intent_id IS NOT NULL THEN 'ACH'
                  ELSE NULL
                END, ', ')
                FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type = 'rent'
                 AND p.status = 'succeeded'
                 AND p.period_start >= $2::date
                 AND p.period_start < $3::date
                 AND ${ledger}
            ) AS payment_methods,
            COALESCE((
              SELECT SUM(p.amount)::numeric
                FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type = 'rent'
                 AND p.status IN ('pending', 'processing')
                 AND p.period_start >= $2::date
                 AND p.period_start < $3::date
                 AND ${ledger}
            ), 0) AS pending_amount_this_month,
            EXISTS (
              SELECT 1 FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type = 'rent'
                 AND p.status = 'failed'
                 AND p.period_start >= $2::date
                 AND p.period_start < $3::date
                 AND ${ledger}
            ) AS failed_this_month,
            EXISTS (
              SELECT 1 FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type = 'rent'
                 AND p.status IN ('pending', 'processing')
                 AND p.period_start >= $2::date
                 AND p.period_start < $3::date
                 AND ${ledger}
            ) AS pending_this_month,
            (
              SELECT p.due_date
                FROM payments p
               WHERE p.lease_id = l.id
                 AND p.payment_type = 'rent'
                 AND p.status = 'pending'
                 AND p.period_start >= $2::date
                 AND p.period_start < $3::date
               ORDER BY p.created_at DESC
               LIMIT 1
            ) AS invoice_due_date,
            COALESCE((
              SELECT SUM(lf.amount)::numeric
                FROM late_fees lf
               WHERE lf.lease_id = l.id AND lf.status IN ('pending', 'applied')
            ), 0) AS late_fees_pending,
            COALESCE((
              SELECT MAX(lf.days_overdue)::int
                FROM late_fees lf
               WHERE lf.lease_id = l.id AND lf.status IN ('pending', 'applied')
            ), 0) AS max_days_overdue,
            (
              SELECT ba.link_status FROM bank_accounts ba
               WHERE ba.user_id = u.id AND ba.status <> 'revoked'
               ORDER BY ba.is_default DESC, ba.created_at DESC
               LIMIT 1
            ) AS bank_link_status
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
      WHERE un.property_id = ANY($1)
        AND u.role = 'tenant'
        AND l.start_date < $3::date
      ORDER BY u.last_name, u.first_name`,
    [propIds, monthStart, monthEnd]
  );
  return rows;
}

async function getRentStatusRoster(userId, role) {
  const propIds = await accessiblePropertyIds(userId, role);
  const { monthStart, monthEnd, monthLabel } = monthBounds();
  const raw = await queryRentRows(propIds, monthStart, monthEnd);
  const tenants = raw.map((r) => classifyRow(r, monthLabel));

  const collectionsRaw = await queryCollectionsRows(propIds);
  const collections = collectionsRaw.map(classifyCollectionsRow);

  const groups = {
    upToDate: tenants.filter((t) => t.status === 'up_to_date'),
    partial: tenants.filter((t) => t.status === 'partial'),
    late: tenants.filter((t) => t.status === 'late'),
    pending: tenants.filter((t) => t.status === 'pending'),
    due: tenants.filter((t) => t.status === 'due'),
    collections,
  };

  const emailCount =
    tenants.filter((t) => t.shouldEmail).length
    + collections.filter((t) => t.shouldEmail).length;

  return {
    monthLabel,
    tenants,
    collections,
    groups,
    summary: {
      total: tenants.length,
      up_to_date: groups.upToDate.length,
      partial: groups.partial.length,
      late: groups.late.length,
      pending: groups.pending.length,
      due: groups.due.length,
      collections: collections.length,
      email_count: emailCount,
      needs_relink: tenants.filter((t) => t.needsRelink).length,
    },
  };
}

module.exports = {
  getRentStatusRoster,
  monthBounds,
  classifyRow,
  classifyCollectionsRow,
  rentBalances,
  money,
};
