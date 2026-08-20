#!/usr/bin/env node
/**
 * Regression: flexible-pay leases (Stone: late_fee_amount=0, grace≥28) must not
 * surface as Late / shouldEmail on Manager rent roster when a balance remains.
 */
const assert = require('assert');
const { classifyRow, rentBalances } = require('../src/services/rent-status.service');

const monthLabel = 'August 2026';

function baseRow(overrides = {}) {
  return {
    tenant_id: 't1',
    name: 'Buckley Stone',
    email: 'stone@example.com',
    unit_number: '1',
    monthly_rent: 900,
    paid_amount_this_month: 0,
    pending_amount_this_month: 0,
    late_fees_pending: 0,
    late_fee_amount: 75,
    grace_period_days: 5,
    max_days_overdue: 0,
    invoice_due_date: '2026-08-01',
    bank_link_status: null,
    payment_methods: null,
    pending_this_month: false,
    failed_this_month: false,
    ...overrides,
  };
}

{
  const bal = rentBalances(baseRow({ paid_amount_this_month: 450 }));
  assert.strictEqual(bal.hasPartial, true);
  assert.strictEqual(bal.remaining, 450);
}

{
  // Stone-style: unpaid after typical grace — still Due soon, never Late/email.
  const row = classifyRow(
    baseRow({
      late_fee_amount: 0,
      grace_period_days: 31,
      max_days_overdue: 10,
      invoice_due_date: '2020-01-01',
    }),
    monthLabel
  );
  assert.strictEqual(row.status, 'due', 'flexible unpaid stays due, not late');
  assert.strictEqual(row.shouldEmail, false);
  assert.ok(String(row.detail).includes('grace'));
}

{
  const row = classifyRow(
    baseRow({
      name: 'Buckley Stone',
      late_fee_amount: 0,
      grace_period_days: 31,
      paid_amount_this_month: 450,
      max_days_overdue: 12,
      invoice_due_date: '2020-01-01',
    }),
    monthLabel
  );
  assert.strictEqual(row.status, 'partial');
  assert.strictEqual(row.shouldEmail, false);
  assert.ok(String(row.detail).includes('flexible pay'));
}

{
  // Ordinary lease with overdue balance → Late + email.
  const row = classifyRow(
    baseRow({
      name: 'Isaiah Reese',
      paid_amount_this_month: 450,
      max_days_overdue: 8,
      invoice_due_date: '2020-01-01',
    }),
    monthLabel
  );
  assert.strictEqual(row.status, 'late');
  assert.strictEqual(row.shouldEmail, true);
}

{
  // Flexible lease only becomes late if a late fee row actually exists.
  const row = classifyRow(
    baseRow({
      late_fee_amount: 0,
      grace_period_days: 31,
      paid_amount_this_month: 200,
      late_fees_pending: 50,
      max_days_overdue: 20,
    }),
    monthLabel
  );
  assert.strictEqual(row.status, 'late');
  assert.strictEqual(row.shouldEmail, true);
}

console.log('test-rent-status-classify: ok');
