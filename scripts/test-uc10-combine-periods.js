#!/usr/bin/env node
/**
 * Unit checks for UC10 combine period-preservation helpers.
 */
const {
  isCalendarMonthPeriod,
  groupHasProviderPeriod,
} = require('../src/use-cases/utilities/uc10-combine-monthly');

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

assert(
  'calendar Jul is calendar',
  isCalendarMonthPeriod('2026-07-01', '2026-07-31')
);
assert(
  'HRSD mid-month is NOT calendar',
  !isCalendarMonthPeriod('2026-06-06', '2026-07-09')
);
assert(
  'Dominion cycle is NOT calendar',
  !isCalendarMonthPeriod('2026-06-17', '2026-07-16')
);
assert(
  'group with provider preserves',
  groupHasProviderPeriod([
    { period_start: '2026-07-01', period_end: '2026-07-31' },
    { period_start: '2026-06-06', period_end: '2026-07-09' },
  ])
);
assert(
  'all-calendar group does not preserve',
  !groupHasProviderPeriod([
    { period_start: '2026-07-01', period_end: '2026-07-31' },
  ])
);

process.exit(failed ? 1 : 0);
