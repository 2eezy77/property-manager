#!/usr/bin/env node
/**
 * Unit checks for owner dashboard Boots-on-site pay nag (#55 leftovers).
 * Run: node scripts/test-owner-visit-pay-nag.js
 */
'use strict';

const assert = require('assert');

async function main() {
  const { buildOwnerVisitPayNag } = await import('../client/src/utils/siteVisitPayroll.js');

  const currentMonth = buildOwnerVisitPayNag({
    visitCount: 2,
    totalCents: 4000,
    outstandingCount: 1,
    outstandingCents: 2000,
    monthLabel: 'August 2026',
    processing: false,
  });
  assert.strictEqual(currentMonth.unpaidVisitCount, 2);
  assert.strictEqual(currentMonth.unpaidVisitCents, 4000);
  assert.strictEqual(currentMonth.show, true);
  assert.strictEqual(currentMonth.fromEarlierMonths, false);

  const leftoversOnly = buildOwnerVisitPayNag({
    visitCount: 0,
    totalCents: 0,
    outstandingCount: 3,
    outstandingCents: 6000,
    monthLabel: 'August 2026',
    processing: false,
  });
  assert.strictEqual(leftoversOnly.unpaidVisitCount, 3);
  assert.strictEqual(leftoversOnly.unpaidVisitCents, 6000);
  assert.strictEqual(leftoversOnly.show, true);
  assert.strictEqual(leftoversOnly.fromEarlierMonths, true);

  const processingHides = buildOwnerVisitPayNag({
    visitCount: 0,
    outstandingCount: 2,
    outstandingCents: 4000,
    processing: true,
  });
  assert.strictEqual(processingHides.show, false, 'hide nag while a charge is in flight');

  const paidQuiet = buildOwnerVisitPayNag({
    visitCount: 0,
    outstandingCount: 0,
    outstandingCents: 0,
    processing: false,
  });
  assert.strictEqual(paidQuiet.show, false);
  assert.strictEqual(paidQuiet.unpaidVisitCount, 0);

  const loadingQuiet = buildOwnerVisitPayNag(
    { visitCount: 1, totalCents: 2000, processing: false },
    { loading: true }
  );
  assert.strictEqual(loadingQuiet.show, false, 'do not flash nag while payroll is loading');

  console.log('test-owner-visit-pay-nag: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
