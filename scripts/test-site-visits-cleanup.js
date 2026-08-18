#!/usr/bin/env node
/**
 * Unit checks for boots-on-site schedule-without-approval, pay-anytime
 * (visits or custom amount), and Instant Payout amount gating.
 * Run: node scripts/test-site-visits-cleanup.js
 */
const {
  parseRequiredPlannedAt,
  visitNeeds24hNotice,
  roomTargetsNeed24h,
  assertCanApproveVisit,
} = require('../src/services/site-visits.service');
const {
  canPayPayroll,
  parseCustomAmountCents,
  resolvePayrollCharge,
  buildAvailableOwnerPayMethods,
} = require('../src/services/site-visits-payout.service');
const { resolveInstantPayoutAmount } = require('../src/services/stripe.service');
const { toNorfolkDatetimeLocal, MS_24H } = require('../src/utils/norfolk-time');
const { buildSummary } = require('../src/services/activity-audit.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function localFromOffset(ms) {
  return toNorfolkDatetimeLocal(new Date(Date.now() + ms));
}

function throwsCode(fn, code) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || err.statusCode || err.message;
  }
}

const soon = localFromOffset(60 * 60 * 1000);
const later = localFromOffset(MS_24H + 90 * 60 * 1000);

assert(!!parseRequiredPlannedAt(later, true), 'occupied-room visit 24h+ ahead is allowed');
assert(throwsCode(() => parseRequiredPlannedAt(soon, true), 'NOTICE_24H') === 'NOTICE_24H', 'occupied-room visit under 24h is blocked');
assert(!!parseRequiredPlannedAt(soon, false), 'vacant/common-only visit can be same-day');
assert(throwsCode(() => parseRequiredPlannedAt('', true), 400) === 400, 'planned time is required');

assert(
  visitNeeds24hNotice([{ occupied: true, purpose: 'routine_inspection' }]) === true,
  'occupied routine inspection needs 24h'
);
assert(
  visitNeeds24hNotice([{ occupied: false, purpose: 'vacant_showing' }]) === false,
  'vacant showing does not need 24h'
);
assert(
  roomTargetsNeed24h([{ tenantId: 't1', roomPurpose: 'routine_inspection' }]) === true,
  'room target with tenant needs 24h'
);
assert(
  roomTargetsNeed24h([{ tenantId: null, roomPurpose: 'vacant_showing' }]) === false,
  'vacant room target does not need 24h'
);

assert(
  throwsCode(() => assertCanApproveVisit({ managerId: 'm1' }, 'owner1', 'owner')) === null,
  'owner can approve'
);
assert(
  throwsCode(() => assertCanApproveVisit({ managerId: 'm1' }, 'm1', 'property_manager')) === null,
  'assigned manager can approve own visit'
);
assert(
  throwsCode(() => assertCanApproveVisit({ managerId: 'm1' }, 'm2', 'property_manager'), 403) === 403,
  'other manager cannot approve'
);

assert(
  canPayPayroll({
    visitCount: 0,
    outstandingCount: 2,
    processing: false,
    paymentMethodCount: 2,
  }) === true,
  'owner can pay outstanding visits after this month is already paid'
);
assert(
  canPayPayroll({
    visitCount: 1,
    outstandingCount: 1,
    processing: false,
    paymentMethodCount: 1,
  }) === true,
  'owner can pay the current month whenever visits are ready'
);
assert(
  canPayPayroll({
    visitCount: 1,
    outstandingCount: 1,
    processing: true,
    canCancelProcessing: false,
    paymentMethodCount: 1,
  }) === false,
  'in-flight payroll blocks a second pay'
);
assert(
  canPayPayroll({
    visitCount: 0,
    outstandingCount: 0,
    paymentMethodCount: 2,
  }) === true,
  'owner can pay any other amount even when no unpaid visits'
);
assert(
  canPayPayroll({
    visitCount: 0,
    outstandingCount: 0,
    paymentMethodCount: 0,
  }) === false,
  'cannot pay without a payment method'
);

assert(
  JSON.stringify(buildAvailableOwnerPayMethods({
    connectPayoutReady: true,
    cashAppPayAvailable: true,
    propertyBankLinked: true,
  })) === JSON.stringify(['cash_app']),
  'associate pay offers Cash App only when it is available'
);
assert(
  JSON.stringify(buildAvailableOwnerPayMethods({
    connectPayoutReady: true,
    cashAppPayAvailable: false,
    propertyBankLinked: true,
  })) === JSON.stringify(['ach']),
  'ACH is only a fallback when Cash App is unavailable'
);
assert(
  JSON.stringify(buildAvailableOwnerPayMethods({
    connectPayoutReady: false,
    cashAppPayAvailable: true,
    propertyBankLinked: true,
  })) === JSON.stringify([]),
  'no owner pay methods until Connect payout is ready'
);

