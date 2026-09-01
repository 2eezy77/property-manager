#!/usr/bin/env node
/**
 * Newrez $2,265.37 posted 2026-09-01 covers August 2026, not September.
 * Run: npm run test:newrez-mortgage-month
 */
const fs = require('fs');
const path = require('path');
const {
  lastPaidAtForPostedPayment,
  NEWREZ_2026_09_01_POSTING,
  newrezAugust2026PaidNote,
} = require('../src/services/owner-checklist.service');
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

const mortgage = { category: 'mortgage', due_day: 1 };
const vivint = { category: 'vivint', due_day: null };
const sep1 = new Date('2026-09-01T12:00:00-04:00');
const sep15 = new Date('2026-09-15T12:00:00-04:00');
const jan1 = new Date('2027-01-01T12:00:00-04:00');

const attributed = lastPaidAtForPostedPayment(mortgage, sep1);
const attributedKey = norfolkDateKey(attributed);
const attributedIso = attributed.toISOString().slice(0, 10);

assert(NEWREZ_2026_09_01_POSTING.amount === 2265.37, 'amount stays $2,265.37');
assert(NEWREZ_2026_09_01_POSTING.confirmation === '104800282', 'confirmation 104800282');
assert(NEWREZ_2026_09_01_POSTING.loanLast4 === '8062', 'loan last4 8062');
assert(NEWREZ_2026_09_01_POSTING.postedOn === '2026-09-01', 'posted 2026-09-01');

const note = newrezAugust2026PaidNote();
assert(note.includes('$2,265.37'), 'note amount $2,265.37');
assert(note.includes('104800282'), 'note confirmation');
assert(note.includes('8062'), 'note loan last4');
assert(/August 2026/.test(note), 'note says August 2026');
assert(/not September/.test(note), 'note says not September');

assert(attributedKey === '2026-08-31', `Sep 1 posting → last_paid_at Norfolk ${attributedKey}`);
assert(attributedIso === '2026-08-31', `Sep 1 posting → UTC ISO date ${attributedIso} (not September)`);
assert(!attributedKey.startsWith('2026-09'), 'Sep 1 posting does not mark September paid');
assert(attributedKey.startsWith('2026-08'), 'covered month on last_paid_at is August');

assert(
  lastPaidAtForPostedPayment(mortgage, sep15).getTime() === sep15.getTime(),
  'mid-September mark-paid stays mid-September'
);
assert(
  lastPaidAtForPostedPayment(vivint, sep1).getTime() === sep1.getTime(),
  'non-mortgage Sep 1 mark-paid is unchanged'
);
assert(
  norfolkDateKey(lastPaidAtForPostedPayment(mortgage, jan1)) === '2026-12-31',
  'Jan 1 posting attributes to Dec 31 of prior year'
);

const migration = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/048_newrez_august_2026_paid.sql'),
  'utf8'
);
assert(migration.includes('2026-08-31'), 'migration sets last_paid_at on August 31');
assert(migration.includes('2,265.37'), 'migration amount $2,265.37');
assert(migration.includes('104800282'), 'migration confirmation');
assert(migration.includes('8062'), 'migration loan last4');
assert(migration.includes('August 2026'), 'migration names August 2026');
assert(
  !/last_paid_at\s*=\s*TIMESTAMPTZ\s+'2026-09-/.test(migration),
  'migration never assigns last_paid_at in September'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll Newrez August-vs-September checks passed.');
