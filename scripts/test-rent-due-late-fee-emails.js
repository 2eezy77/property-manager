#!/usr/bin/env node
/**
 * Rent due / overdue / late-fee notice emails: grace defaults, due dates,
 * HTML escaping for tenant names.
 *
 * Run: npm run test:rent-due-late-fee-emails
 */
'use strict';

const rentDue = require('../src/services/email-templates/rentDue');
const rentOverdue = require('../src/services/email-templates/rentOverdue');
const lateFeeApplied = require('../src/services/email-templates/lateFeeApplied');
const lateFeeAppliedStaff = require('../src/services/email-templates/lateFeeAppliedStaff');
const { BRAND } = require('../src/services/email-templates/brand');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

{
  const r = rentDue.render({
    tenantName: 'Ada <script>',
    amount: 900,
    unitLabel: 'Unit 4',
    propertyName: '743 A Ave',
    dueDate: '2026-08-01',
  });
  check(/Rent of \$900\.00 for Unit 4 at 743 A Ave is due on August 1, 2026/i.test(r.text),
    'rent due text includes amount, unit, property, due date');
  check(r.html.includes('&lt;script&gt;'), 'rent due escapes tenant HTML');
  check(!r.html.includes('<script>'), 'rent due HTML has no raw script tag');
  check(/Pay rent online/i.test(r.html), 'rent due CTA is Pay rent online');
  check(r.html.includes(BRAND.paymentsUrl), 'rent due CTA uses tenant payments URL');
}

{
  const r = rentDue.render({
    tenantName: 'Lily',
    amount: 900,
    unitLabel: 'Unit 1',
    propertyName: '743 A Ave',
    dueDate: null,
  });
  check(/due on this month/i.test(r.text), 'rent due without date falls back to "this month"');
}

{
  const r = rentOverdue.render({
    tenantName: 'Isaiah <x>',
    amount: 900,
    dueDate: '2026-07-01',
  });
  check(/was due on July 1, 2026/i.test(r.text), 'overdue text includes due date');
  check(/5-day grace period/i.test(r.text), 'overdue defaults to 5-day grace');
  check(r.html.includes('&lt;x&gt;'), 'overdue escapes tenant HTML');
  check(/Pay now/i.test(r.html), 'overdue CTA is Pay now');
}

{
  const r = rentOverdue.render({
    tenantName: 'Stone',
    amount: 900,
    dueDate: '2026-08-01',
    gracePeriodDays: 31,
  });
  check(/31-day grace period/i.test(r.text), 'overdue respects flexible 31-day grace');
  check(r.html.includes('31-day'), 'overdue HTML mentions 31-day grace');
}

{
  const r = lateFeeApplied.render({
    tenantName: 'Ada <script>',
    amount: 50,
    unitLabel: 'Unit 2',
    propertyName: '743 A Ave',
    daysOverdue: 9,
  });
  check(/late fee of \$50\.00/i.test(r.text), 'late fee text includes amount');
  check(/5-day grace period \(9 days overdue\)/i.test(r.text),
    'late fee defaults grace to 5 and includes days overdue');
  check(r.html.includes('&lt;script&gt;'), 'late fee escapes tenant HTML');
  check(/View balance &amp; pay|View balance & pay/i.test(r.html), 'late fee CTA present');
}

{
  const r = lateFeeApplied.render({
    tenantName: 'Stone',
    amount: 0,
    unitLabel: 'Unit 2',
    propertyName: '743 A Ave',
    daysOverdue: 2,
    gracePeriodDays: 31,
  });
  check(/31-day grace period \(2 days overdue\)/i.test(r.text),
    'late fee respects custom grace (flexible pay)');
}

{
  const r = lateFeeAppliedStaff.render({
    tenantName: 'Lily <b>',
    tenantEmail: 'lily@example.com',
    amount: 50,
    unitLabel: 'Unit 4',
    daysOverdue: 8,
    paymentId: 'pay-1',
  });
  check(/Late fee \$50\.00 applied for Lily <b>/i.test(r.text), 'staff late fee text');
  check(r.html.includes('&lt;b&gt;'), 'staff late fee escapes tenant HTML');
  check(r.html.includes(BRAND.paymentsUrl.replace('/tenant/', '/manager/')),
    'staff late fee CTA points at manager portal');
  check(r.html.includes('pay-1'), 'staff late fee includes invoice id');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll rent-due-late-fee-emails checks passed.');
