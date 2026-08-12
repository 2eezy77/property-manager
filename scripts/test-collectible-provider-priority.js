#!/usr/bin/env node
/**
 * Regression: calendar-month water phantoms must not beat provider-period cycles.
 */
const {
  isCalendarMonthPeriod,
  pickLatestCollectibleBill,
  rankCollectibleBills,
} = require('../src/use-cases/utilities/period-utils');
const {
  isCalendarMonthPeriod: uc10Cal,
  groupHasProviderPeriod,
} = require('../src/use-cases/utilities/uc10-combine-monthly');
const {
  reopenSplitStatusForBill,
} = require('../src/use-cases/utilities/enforce-latest-collectible');

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

assert('uc10 re-export matches', uc10Cal('2026-08-01', '2026-08-31') === true);
assert('HRSD mid-month is provider', !isCalendarMonthPeriod('2026-06-06', '2026-07-09'));
assert('Aug calendar is phantom', isCalendarMonthPeriod('2026-08-01', '2026-08-31'));

const hrsd = {
  id: '8e9b',
  period_start: '2026-06-06',
  period_end: '2026-07-09',
  created_at: '2026-08-05T16:00:00Z',
};
const augPhantom = {
  id: 'd5375',
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  created_at: '2026-08-05T16:10:00Z',
};
const picked = pickLatestCollectibleBill([augPhantom, hrsd]);
assert('HRSD wins over later Aug calendar phantom', picked?.id === '8e9b', picked);

const laterProvider = {
  id: 'next',
  period_start: '2026-07-10',
  period_end: '2026-08-12',
  created_at: '2026-09-01T00:00:00Z',
};
assert(
  'newer provider cycle still wins',
  pickLatestCollectibleBill([hrsd, laterProvider])?.id === 'next'
);

const onlyCal = pickLatestCollectibleBill([
  { id: 'jul', period_start: '2026-07-01', period_end: '2026-07-31', created_at: '2026-07-01' },
  { id: 'aug', period_start: '2026-08-01', period_end: '2026-08-31', created_at: '2026-08-01' },
]);
assert('among calendar-only, newest period_end wins', onlyCal?.id === 'aug', onlyCal);

assert(
  'groupHasProviderPeriod',
  groupHasProviderPeriod([augPhantom, hrsd]) === true
);

const ranked = rankCollectibleBills([augPhantom, hrsd]);
assert('rank order provider first', ranked[0].id === '8e9b' && ranked[1].id === 'd5375');

assert(
  'reopen keeps notified splits notified',
  reopenSplitStatusForBill({ status: 'notified' }) === 'notified'
);
assert(
  'reopen draft/settled uses pending',
  reopenSplitStatusForBill({ status: 'draft' }) === 'pending' &&
    reopenSplitStatusForBill({ status: 'settled' }) === 'pending'
);

process.exit(failed ? 1 : 0);
