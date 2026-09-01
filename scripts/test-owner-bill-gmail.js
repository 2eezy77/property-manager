#!/usr/bin/env node
/**
 * Owner-bill Gmail worker: confirmations check off Owner Finance, not rent.
 * Run: npm run test:owner-bill-gmail
 */
const fs = require('fs');
const path = require('path');
const {
  parseOwnerBillEmail,
  decideOwnerBillApply,
  appendConfirmationNote,
} = require('../src/services/owner-bill-gmail-parser.service');
const { lastPaidAtForPostedPayment } = require('../src/services/owner-checklist.service');
const { norfolkDateKey } = require('../src/utils/norfolk-time');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const NEWREZ_SEP1 = {
  id: 'gmail-newrez-104800282',
  from: 'Newrez LLC <donotreply@newrez.com>',
  subject: 'Payment Confirmation',
  date: 'Tue, 1 Sep 2026 08:12:00 -0400',
  snippet: 'Your payment of $2,265.37 was posted.',
  body: [
    'Your payment of $2,265.37 was posted on 09/01/2026.',
    'Confirmation number: 104800282.',
    'Loan ending in 8062.',
  ].join(' '),
};

const VIVINT_PAID = {
  id: 'gmail-vivint-abc123',
  from: 'Vivint Smart Home <noreply@vivint.com>',
  subject: 'Thank you for your payment',
  date: 'Tue, 18 Aug 2026 10:00:00 -0400',
  snippet: 'We received your Vivint payment.',
  body: 'We received your payment of $110.00. Confirmation number: VIV-998877.',
};

const TMOBILE_PAID = {
  id: 'gmail-tmobile-987654',
  from: 'T-Mobile <noreply@t-mobile.com>',
  subject: 'Payment received',
  date: 'Tue, 18 Aug 2026 11:00:00 -0400',
  snippet: 'Thank you for your T-Mobile payment.',
  body: 'Thank you for your payment of $100.00. Confirmation number 987654321.',
};

const DOMINION_PAID = {
  id: 'gmail-dominion-4984922320',
  from: 'DoNotReplyDominionE <noreply@domenergyvanccc.com>',
  subject: 'Thank you for your payment',
  date: 'Fri, 30 May 2026 09:00:00 -0400',
  snippet: 'Confirmation number: 4984922320',
  body: 'Confirmation number: 4984922320. Payment date: May 30, 2026. Amount: 559.57',
};

const HRSD_PAID = {
  id: 'gmail-hrsd-paid-1',
  from: 'HRSD <noreply@hrsd.com>',
  subject: 'Payment confirmation',
  date: 'Mon, 4 Aug 2026 09:00:00 -0400',
  snippet: 'Thank you for your payment',
  body: 'Thank you for your payment of $165.74. Confirmation number: HRSD-441122.',
};

const NEWREZ_STATEMENT = {
  id: 'gmail-newrez-statement',
  from: 'Newrez LLC <donotreply@newrez.com>',
  subject: 'Your monthly mortgage statement is available',
  date: 'Sun, 3 May 2026 08:00:00 -0400',
  snippet: 'Your statement is ready to view.',
  body: 'Your monthly statement dated 05/03/2026 is available. Amount due $2,295.37.',
};

const DOMINION_BILL = {
  id: 'gmail-dominion-bill',
  from: 'Dominion Energy <Elec@domenergyvanc.com>',
  subject: 'Your bill is available',
  date: 'Mon, 19 May 2026 10:00:00 -0400',
  snippet: 'Amount Due: 744.21',
  body: 'Account #: 210005533430. Due Date: 06/15/2026. Amount Due: 744.21',
};

const AUTOPAY_UPCOMING = {
  id: 'gmail-hrsd-upcoming',
  from: 'HRSD <noreply@hrsd.com>',
  subject: 'Your HRSD Bill Is Due',
  date: 'Tue, 5 Aug 2026 12:00:00 -0400',
  snippet: 'You are enrolled in Auto Pay',
  body: 'You are enrolled in Auto Pay and $165.74 will be deducted from your account on due date, 08/04/2026.',
};

const CASHAPP_RENT = {
  id: 'gmail-cashapp-rent',
  from: 'Cash App <cash@square.com>',
  subject: 'Payment received',
  date: 'Tue, 1 Sep 2026 12:00:00 -0400',
  snippet: 'Stone paid you $950.00',
  body: 'Stone paid you $950.00 for September rent.',
};

