#!/usr/bin/env node
/**
 * Regression: Gmail calendar-default merge + auto-notify hold gates.
 * Pure helpers only — no DB.
 *
 * Run: npm run test:utility-merge-notify
 */
const {
  amountsNearlyEqual,
  pickMatchingOpenProviderBill,
  resolveMergedBillingPeriods,
  shouldHoldAutoNotifyForCalendarPhantom,
  shouldHoldAutoNotifyForElectricAmountSource,
  isCalendarMonthPeriod,
} = require('../src/use-cases/utilities/period-utils');
const {
  pickMergeAmount,
  sortKeeperFirst,
} = require('../src/use-cases/utilities/uc10-combine-monthly');
const { autoNotifyEnabled } = require('../src/services/utility-comms.service');

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

const hrsd = {
  id: 'hrsd',
  property_id: 'p1',
  service_type: 'water',
  period_start: '2026-06-06',
  period_end: '2026-07-09',
  total_amount: 165.74,
  tenant_charge_amount: 165.74,
  amount_source: null,
  created_at: '2026-08-05T16:00:00Z',
};
const augPhantom = {
  id: 'aug',
  property_id: 'p1',
  service_type: 'water',
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  total_amount: 165.74,
  tenant_charge_amount: 165.74,
  created_at: '2026-08-05T16:10:00Z',
};

assert('amounts match within 2¢', amountsNearlyEqual(165.74, 165.75));
assert('amounts reject 3¢ drift', !amountsNearlyEqual(165.74, 165.77));

const matched = pickMatchingOpenProviderBill([augPhantom, hrsd], 165.74);
assert('pickMatchingOpenProviderBill prefers provider', matched?.id === 'hrsd', matched);

assert(
  'calendar-only bills do not match as provider',
  pickMatchingOpenProviderBill([augPhantom], 165.74) == null
);

const preserved = resolveMergedBillingPeriods({
  existing: hrsd,
  parsed: {
    period_parsed: false,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
  },
  bounds: { start: '2026-08-01', end: '2026-08-31' },
});
assert(
  'calendar-default merge keeps HRSD period',
  preserved.periodStart === '2026-06-06' && preserved.periodEnd === '2026-07-09',
  preserved
);

const unioned = resolveMergedBillingPeriods({
  existing: hrsd,
  parsed: {
    period_parsed: true,
    period_start: '2026-06-01',
    period_end: '2026-07-15',
  },
  bounds: { start: '2026-07-01', end: '2026-07-31' },
});
assert(
  'parsed periods union with existing',
  unioned.periodStart === '2026-06-01' && unioned.periodEnd === '2026-07-15',
  unioned
);

assert(
  'hold phantom notify while provider open',
  shouldHoldAutoNotifyForCalendarPhantom(augPhantom, [hrsd, augPhantom])
);
assert(
  'do not hold provider draft notify',
  !shouldHoldAutoNotifyForCalendarPhantom(hrsd, [hrsd, augPhantom])
);
assert(
  'phantom alone may notify',
  !shouldHoldAutoNotifyForCalendarPhantom(augPhantom, [augPhantom])
);

assert(
  'hold amount_due_fallback electric',
  shouldHoldAutoNotifyForElectricAmountSource({
    service_type: 'electric',
    amount_source: 'amount_due_fallback',
  })
);
assert(
  'hold parsed_total electric',
  shouldHoldAutoNotifyForElectricAmountSource({
    service_type: 'electric',
    amount_source: 'parsed_total',
  })
);
assert(
  'allow current_charges electric',
  !shouldHoldAutoNotifyForElectricAmountSource({
    service_type: 'electric',
    amount_source: 'current_charges',
  })
);
assert(
  'water never held for amount_source',
  !shouldHoldAutoNotifyForElectricAmountSource({
    service_type: 'water',
    amount_source: 'amount_due_fallback',
  })
);

const mergeAmt = pickMergeAmount([
  {
    service_type: 'electric',
    amount_source: 'amount_due_fallback',
    tenant_charge_amount: 744.21,
    total_amount: 744.21,
  },
  {
    service_type: 'electric',
    amount_source: 'current_charges',
    tenant_charge_amount: 184.64,
    total_amount: 184.64,
  },
]);
assert('UC10 pickMergeAmount prefers current_charges', mergeAmt === 184.64, mergeAmt);

const keepers = sortKeeperFirst([
  {
    id: 'cal',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    amount_source: 'current_charges',
    total_amount: 200,
    created_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'dom',
    period_start: '2026-06-17',
    period_end: '2026-07-16',
    amount_source: 'amount_due_fallback',
    total_amount: 180,
    created_at: '2026-07-16T00:00:00Z',
  },
]);
assert('UC10 sortKeeperFirst prefers provider period', keepers[0].id === 'dom', keepers.map((b) => b.id));
assert('Jul 1–31 is calendar', isCalendarMonthPeriod('2026-07-01', '2026-07-31'));

const prev = process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
try {
  delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  assert('autoNotifyEnabled default off', autoNotifyEnabled() === false);
  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'true';
  assert('autoNotifyEnabled true only for exact true', autoNotifyEnabled() === true);
  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = '1';
  assert('autoNotifyEnabled rejects 1', autoNotifyEnabled() === false);
} finally {
  if (prev === undefined) delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  else process.env.UTILITIES_AUTO_NOTIFY_ENABLED = prev;
}

process.exit(failed ? 1 : 0);
