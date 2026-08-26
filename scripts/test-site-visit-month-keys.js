#!/usr/bin/env node
/**
 * Client visit month grouping keys (Norfolk TZ) + leftover detection edges.
 * Run: npm run test:site-visit-month-keys
 */
'use strict';

async function main() {
  const {
    visitMonthKey,
    monthLabelFromKey,
    visitIsLeftover,
  } = await import('../client/src/utils/siteVisitMonths.js');

  let failed = 0;
  function check(cond, msg) {
    if (!cond) {
      console.error('FAIL:', msg);
      failed += 1;
    } else {
      console.log('ok:', msg);
    }
  }

  check(visitMonthKey({}) === 'unknown', 'missing timestamps → unknown');
  check(
    visitMonthKey({ plannedVisitAt: '2026-06-15T16:00:00.000Z' }) === '2026-06',
    'plannedVisitAt drives month key'
  );
  // 2026-07-01 03:30Z = 2026-06-30 23:30 EDT → June
  check(
    visitMonthKey({ visitedAt: '2026-07-01T03:30:00.000Z' }) === '2026-06',
    'UTC near month boundary maps to prior Norfolk month'
  );
  // 2026-07-01 04:30Z = 2026-07-01 00:30 EDT → July
  check(
    visitMonthKey({ visitedAt: '2026-07-01T04:30:00.000Z' }) === '2026-07',
    'after midnight Norfolk lands in July'
  );
  check(monthLabelFromKey('2026-06') === 'June 2026', 'month label');
  check(monthLabelFromKey('unknown') === 'Unknown month', 'unknown label');

  const now = Date.parse('2026-08-15T12:00:00.000Z');
  check(
    visitIsLeftover(
      { status: 'approved', plannedVisitAt: '2026-06-10T15:00:00.000Z' },
      now,
      '2026-08'
    ) === true,
    'prior-month approved visit is leftover'
  );
  check(
    visitIsLeftover(
      { status: 'completed', plannedVisitAt: '2026-06-10T15:00:00.000Z' },
      now,
      '2026-08'
    ) === false,
    'completed visits are not leftover'
  );
  check(
    visitIsLeftover(
      { status: 'approved', plannedVisitAt: '2026-08-20T15:00:00.000Z' },
      now,
      '2026-08'
    ) === false,
    'future current-month visit is not leftover'
  );

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll site-visit month key checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
