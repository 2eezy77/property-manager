#!/usr/bin/env node
/**
 * Unit checks for boots-on-site pay-anytime, manager date/approve rules,
 * and Instant Payout amount gating.
 * Run: node scripts/test-site-visits-cleanup.js
 */
const {
  parseRequiredPlannedAt,
  visitNeeds24hNotice,
  roomTargetsNeed24h,
  assertCanApproveVisit,
} = require('../src/services/site-visits.service');
const { canPayPayroll } = require('../src/services/site-visits-payout.service');
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
  }) === false,
  'nothing to pay when no unpaid visits'
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
  'activity log records manager/owner approve'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll site-visit cleanup checks passed.');
