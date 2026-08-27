/**
 * Pure API shape for manager lease-signing fee rows.
 * Payable only after the tenant has paid RENT_MONTHS_REQUIRED months of rent.
 */

const RENT_MONTHS_REQUIRED = 3;

function feeToJson(row) {
  if (!row) return null;
  const rentMonthsPaid = row.rent_months_paid ?? 0;
  return {
    id: row.id,
    orgId: row.org_id,
    managerId: row.manager_id,
    leaseId: row.lease_id,
    amountCents: row.amount_cents,
    amountDollars: row.amount_cents / 100,
    signedAt: row.signed_at,
    status: row.status,
    paymentMethod: row.payment_method,
    paidBy: row.paid_by,
    paidAt: row.paid_at,
    note: row.note,
    eligibleAt: row.eligible_at,
    rentMonthsPaid,
    rentMonthsRequired: RENT_MONTHS_REQUIRED,
    rentMonthsRemaining: Math.max(0, RENT_MONTHS_REQUIRED - rentMonthsPaid),
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    tenantName: row.tenant_name?.trim() || null,
    tenantEmail: row.tenant_email,
    unitNumber: row.unit_number,
    propertyName: row.property_name,
    leaseStart: row.start_date,
    leaseStatus: row.lease_status,
  };
}

module.exports = {
  RENT_MONTHS_REQUIRED,
  feeToJson,
};
