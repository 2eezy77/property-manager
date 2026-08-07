#!/usr/bin/env node
/** Regression checks for utility Gmail parsing. */
const { parseUtilityEmail } = require('../src/services/utility-email-parser.service');

const cases = [
  {
    name: 'Dominion bill — current charges vs amount due',
    msg: {
      id: '1a',
      from: 'Dominion Energy <Elec@domenergyvanc.com>',
      subject: 'Your bill is available',
      date: 'Mon, 19 May 2026 10:00:00 -0400',
      body: 'Account #: 210005533430. Billing period 04/15/2026 to 05/14/2026. Current Charges: $184.64. Amount Due: 744.21',
    },
    expectOk: true,
    amount: 184.64,
    tenantCharge: 184.64,
    statementBalance: 744.21,
    amountSource: 'current_charges',
    service: 'electric',
  },
  {
    name: 'Dominion bill available — amount due only',
    msg: {
      id: '1',
      from: 'Dominion Energy <Elec@domenergyvanc.com>',
      subject: 'Your bill is available',
      date: 'Mon, 19 May 2026 10:00:00 -0400',
      body: 'Account #: 210005533430. Due Date: 06/15/2026. Amount Due: 744.21',
    },
    expectOk: true,
    amount: 744.21,
    tenantCharge: 744.21,
    amountSource: 'amount_due_fallback',
    expectWarning: true,
    service: 'electric',
  },
  {
    name: 'Dominion payment thanks (skip)',
    msg: {
      id: '2',
      from: 'DoNotReplyDominionE <noreply@domenergyvanccc.com>',
      subject: 'Thank you for your payment',
      date: 'Fri, 30 May 2026 09:00:00 -0400',
      body: 'Confirmation number: 4984922320. Payment date: May 30, 2026. Amount: 559.57',
    },
    expectOk: false,
  },
  {
    name: 'Norfolk InvoiceCloud invoice',
    msg: {
      id: '3',
      from: 'City of Norfolk <no-reply@invoicecloud.net>',
      subject: 'City of Norfolk Invoice# 1055175-PP-13774351 Reminder',
      date: 'Tue, 02 Jun 2026 15:57:00 -0400',
      body: 'Account Number: PP-1055175 Invoice Number: 1055175-PP-13774351 Payment Date: 6/5/2026 Balance Due: $387.81 Service Fee: $2.95 Total Amount: $390.76',
    },
    expectOk: true,
    amount: 390.76,
    service: 'water',
    acct: 'PP-1055175',
  },
  {
    name: 'HRSD / Norfolk portal billing period + due date',
    msg: {
      id: 'hrsd-portal',
      from: 'HRSD <noreply@hrsd.com>',
      subject: 'Your HRSD Bill Is Due',
      date: 'Tue, 05 Aug 2026 12:00:00 -0400',
      body: [
        'Welcome, Jose Montero',
        '3491396160: 743 A AVE NORFOLK, VA 23504',
        'Your Billing Period: 06/06/2026 - 07/09/2026',
        'Total Amount Due $165.74',
        'You are enrolled in Auto Pay and $165.74 will be deducted from your account on due date, 08/04/2026.',
      ].join('\n'),
    },
    expectOk: true,
    amount: 165.74,
    service: 'water',
    periodStart: '2026-06-06',
    periodEnd: '2026-07-09',
    dueDate: '2026-08-04',
    periodParsed: true,
  },
  {
    name: 'Dominion disconnection (skip)',
    msg: {
      id: '4',
      from: 'Dominion Energy <customer.supportcc@domenergyvanccc.com>',
      subject: 'Your Account is Subject to Disconnection',
      date: 'Sat, 30 May 2026 09:14:00 -0400',
      body: 'past due balance account ending in 3430',
    },
    expectOk: false,
  },
];

let failed = 0;
for (const c of cases) {
  const r = parseUtilityEmail(c.msg);
  const ok = r.ok === c.expectOk;
  const amtOk = c.amount == null || r.total_amount === c.amount;
  const tenantOk = c.tenantCharge == null || r.tenant_charge_amount === c.tenantCharge;
  const stmtOk = c.statementBalance == null || r.statement_balance === c.statementBalance;
  const srcOk = c.amountSource == null || r.amount_source === c.amountSource;
  const warnOk = c.expectWarning == null
    || (c.expectWarning ? (r.parse_warnings?.length > 0) : true);
  const svcOk = c.service == null || r.service_type === c.service;
  const acctOk = c.acct == null || r.account_number === c.acct;
  const psOk = c.periodStart == null || r.period_start === c.periodStart;
  const peOk = c.periodEnd == null || r.period_end === c.periodEnd;
  const dueOk = c.dueDate == null || r.due_date === c.dueDate;
  const parsedOk = c.periodParsed == null || r.period_parsed === c.periodParsed;
  if (ok && amtOk && tenantOk && stmtOk && srcOk && warnOk && svcOk && acctOk && psOk && peOk && dueOk && parsedOk) {
    console.log(`  ✓ ${c.name}`);
  } else {
    failed++;
    console.log(`  ✗ ${c.name}`, {
      ok: r.ok,
      total_amount: r.total_amount,
      period_start: r.period_start,
      period_end: r.period_end,
      due_date: r.due_date,
      period_parsed: r.period_parsed,
      reason: r.reason,
    });
  }
}

{
  const { defaultPeriodFromMessage } = require('../src/services/utility-email-parser.service');
  const fb = defaultPeriodFromMessage('2026-08-05');
  if (fb.period_start === '2026-07-01' && fb.period_end === '2026-07-31') {
    console.log('  ✓ defaultPeriodFromMessage uses previous calendar month');
  } else {
    failed++;
    console.log('  ✗ defaultPeriodFromMessage', fb);
  }
}

const { accountsMatch } = require('../src/use-cases/utilities/domain');
if (!accountsMatch('210005533430', '3430')) {
  failed++;
  console.log('  ✗ accountsMatch suffix 3430');
} else {
  console.log('  ✓ accountsMatch Dominion suffix');
}
if (!accountsMatch('1055175', 'PP-1055175')) {
  failed++;
  console.log('  ✗ accountsMatch norfolk PP');
} else {
  console.log('  ✓ accountsMatch Norfolk PP-1055175');
}

process.exit(failed ? 1 : 0);
