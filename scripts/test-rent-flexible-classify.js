#!/usr/bin/env node
/**
 * Regression: flexible-pay leases (Stone — late_fee_amount=0, grace≥28)
 * must not classify mid-month unpaid/partial rent as Late / email.
 *
 * Run: npm run test:rent-flexible-classify
 */
const { classifyRow } = require('../src/services/rent-status.service');

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

const stoneBase = {
  tenant_id: 'stone',
  name: 'Buckley Stone',
  email: 'stone@example.com',
  unit_number: '1',
  monthly_rent: 900,
  paid_amount_this_month: 0,
  pending_amount_this_month: 0,
  pending_this_month: false,
  failed_this_month: false,
  late_fees_pending: 0,
  late_fee_amount: 0,
  grace_period_days: 31,
  invoice_due_date: '2026-08-01',
  max_days_overdue: 7,
  bank_link_status: null,
  payment_methods: null,
};

const unpaid = classifyRow(stoneBase, 'August 2026');
assert('Stone unpaid is due (not late)', unpaid.status === 'due', unpaid);
assert('Stone unpaid shouldEmail false', unpaid.shouldEmail === false, unpaid);
assert('Stone unpaid statusLabel not Late', !String(unpaid.statusLabel).startsWith('Late'), unpaid);

const partial = classifyRow(
  {
    ...stoneBase,
    paid_amount_this_month: 400,
  },
  'August 2026'
);
assert('Stone partial status is partial', partial.status === 'partial', partial);
assert('Stone partial shouldEmail false', partial.shouldEmail === false, partial);
assert(
  'Stone partial mentions flexible pay',
  String(partial.detail).includes('flexible pay'),
  partial.detail
);

const standardLate = classifyRow(
  {
    ...stoneBase,
    late_fee_amount: 50,
    grace_period_days: 5,
    late_fees_pending: 50,
    max_days_overdue: 10,
  },
  'August 2026'
);
assert('standard overdue is late', standardLate.status === 'late', standardLate);
assert('standard overdue shouldEmail', standardLate.shouldEmail === true, standardLate);

const archivedStylePaid = classifyRow(
  {
    ...stoneBase,
    paid_amount_this_month: 900,
    max_days_overdue: 0,
  },
  'August 2026'
);
assert('fully paid up_to_date', archivedStylePaid.status === 'up_to_date', archivedStylePaid);

process.exit(failed ? 1 : 0);
