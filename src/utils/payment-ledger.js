/**
 * Which payment rows appear in tenant/manager ledgers and rent stats.
 * Excludes smoke-test metadata, archived former-tenant rows, pre-production Stripe
 * sandbox debits, and failed attempts that were superseded by a successful payment
 * for the same lease + payment_type + billing month (any method: ACH, card, Cash App, etc.).
 */

function billingMonthExpr(alias = 'p') {
  return `date_trunc('month', COALESCE(${alias}.period_start, ${alias}.due_date, ${alias}.paid_at, ${alias}.created_at))`;
}

/** True when a succeeded payment exists for the same lease/type/billing month. */
function succeededSamePeriodExists(alias = 'p') {
  return `EXISTS (
    SELECT 1
      FROM payments s
     WHERE s.lease_id = ${alias}.lease_id
       AND s.payment_type = ${alias}.payment_type
       AND s.status = 'succeeded'
       AND COALESCE(s.metadata->>'archived_former_tenant', '') <> 'true'
       AND COALESCE(s.metadata->>'test', '') = ''
       AND ${billingMonthExpr('s')} = ${billingMonthExpr(alias)}
  )`;
}

/**
 * Hide failed rows once any success exists for that bill period — method does not matter.
 * (Failed ACH → later Cash App, failed Cash App import → later card, etc.)
 */
function notSupersededFailedWhere(alias = 'p') {
  return `NOT (
    ${alias}.status = 'failed'
    AND ${succeededSamePeriodExists(alias)}
  )`;
}

function ledgerPaymentWhere(alias = 'p') {
  return `COALESCE(${alias}.metadata->>'test', '') = ''
    AND COALESCE(${alias}.metadata->>'qa_late_fee', '') = ''
    AND COALESCE(${alias}.metadata->>'archived_former_tenant', '') <> 'true'
    AND ${notSupersededFailedWhere(alias)}
    AND (
      COALESCE(${alias}.metadata->>'source', '') IN ('cash_app_import', 'stripe_cashapp', 'manual', 'stripe_card')
      OR (
        ${alias}.stripe_payment_intent_id IS NOT NULL
        AND ${alias}.status IN ('succeeded', 'processing', 'pending')
      )
    )`;
}

/** Former tenants archived out of live payments/collections (kept in archive/rent-by-month). */
function notArchivedFormerTenantWhere(alias = 'p') {
  return `COALESCE(${alias}.metadata->>'archived_former_tenant', '') <> 'true'`;
}

function billingMonthKey(row) {
  const raw = row.period_start || row.due_date || row.paid_at || row.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Pure helper mirroring notSupersededFailedWhere for unit tests / client filters.
 * Failed rows disappear when any succeeded payment exists for the same lease,
 * payment_type, and billing month — regardless of payment method/source.
 */
function isFailedSupersededBySuccess(failed, payments) {
  if (!failed || failed.status !== 'failed') return false;
  const month = billingMonthKey(failed);
  if (!month) return false;
  return (payments || []).some((p) => (
    p
    && p.status === 'succeeded'
    && p.lease_id === failed.lease_id
    && p.payment_type === failed.payment_type
    && billingMonthKey(p) === month
    && !(p.metadata && (p.metadata.archived_former_tenant === true || p.metadata.archived_former_tenant === 'true'))
    && !(p.metadata && p.metadata.test)
  ));
}

module.exports = {
  ledgerPaymentWhere,
  notArchivedFormerTenantWhere,
  notSupersededFailedWhere,
  succeededSamePeriodExists,
  isFailedSupersededBySuccess,
  billingMonthKey,
};
