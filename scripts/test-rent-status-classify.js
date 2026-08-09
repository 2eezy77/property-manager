#!/usr/bin/env node
/**
 * Regression: flexible-pay leases (Stone) must not flag Late / email mid-month.
 * Run: npm run test:rent-status-classify
 */
const assert = require('assert');
const { classifyRow } = require('../src/services/rent-status.service');

const monthLabel = 'August 2026';

function stoneBase(overrides = {}) {
  return {
    tenant_id: 'stone',
    name: 'Buckley Stone',
    email: 'buckleystone1@gmail.com',
    unit_number: '1',
    monthly_rent: 900,
    paid_amount_this_month: 0,
    pending_amount_this_month: 0,
    late_fees_pending: 0,
    late_fee_amount: 0,
    grace_period_days: 31,
    invoice_due_date: '2026-08-01',
    max_days_overdue: 8,
    payment_methods: null,
    bank_link_status: null,
    pending_this_month: false,
    failed_this_month: false,
    ...overrides,
  };
}

function standardBase(overrides = {}) {
  return stoneBase({
    tenant_id: 'std',
    name: 'Standard Tenant',
    late_fee_amount: 50,
    grace_period_days: 5,
    ...overrides,
  });
}

// Unpaid flexible lease past calendar due date → Due soon (not Late), no email
{
  const row = classifyRow(stoneBase(), monthLabel);
  assert.strictEqual(row.status, 'due');
  assert.strictEqual(row.shouldEmail, false);
  assert.ok(row.detail.includes('grace period'));
}

// Partial flexible lease → Partial, not Late, no email
{
  const row = classifyRow(
    stoneBase({ paid_amount_this_month: 450, payment_methods: 'Cash App' }),
    monthLabel
  );
  assert.strictEqual(row.status, 'partial');
  assert.strictEqual(row.shouldEmail, false);
  assert.ok(row.detail.includes('flexible pay'));
  assert.ok(row.detail.includes('450'));
}

// Fully paid flexible lease
{
  const row = classifyRow(stoneBase({ paid_amount_this_month: 900 }), monthLabel);
  assert.strictEqual(row.status, 'up_to_date');
  assert.strictEqual(row.shouldEmail, false);
}

// Standard unpaid + past grace → Late + email
{
  const row = classifyRow(
    standardBase({
      invoice_due_date: '2020-01-01',
      max_days_overdue: 10,
    }),
    monthLabel
  );
  assert.strictEqual(row.status, 'late');
  assert.strictEqual(row.shouldEmail, true);
}

// Standard unpaid still in grace → Due soon
{
  const row = classifyRow(
    standardBase({
      invoice_due_date: '2099-01-01',
      max_days_overdue: 0,
    }),
    monthLabel
  );
  assert.strictEqual(row.status, 'due');
  assert.strictEqual(row.shouldEmail, false);
}

// Flexible lease only becomes Late when a late fee row exists
{
  const row = classifyRow(
    stoneBase({ late_fees_pending: 50, paid_amount_this_month: 0 }),
    monthLabel
  );
  assert.strictEqual(row.status, 'late');
  assert.strictEqual(row.shouldEmail, true);
}

console.log('test-rent-status-classify: OK');
