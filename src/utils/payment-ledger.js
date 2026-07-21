/**
 * Which payment rows appear in tenant/manager ledgers and rent stats.
 * Excludes smoke-test metadata and pre-production Stripe sandbox debits.
 */
function ledgerPaymentWhere(alias = 'p') {
  return `COALESCE(${alias}.metadata->>'test', '') = ''
    AND COALESCE(${alias}.metadata->>'qa_late_fee', '') = ''
    AND (
      COALESCE(${alias}.metadata->>'source', '') IN ('cash_app_import', 'stripe_cashapp', 'manual')
      OR (
        ${alias}.stripe_payment_intent_id IS NOT NULL
        AND ${alias}.status IN ('succeeded', 'processing', 'pending')
      )
    )`;
}

module.exports = { ledgerPaymentWhere };