assert(parseCustomAmountCents('') === 0, 'blank custom amount is zero');
assert(parseCustomAmountCents('25') === 2500, 'parses dollar custom amount to cents');
assert(parseCustomAmountCents('$1,200.50') === 120050, 'strips currency formatting');
assert(throwsCode(() => parseCustomAmountCents('nope'), 'INVALID_AMOUNT') === 'INVALID_AMOUNT', 'rejects invalid custom amount');
assert(throwsCode(() => parseCustomAmountCents(10001), 'AMOUNT_TOO_LARGE') === 'AMOUNT_TOO_LARGE', 'caps custom pay at $10,000');

const visitsOnly = resolvePayrollCharge({ visits: [{ amountCents: 2000 }, { amountCents: 2000 }] });
assert(visitsOnly.amountCents === 4000 && visitsOnly.payoutKind === 'visits', 'visit-only payroll stays visits kind');
const customOnly = resolvePayrollCharge({ visits: [], customAmountCents: 7500 });
assert(customOnly.amountCents === 7500 && customOnly.payoutKind === 'custom', 'custom-only payroll is custom kind');
const mixed = resolvePayrollCharge({ visits: [{ amountCents: 2000 }], customAmountCents: 1500 });
assert(mixed.amountCents === 3500 && mixed.payoutKind === 'mixed', 'visits plus extra work is mixed kind');
assert(
  throwsCode(() => resolvePayrollCharge({ visits: [], customAmountCents: 0 }), 'NOTHING_TO_PAY') === 'NOTHING_TO_PAY',
  'rejects empty payroll under 50 cents'
);

const tooSmall = resolveInstantPayoutAmount(20, 5000);
assert(tooSmall.ok === false && tooSmall.code === 'INSTANT_AMOUNT', 'instant payout rejects < 50¢');

const settling = resolveInstantPayoutAmount(2000, 0);
assert(settling.ok === false && settling.code === 'INSTANT_NOT_AVAILABLE', 'instant payout waits when funds are not available');

const partial = resolveInstantPayoutAmount(5000, 1200);
assert(partial.ok === true && partial.amount === 1200, 'instant payout sends only instant-available cents');

const full = resolveInstantPayoutAmount(2000, 5000);
assert(full.ok === true && full.amount === 2000, 'instant payout sends the full payroll when available');

const actor = { first_name: 'Konstantin', last_name: 'Hazlett', email: 'k@x.com' };
assert(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/site-visits/request',
    statusCode: 201,
    body: {},
  }) === 'Konstantin Hazlett scheduled a boots-on-site visit (tenant notices sent; no owner approval)',
  'activity log records schedule without owner approval'
);
assert(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/site-visits/abc/reschedule',
    statusCode: 200,
    body: {},
  }) === 'Konstantin Hazlett changed a boots-on-site visit date (tenant notices updated when applicable)',
  'activity log records date changes'
);
assert(
  buildSummary({
    actor,
    method: 'POST',
    path: '/api/site-visits/abc/approve',
    statusCode: 200,
    body: {},
  }).includes('approved a boots-on-site visit'),
  'activity log still records leftover pending approve'
);
assert(
  buildSummary({
    actor: { first_name: 'Jose', last_name: 'Montero', email: 'j@x.com' },
    method: 'POST',
    path: '/api/site-visits/payroll/pay',
    statusCode: 200,
    body: { customAmount: 85, payVisits: false, paymentMethod: 'ach' },
  }) === 'Jose Montero paid Konstantin $85.00 for other work (ach)',
  'activity log records custom manager pay'
);
assert(
  buildSummary({
    actor: { first_name: 'Jose', last_name: 'Montero', email: 'j@x.com' },
    method: 'POST',
    path: '/api/site-visits/payroll/pay',
    statusCode: 200,
    body: { customAmount: 100, payVisits: true, paymentMethod: 'ach', year: 2026, month: 8 },
  }) === 'Jose Montero paid Konstantin site visits plus $100.00 other work (ach)',
  'activity log records visits plus other work in one pay'
);

