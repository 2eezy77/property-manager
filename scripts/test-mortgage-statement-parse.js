#!/usr/bin/env node
/**
 * Unit checks for Newrez mortgage statement text parsing.
 * Pure parse only — no DB writes.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unit:test@127.0.0.1:5432/unit_test';

const { parseMortgageText } = require('../src/services/mortgage-statement.service');

let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

const sample = `
NEWREZ LLC
Account Number 1234567890
Property Address: 743 A Ave, Norfolk, VA 23504
Statement Date: 7/15/2026
Next Due Date 8/1/2026
Total Amount Due $1,842.33
Regular Monthly Payment $1,842.33
Outstanding Principal $287,450.12
Current Escrow Balance $2,104.55
Interest Rate 6.375%

Payment History
6/1/2026 Regular Payment $0.00 $1,842.33 $1,842.33
7/1/2026 Regular Payment $0.00 $1,842.33 $1,842.33
`.replace(/\n/g, '\r\n');

const parsed = parseMortgageText(sample, 'newrez-2026-07.pdf');

assert('statement_date ISO', parsed.statement_date === '2026-07-15', parsed.statement_date);
assert('due_date ISO', parsed.due_date === '2026-08-01', parsed.due_date);
assert('amount_due', parsed.amount_due === 1842.33, parsed.amount_due);
assert('monthly_payment', parsed.monthly_payment === 1842.33, parsed.monthly_payment);
assert('principal_balance', parsed.principal_balance === 287450.12, parsed.principal_balance);
assert('escrow_balance', parsed.escrow_balance === 2104.55, parsed.escrow_balance);
assert('interest_rate', parsed.interest_rate === 6.375, parsed.interest_rate);
assert('account_number', parsed.account_number === '1234567890', parsed.account_number);
assert('servicer Newrez', parsed.servicer === 'Newrez LLC', parsed.servicer);
assert('source_file', parsed.source_file === 'newrez-2026-07.pdf', parsed.source_file);
assert('last_payment_date', parsed.metadata.last_payment_date === '2026-07-01', parsed.metadata.last_payment_date);
assert('last_payment_amount', parsed.metadata.last_payment_amount === 1842.33, parsed.metadata.last_payment_amount);
assert(
  'property_hint',
  /743 A Ave/i.test(parsed.metadata.property_hint || ''),
  parsed.metadata.property_hint
);
assert('strips CR', !parsed.raw_text.includes('\r'), 'raw_text still has CR');

const amountDueOnly = parseMortgageText(`
Statement Date: 1/5/2026
Amount Due $900.00
Account Number 99
`);
assert('Amount Due fallback', amountDueOnly.amount_due === 900, amountDueOnly.amount_due);
assert('unknown servicer', amountDueOnly.servicer === null, amountDueOnly.servicer);

const empty = parseMortgageText('no mortgage fields here');
assert('missing statement_date', empty.statement_date === null);
assert('missing amounts', empty.amount_due === null && empty.monthly_payment === null);

const badDate = parseMortgageText('Statement Date: 2026-07-15\nTotal Amount Due $10.00');
assert('rejects non-US date', badDate.statement_date === null, badDate.statement_date);

process.exit(failed ? 1 : 0);
