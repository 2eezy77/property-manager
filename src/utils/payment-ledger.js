/**
 * Which payment rows appear in tenant/manager ledgers and rent stats.
 * Excludes smoke-test metadata, archived former-tenant rows, and pre-production Stripe sandbox debits.
 */
function ledgerPaymentWhere(alias = 'p') {
  return `COALESCE(${alias}.metadata->>'test', '') = ''
    AND COALESCE(${alias}.metadata->>'qa_late_fee', '') = ''
    AND COALESCE(${alias}.metadata->>'archived_former_tenant', '') <> 'true'
    AND (
      COALESCE(${alias}.metadata->>'source', '') IN ('cash_app_import', 'stripe_cashapp', 'manual')
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

module.exports = { ledgerPaymentWhere, notArchivedFormerTenantWhere };