const STRIPE_PAYOUT = {
  id: 'gmail-stripe-payout',
  from: 'Stripe <noreply@stripe.com>',
  subject: 'Your Stripe payout is on the way',
  date: 'Tue, 1 Sep 2026 12:00:00 -0400',
  snippet: 'Payout of $1,200.00',
  body: 'A payout of $1,200.00 is on the way to your bank.',
};

const AMBIGUOUS = {
  id: 'gmail-mystery',
  from: 'Newsletter <hello@example.com>',
  subject: 'September update',
  date: 'Tue, 1 Sep 2026 12:00:00 -0400',
  snippet: 'Things are happening',
  body: 'Just a newsletter. No payment mentioned.',
};

const mortgageItem = { category: 'mortgage', due_day: 1, last_paid_at: null, last_verified_at: null };
const vivintItem = { category: 'vivint', due_day: null, last_paid_at: null, last_verified_at: null };

// --- category mapping ---
const newrez = parseOwnerBillEmail(NEWREZ_SEP1);
assert(newrez.kind === 'paid_confirmation', 'Newrez confirmation is paid_confirmation');
assert(newrez.category === 'mortgage', 'Newrez maps to mortgage');
assert(newrez.confirmation === '104800282', 'Newrez confirmation 104800282');
assert(newrez.gmailMessageId === 'gmail-newrez-104800282', 'Newrez keeps Gmail id');

const vivint = parseOwnerBillEmail(VIVINT_PAID);
assert(vivint.kind === 'paid_confirmation', 'Vivint confirmation is paid_confirmation');
assert(vivint.category === 'vivint', 'Vivint maps to vivint');

const tmobile = parseOwnerBillEmail(TMOBILE_PAID);
assert(tmobile.kind === 'paid_confirmation', 'T-Mobile confirmation is paid_confirmation');
assert(tmobile.category === 'tmobile', 'T-Mobile maps to tmobile');

const dominion = parseOwnerBillEmail(DOMINION_PAID);
assert(dominion.kind === 'paid_confirmation', 'Dominion thank-you is paid_confirmation');
assert(dominion.category === 'utilities', 'Dominion maps to utilities');

const hrsd = parseOwnerBillEmail(HRSD_PAID);
assert(hrsd.kind === 'paid_confirmation', 'HRSD confirmation is paid_confirmation');
assert(hrsd.category === 'utilities', 'HRSD maps to utilities');

// --- skip bills / ambiguous / out-of-scope ---
assert(parseOwnerBillEmail(NEWREZ_STATEMENT).kind !== 'paid_confirmation', 'Newrez statement is not a paid confirmation');
assert(parseOwnerBillEmail(DOMINION_BILL).kind !== 'paid_confirmation', 'Dominion bill is not marked paid');
assert(parseOwnerBillEmail(AUTOPAY_UPCOMING).kind !== 'paid_confirmation', 'Upcoming autopay is not marked paid');
assert(parseOwnerBillEmail(CASHAPP_RENT).kind !== 'paid_confirmation', 'Cash App rent is ignored');
assert(parseOwnerBillEmail(STRIPE_PAYOUT).kind !== 'paid_confirmation', 'Stripe payout is ignored');
assert(parseOwnerBillEmail(AMBIGUOUS).kind !== 'paid_confirmation', 'Ambiguous mail is not marked paid');

const skipBill = decideOwnerBillApply({
  parsed: parseOwnerBillEmail(DOMINION_BILL),
  item: { category: 'utilities', due_day: null },
  existingByGmailId: new Set(),
  existingByConfirmation: new Set(),
});
assert(skipBill.action === 'skip', 'Dominion bill decide → skip');
assert(skipBill.reason, 'skip has a reason');

const skipAmbiguous = decideOwnerBillApply({
  parsed: parseOwnerBillEmail(AMBIGUOUS),
  item: mortgageItem,
  existingByGmailId: new Set(),
  existingByConfirmation: new Set(),
});
assert(skipAmbiguous.action === 'skip', 'ambiguous decide → skip');

// --- Newrez Sep 1 posting does not mark September ---
const sep1Decision = decideOwnerBillApply({
  parsed: newrez,
  item: mortgageItem,
  existingByGmailId: new Set(),
  existingByConfirmation: new Set(),
});
assert(sep1Decision.action === 'apply', 'Newrez Sep 1 confirmation applies');
assert(sep1Decision.patch.last_paid_at, 'apply sets last_paid_at');
assert(sep1Decision.patch.last_verified_at, 'confirmation sets last_verified_at');
assert(sep1Decision.patch.amount_estimate === undefined, 'do not invent/write amount_estimate');

