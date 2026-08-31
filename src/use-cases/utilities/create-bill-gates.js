/** Pure validation for UC01 create-bill (no DB). */

const { useCaseError } = require('./errors');

/**
 * Assert required create-bill body fields and a positive total.
 * @returns {object} normalized fields used by executeCreateBill
 */
function assertCreateBillParams(body = {}) {
  const {
    property_id,
    service_type,
    period_start,
    period_end,
    total_amount,
    due_date,
    provider_name,
    notes,
    bill_document_url,
  } = body;

  if (
    !property_id
    || !service_type
    || !period_start
    || !period_end
    || !total_amount
    || !due_date
  ) {
    throw useCaseError(
      'MISSING_PARAMS',
      'property_id, service_type, period_start, period_end, total_amount, due_date are required.'
    );
  }
  if (Number(total_amount) <= 0) {
    throw useCaseError('INVALID_AMOUNT', 'total_amount must be positive.');
  }

  return {
    property_id,
    service_type,
    period_start,
    period_end,
    total_amount,
    due_date,
    provider_name,
    notes,
    bill_document_url,
  };
}

/**
 * Assert a utility bill may be deleted (draft only, accessible property).
 */
function assertDraftBillDeletable({ bill, accessiblePropertyIds = [] } = {}) {
  if (!bill || !accessiblePropertyIds.includes(bill.property_id)) {
    throw useCaseError('NOT_FOUND', 'Bill not found.');
  }
  if (bill.status !== 'draft') {
    throw useCaseError('INVALID_STATE', 'Only draft bills can be deleted.');
  }
  return true;
}

module.exports = {
  assertCreateBillParams,
  assertDraftBillDeletable,
};
