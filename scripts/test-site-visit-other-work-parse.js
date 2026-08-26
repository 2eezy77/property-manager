#!/usr/bin/env node
/**
 * Owner Boots-on-site "other work" amount parse + pay dollar formatting.
 * Keep in sync with client/src/utils/siteVisitPayroll.js.
 * Run: npm run test:site-visit-other-work-parse
 */
'use strict';

async function main() {
  const {
    parseOtherWorkAmount,
    formatPayDollars,
    payActionLabel,
  } = await import('../client/src/utils/siteVisitPayroll.js');

  let failed = 0;
  function check(cond, msg) {
    if (!cond) {
      console.error('FAIL:', msg);
      failed += 1;
    } else {
      console.log('ok:', msg);
    }
  }

  check(parseOtherWorkAmount('') === 0, 'empty string → 0');
  check(parseOtherWorkAmount(null) === 0, 'null → 0');
  check(parseOtherWorkAmount(undefined) === 0, 'undefined → 0');
  check(parseOtherWorkAmount('0.49') === 0, 'below $0.50 floor → 0');
  check(parseOtherWorkAmount(0.49) === 0, 'numeric below floor → 0');
  check(parseOtherWorkAmount('0.50') === 0.5, '$0.50 exact is allowed');
  check(parseOtherWorkAmount('$12.50') === 12.5, 'strips leading $');
  check(parseOtherWorkAmount('1,234.56') === 1234.56, 'strips commas');
  check(parseOtherWorkAmount(' $1,000.10 ') === 1000.1, 'strips $, commas, spaces');
  check(parseOtherWorkAmount('abc') === 0, 'non-numeric → 0');
  check(parseOtherWorkAmount(-5) === 0, 'negative → 0');
  check(parseOtherWorkAmount(12.345) === 12.35, 'rounds to cents');

  check(formatPayDollars(500) === '$5', 'whole dollars drop .00');
  check(formatPayDollars(550) === '$5.50', 'cents keep two places');
  check(formatPayDollars(0) === '$0', 'zero cents');
  check(formatPayDollars(null) === '$0', 'null cents → $0');

  const combined = {
    primaryAction: 'combined',
    combinedCents: 12500,
    otherCents: 2500,
    dueVisitCents: 10000,
    primaryLabel: 'Pay $125',
  };
  check(
    payActionLabel(combined, 'cash_app') === 'Pay $125 in Cash App',
    'Cash App combined label'
  );
  check(
    payActionLabel({ primaryAction: 'visits', dueVisitCents: 4000, primaryLabel: 'x' }, 'cash_app')
      === 'Pay visits $40 in Cash App',
    'Cash App visits-only label'
  );

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll site-visit other-work parse checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