const attributedKey = norfolkDateKey(sep1Decision.patch.last_paid_at);
assert(attributedKey === '2026-08-31', `Sep 1 Newrez last_paid_at Norfolk is Aug 31, got ${attributedKey}`);
assert(!attributedKey.startsWith('2026-09'), 'Sep 1 Newrez posting does not mark September paid');
assert(attributedKey.startsWith('2026-08'), 'covered month on last_paid_at is August');

const viaHelper = lastPaidAtForPostedPayment(mortgageItem, newrez.postedAt);
assert(norfolkDateKey(viaHelper) === '2026-08-31', 'lastPaidAtForPostedPayment used for mortgage due_day 1');

const vivintSep1 = decideOwnerBillApply({
  parsed: {
    ...vivint,
    postedAt: new Date('2026-09-01T12:00:00-04:00'),
  },
  item: vivintItem,
  existingByGmailId: new Set(),
  existingByConfirmation: new Set(),
});
assert(
  norfolkDateKey(vivintSep1.patch.last_paid_at) === '2026-09-01',
  'non-mortgage Sep 1 confirmation stays September'
);

// --- duplicate Gmail / confirmation skipped ---
const dupGmail = decideOwnerBillApply({
  parsed: newrez,
  item: mortgageItem,
  existingByGmailId: new Set(['gmail-newrez-104800282']),
  existingByConfirmation: new Set(),
});
assert(dupGmail.action === 'skip', 'duplicate Gmail id is skipped');
assert(dupGmail.reason === 'duplicate_gmail', `duplicate gmail reason, got ${dupGmail.reason}`);

const dupConf = decideOwnerBillApply({
  parsed: { ...newrez, gmailMessageId: 'gmail-newrez-forwarded-copy' },
  item: mortgageItem,
  existingByGmailId: new Set(),
  existingByConfirmation: new Set(['mortgage:104800282']),
});
assert(dupConf.action === 'skip', 'duplicate confirmation is skipped');
assert(dupConf.reason === 'duplicate_confirmation', `duplicate conf reason, got ${dupConf.reason}`);

// --- notes are additive and do not invent amounts when none parsed ---
const noAmount = {
  ...newrez,
  amount: null,
};
const note = appendConfirmationNote(
  '743 A Ave — ~$2,265.37/mo; check Newrez dashboard for escrow adjustments.',
  noAmount
);
assert(note.includes('104800282'), 'note keeps confirmation');
assert(note.includes('gmail-newrez-104800282') || note.includes('104800282'), 'note stores enough to skip later');
assert(!/posted \$/.test(note.split('\n').pop()), 'no invented dollar amount in appended note when amount missing');

const alreadyNoted = appendConfirmationNote(
  'Newrez posted $2,265.37 on 2026-09-01 (conf 104800282, loan ending 8062) covering August 2026 — not September.',
  newrez
);
assert(
  (alreadyNoted.match(/104800282/g) || []).length === 1,
  'existing confirmation note is not duplicated'
);

// --- do not rewind a later last_paid_at ---
const laterPaid = decideOwnerBillApply({
  parsed: newrez,
  item: {
    ...mortgageItem,
    last_paid_at: new Date('2026-10-01T12:00:00-04:00'),
    last_verified_at: new Date('2026-10-01T12:00:00-04:00'),
  },
  existingByGmailId: new Set(),
  existingByConfirmation: new Set(),
});
assert(laterPaid.action === 'apply', 'still record the Gmail import when dates are already newer');
assert(laterPaid.patch.last_paid_at === undefined, 'do not rewind last_paid_at from a later date');
assert(laterPaid.patch.last_verified_at === undefined, 'do not rewind last_verified_at from a later date');

const appJs = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
assert(
  appJs.includes('scheduleOwnerBillGmailSync'),
  'API process schedules the owner-bill Gmail worker'
);
assert(
  appJs.includes('OWNER_BILL_GMAIL_SYNC_ENABLED'),
  'owner-bill scheduler is gated by OWNER_BILL_GMAIL_SYNC_ENABLED'
);

const migration = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/049_owner_bill_gmail_imports.sql'),
  'utf8'
);
assert(migration.includes('owner_bill_gmail_imports'), 'migration creates owner_bill_gmail_imports');
assert(migration.includes('gmail_message_id'), 'migration stores Gmail message id');
assert(migration.includes('confirmation'), 'migration stores confirmation number');

const applySrc = fs.readFileSync(
  path.join(__dirname, '../src/services/owner-bill-gmail.service.js'),
  'utf8'
);
assert(applySrc.includes('updateChecklistItem'), 'apply path uses existing checklist update');
assert(!applySrc.includes('createPaymentIntent'), 'owner-bill worker does not create Stripe charges');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll owner-bill Gmail checks passed.');
