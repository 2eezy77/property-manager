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
  wouldRewriteMortgageLastPaidAt,
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

assert(wouldRewriteMortgageLastPaidAt(null) === true, 'null last_paid_at is rewritten to Aug 31');
assert(
  wouldRewriteMortgageLastPaidAt('2026-09-01T12:00:00-04:00') === true,
  'Sep 1 last_paid_at looks like the Newrez posting and is rewritten'
);
assert(
  wouldRewriteMortgageLastPaidAt('2026-08-31T12:00:00-04:00') === false,
  'already-Aug-31 last_paid_at is left alone'
);
assert(
  wouldRewriteMortgageLastPaidAt('2026-09-15T12:00:00-04:00') === false,
  'mid-September last_paid_at is not rewound to August'
);
assert(
  wouldRewriteMortgageLastPaidAt('2026-10-01T12:00:00-04:00') === false,
  'later last_paid_at is never written backward'
);
assert(
  wouldRewriteMortgageLastPaidAt('2026-07-15T12:00:00-04:00') === false,
  'earlier last_paid_at is not treated as the Sep 1 posting'
);

const migration = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/048_newrez_august_2026_paid.sql'),
  'utf8'
);
assert(migration.includes('2026-08-31 12:00:00-04'), 'migration records Aug 31 noon ET');
assert(migration.includes('2,265.37'), 'migration amount $2,265.37');
assert(migration.includes('104800282'), 'migration confirmation');
assert(migration.includes('8062'), 'migration loan last4');
assert(migration.includes('August 2026'), 'migration names August 2026');
assert(
  !/last_paid_at\s*=\s*TIMESTAMPTZ\s+'2026-09-/.test(migration),
  'migration never assigns last_paid_at in September'
);
assert(
  !/IS DISTINCT FROM/i.test(migration),
  'migration does not match every non-Aug-31 timestamp'
);
assert(
  /last_paid_at <\s+TIMESTAMPTZ '2026-09-02 00:00:00-04'/.test(migration),
  'Sep 1 rewrite window has an exclusive upper bound of Sep 2'
);
assert(
  !/last_paid_at >= TIMESTAMPTZ '2026-09-01 00:00:00-04'\s*\n\s*AND last_paid_at < TIMESTAMPTZ '2026-10-01/.test(migration),
  'migration does not rewind all of September'
);
assert(
  (migration.match(/last_paid_at\s*=\s*TIMESTAMPTZ/g) || []).length === 1,
  'only one last_paid_at assignment (notes update does not touch it)'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll Newrez August-vs-September checks passed.');
