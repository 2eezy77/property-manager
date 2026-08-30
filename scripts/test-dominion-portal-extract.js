#!/usr/bin/env node
/**
 * Dominion portal extract normalize: Current Charges required, period from
 * statement_date + billing_days, archive PDF paths, money/day parsing.
 *
 * Run: npm run test:dominion-portal-extract
 */
'use strict';

const {
  money,
  day,
  normalizeDominionPortalExtract,
} = require('../src/utils/dominion-portal-extract');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(money('$293.69') === 293.69, 'money strips $');
check(money('1,234.50') === 1234.5, 'money strips commas');
check(money('') === null, 'money empty → null');
check(money(null) === null, 'money null → null');
check(day('2026-07-17T12:00:00.000Z') === '2026-07-17', 'day from ISO');
check(day('2026-07-17') === '2026-07-17', 'day from date-only');
check(day(null) === null, 'day null → null');

{
  let threw = false;
  try {
    normalizeDominionPortalExtract({
      total_amount_due: 731.7,
      statement_date: '2026-07-17',
      billing_days: 30,
      due_date: '2026-08-14',
    });
  } catch (e) {
    threw = /current_charges/i.test(e.message);
  }
  check(threw, 'rejects Total Amount Due alone (no current_charges)');
}

{
  const n = normalizeDominionPortalExtract({
    current_charges: 293.69,
    total_amount_due: 731.7,
    statement_date: '2026-07-17',
    billing_days: 30,
    due_date: '2026-08-14',
    pdf_path: 'archive/utilities/dominion-bills/2026-07.pdf',
    account_number: 'ACCT-1',
  });
  check(n.current_charges === 293.69, `tenant charge is current charges, got ${n.current_charges}`);
  check(n.statement_balance === 731.7, `statement balance preserved, got ${n.statement_balance}`);
  check(n.amount_source === 'current_charges', `amount_source current_charges, got ${n.amount_source}`);
  check(n.period_end === '2026-07-17', `period_end from statement, got ${n.period_end}`);
  check(n.period_start === '2026-06-18', `period_start = statement − (billing_days−1), got ${n.period_start}`);
  check(n.due_date === '2026-08-14', `due_date preserved, got ${n.due_date}`);
  check(n.bill_document_url === 'archive:archive/utilities/dominion-bills/2026-07.pdf',
    `archive-relative PDF URL, got ${n.bill_document_url}`);
  check(n.account_number === 'ACCT-1', 'account_number preserved');
}

{
  const n = normalizeDominionPortalExtract({
    currentCharges: '184.64',
    period_start: '2026-05-15',
    period_end: '2026-06-14',
    amount_due: 700,
  });
  check(n.current_charges === 184.64, 'camelCase currentCharges accepted');
  check(n.period_start === '2026-05-15' && n.period_end === '2026-06-14',
    'explicit period preserved without statement_date');
  check(n.due_date === '2026-06-14', 'due_date defaults to period_end');
  check(n.statement_balance === 700, 'amount_due alias maps to statement_balance');
}

{
  let threw = false;
  try {
    normalizeDominionPortalExtract({
      current_charges: 100,
      // no period / statement
    });
  } catch (e) {
    threw = /period_start|statement_date/i.test(e.message);
  }
  check(threw, 'rejects when period cannot be derived');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll dominion-portal-extract checks passed.');