async function runMonthGroupChecks() {
  const {
    earlierMonthsCaption,
    groupVisitsByMonth,
    splitUpcomingVisits,
    visitNeedsShortNoticeWarning,
  } = await import('../client/src/utils/siteVisitMonths.js');
  const {
    buildSiteVisitPayPreview,
    OWNER_PAY_METHOD_COPY,
    payActionLabel,
    payoutKindLabel,
  } = await import('../client/src/utils/siteVisitPayroll.js');

  const both = buildSiteVisitPayPreview({
    visitCount: 1,
    visitCents: 2000,
    outstandingCount: 1,
    outstandingCents: 2000,
    otherWorkAmount: '100',
    monthLabel: 'August 2026',
  });
  assert(both.canCombine === true && both.combinedCents === 12000, 'August visit plus $100 other work is $120');
  assert(both.primaryAction === 'combined' && both.primaryLabel === 'Pay $120', 'primary button pays both in one charge');
  assert(both.headline === '1 unpaid visit + other work', 'headline names both pieces');
  assert(
    both.combinedDetail === '1 unpaid visit ($20) + other work ($100)',
    'combined detail lists visit and other work'
  );

  const visitsOnlyPreview = buildSiteVisitPayPreview({
    visitCount: 1,
    visitCents: 2000,
    otherWorkAmount: '',
    monthLabel: 'August 2026',
  });
  assert(visitsOnlyPreview.primaryAction === 'visits' && visitsOnlyPreview.primaryLabel === 'Pay visits $20', 'blank other work keeps visits-only pay');

  const otherOnlyPreview = buildSiteVisitPayPreview({
    visitCount: 0,
    visitCents: 0,
    otherWorkAmount: '100',
    monthLabel: 'August 2026',
  });
  assert(otherOnlyPreview.primaryAction === 'other' && otherOnlyPreview.primaryLabel === 'Pay $100 for other work', 'other work alone stays a custom pay');
  assert(payoutKindLabel({ payoutKind: 'mixed', visitCount: 1 }) === '1 visit + other work', 'history labels mixed payouts');
  assert(payActionLabel(both, 'cash_app') === 'Pay $120 in Cash App', 'Cash App button names the fast rail');
  assert(payActionLabel(both, 'ach') === 'Pay $120 by bank transfer', 'ACH button names the slow rail');
  assert(OWNER_PAY_METHOD_COPY.cash_app.speed === '~30 min', 'Cash App is labeled as the 30-minute path');
  assert(OWNER_PAY_METHOD_COPY.ach.speed === '3–5 days', 'bank transfer is labeled as multi-day');

  const juneLeftover = {
    id: 'june-1',
    status: 'approved',
    plannedVisitAt: '2026-06-11T18:00:00.000Z',
    payoutId: null,
  };
  const junePaidDone = {
    id: 'june-paid',
    status: 'completed',
    visitedAt: '2026-06-02T18:00:00.000Z',
    payoutId: 'payout-june',
  };
  const augustOpen = {
    id: 'aug-1',
    status: 'approved',
    plannedVisitAt: '2026-08-03T18:00:00.000Z',
    payoutId: null,
  };
  const split = splitUpcomingVisits([juneLeftover, augustOpen], '2026-08');
  assert(split.upcomingNow.map((v) => v.id).join(',') === '', 'past-dated August leftover leaves Upcoming');
  assert(split.upcomingPast.map((v) => v.id).join(',') === 'june-1,aug-1', 'past-dated leftovers sit under closed months');

  const futureAug = {
    id: 'aug-future',
    status: 'approved',
    plannedVisitAt: '2026-08-28T18:00:00.000Z',
    payoutId: null,
  };
  const splitLive = splitUpcomingVisits([juneLeftover, futureAug], '2026-08', Date.parse('2026-08-18T06:00:00.000Z'));
  assert(splitLive.upcomingNow.map((v) => v.id).join(',') === 'aug-future', 'future this-month visit stays in Upcoming');
  assert(splitLive.upcomingPast.map((v) => v.id).join(',') === 'june-1', 'June leftover still leaves Upcoming');

  const pastGroups = groupVisitsByMonth([juneLeftover], {
    currentMonth: '2026-08',
    paidMonths: { '2026-06': { amountCents: 4000 } },
  });
  assert(pastGroups[0]?.key === '2026-06', 'past leftovers group under June');
  assert(pastGroups[0]?.isPaid === true, 'June is Paid from payroll even when leftover rows have no payoutId');
  assert(pastGroups[0]?.leftoverCount === 1, 'June leftover count is 1');
  assert(
    earlierMonthsCaption(pastGroups) === 'Already paid. Tap a month if you need to check.',
    'earlier-months copy says already paid'
  );

  const unpaidPast = groupVisitsByMonth([juneLeftover], { currentMonth: '2026-08', paidMonths: {} });
  assert(unpaidPast[0]?.isPaid === false, 'June leftovers are not Paid without payroll or payoutId');
  assert(
    groupVisitsByMonth([junePaidDone], { currentMonth: '2026-08', paidMonths: {} })[0]?.isPaid === true,
    'completed visits with payoutId mark the month Paid'
  );

  const occupiedTarget = { tenantId: 't1', roomPurpose: 'routine_inspection' };
  assert(
    visitNeedsShortNoticeWarning({
      plannedVisitAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      roomTargets: [occupiedTarget],
    }) === true,
    'future visit inside 24h still warns'
  );
  assert(
    visitNeedsShortNoticeWarning({
      plannedVisitAt: '2026-06-11T18:00:00.000Z',
      roomTargets: [occupiedTarget],
    }) === false,
    'past date does not show under-24h warning'
  );
}

(async () => {
  await runMonthGroupChecks();
  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll site-visit cleanup checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
