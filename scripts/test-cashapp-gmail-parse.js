#!/usr/bin/env node
/**
 * Unit checks for Cash App Gmail "Payment received" parsing.
 * Run: node scripts/test-cashapp-gmail-parse.js
 *
 * Requires DATABASE_URL only because the service module loads the pool;
 * no queries run.
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/db';

const {
  parsePaymentText,
  parsePaymentEmail,
} = require('../src/services/cashapp-gmail.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const rent = parsePaymentText(
  'Buckley Stone paid you $450.00',
  'Buckley Stone paid you $450.00 for August rent. View details'
);
assert(rent?.sender === 'Buckley Stone', 'parses sender from Payment received text');
assert(rent?.amount === 450, 'parses dollar amount');
assert(rent?.notes === 'August rent', 'parses for-notes before View');

const comma = parsePaymentText('Lily Fortman paid you $1,200.50', '');
assert(comma?.amount === 1200.5, 'parses comma-formatted amounts');

assert(parsePaymentText('Thanks for using Cash App', '') === null, 'rejects non-payment snippets');
assert(parsePaymentText('Someone paid you $0.00', '') === null, 'rejects zero amounts');
assert(parsePaymentText('', '') === null, 'rejects empty bodies');

const aliased = parsePaymentEmail({
  id: 'msg-stone',
  snippet: 'Buckley Stone paid you $900.00',
  body: 'Buckley Stone paid you $900.00 for rent. View',
  date: 'Tue, 18 Aug 2026 10:15:00 -0400',
});
assert(aliased?.transactionId === 'gmail:msg-stone', 'transaction id is gmail:messageId');
assert(aliased?.amount === 900, 'email amount is 900');
assert(aliased?.senderKey === 'stone', 'Buckley Stone aliases to stone');
assert(aliased?.dateIso === '2026-08-18', 'dateIso is YYYY-MM-DD from header');
assert(aliased?.notes === 'rent', 'notes keep rent label');

const isaiah = parsePaymentEmail({
  id: 'msg-isaiah',
  snippet: 'Isaiah Reese paid you $450',
  body: 'Isaiah Reese paid you $450 for biweekly.',
  date: '2026-07-01T16:00:00.000Z',
});
assert(isaiah?.senderKey === 'isaiah', 'Isaiah Reese aliases to isaiah');

assert(
  parsePaymentEmail({
    id: 'bad-date',
    snippet: 'Osanin Murillo paid you $900',
    body: 'Osanin Murillo paid you $900 for rent.',
    date: 'not-a-date',
  }) === null,
  'rejects unparseable Date headers'
);

assert(
  parsePaymentEmail({
    id: 'no-pay',
    snippet: 'Your Cash App statement is ready',
    body: '',
    date: 'Tue, 18 Aug 2026 10:15:00 -0400',
  }) === null,
  'rejects non-payment emails'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll cashapp-gmail-parse checks passed.');
