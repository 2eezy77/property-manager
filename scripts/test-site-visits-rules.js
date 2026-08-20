#!/usr/bin/env node
/**
 * Unit checks for site-visit purpose, 24h notice, monthly pay cap, common areas, video proof.
 * Run: node scripts/test-site-visits-rules.js
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://localhost:5432/property_manager_test';

const {
  VISIT_AMOUNT_CENTS,
  MONTHLY_CAP_CENTS,
  assertCanReserve,
  defaultPurpose,
  normalizeRoomPurpose,
  visitNeeds24hNotice,
  roomTargetsNeed24h,
  parseVideoPayload,
} = require('../src/services/site-visits.service');
const {
  ROOM_PURPOSE,
} = require('../src/services/site-visits-notify.service');
const {
  COMMON_AREAS,
  mandatoryCommonAreas,
  normalizeCommonAreas,
} = require('../src/services/site-visits-catalog');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(VISIT_AMOUNT_CENTS === 2000, 'visit amount is $20');
assert(MONTHLY_CAP_CENTS === 10000, 'monthly cap is $100');

// Purpose normalization
const occupied = { occupied: true, label: 'Room A' };
const vacant = { occupied: false, label: 'Room B' };

assert(defaultPurpose(occupied) === ROOM_PURPOSE.ROUTINE, 'occupied default = routine');
assert(defaultPurpose(vacant) === ROOM_PURPOSE.VACANT_SHOWING, 'vacant default = showing');

assert(
  normalizeRoomPurpose(occupied, ROOM_PURPOSE.MAINTENANCE) === ROOM_PURPOSE.MAINTENANCE,
  'occupied accepts maintenance'
);
assert(
  normalizeRoomPurpose(occupied, null) === ROOM_PURPOSE.ROUTINE,
  'occupied null purpose → routine'
);
assert(
  normalizeRoomPurpose(vacant, ROOM_PURPOSE.ROUTINE) === ROOM_PURPOSE.VACANT_SHOWING,
  'vacant forces vacant_showing even if routine requested'
);

let threw = false;
try {
  normalizeRoomPurpose(occupied, ROOM_PURPOSE.VACANT_SHOWING);
} catch (e) {
  threw = e.statusCode === 400;
}
assert(threw, 'rejects vacant_showing on occupied room');

threw = false;
try {
  normalizeRoomPurpose(vacant, ROOM_PURPOSE.MAINTENANCE);
} catch (e) {
  threw = e.statusCode === 400;
}
assert(threw, 'rejects maintenance on vacant room');

// 24h notice — occupied routine/maintenance only
assert(
  visitNeeds24hNotice([{ occupied: true, purpose: ROOM_PURPOSE.ROUTINE }]) === true,
  '24h for occupied routine'
);
assert(
  visitNeeds24hNotice([{ occupied: true, purpose: ROOM_PURPOSE.MAINTENANCE }]) === true,
  '24h for occupied maintenance'
);
assert(
  visitNeeds24hNotice([{ occupied: false, purpose: ROOM_PURPOSE.VACANT_SHOWING }]) === false,
  'no 24h for vacant showing alone'
);
assert(
  visitNeeds24hNotice([
    { occupied: false, purpose: ROOM_PURPOSE.VACANT_SHOWING },
    { occupied: true, purpose: ROOM_PURPOSE.ROUTINE },
  ]) === true,
  '24h if any occupied inspection target'
);
assert(visitNeeds24hNotice([]) === false, 'empty room rows → no 24h');
assert(visitNeeds24hNotice(null) === false, 'null room rows → no 24h');

assert(
  roomTargetsNeed24h([{ tenantId: 't1', roomPurpose: ROOM_PURPOSE.ROUTINE }]) === true,
  'roomTargetsNeed24h with tenant'
);
assert(
  roomTargetsNeed24h([{ tenantId: null, roomPurpose: ROOM_PURPOSE.VACANT_SHOWING }]) === false,
  'roomTargetsNeed24h vacant without tenant'
);
assert(
  roomTargetsNeed24h([{ tenantId: 't1' }]) === true,
  'roomTargetsNeed24h defaults missing purpose to routine'
);

// Monthly cap
assertCanReserve({ reserved_cents: 0 });
assertCanReserve({ reserved_cents: MONTHLY_CAP_CENTS - VISIT_AMOUNT_CENTS });
threw = false;
try {
  assertCanReserve({ reserved_cents: MONTHLY_CAP_CENTS - VISIT_AMOUNT_CENTS + 1 });
} catch (e) {
  threw = e.code === 'MONTHLY_CAP' && e.statusCode === 409;
}
assert(threw, 'blocks reserve that would exceed monthly cap');
threw = false;
try {
  assertCanReserve({ reserved_cents: MONTHLY_CAP_CENTS });
} catch (e) {
  threw = e.code === 'MONTHLY_CAP';
}
assert(threw, 'blocks reserve when already at cap');

// Common areas always force all three
assert(mandatoryCommonAreas().length === 3, 'three mandatory common areas');
assert(
  normalizeCommonAreas([]).join(',') === mandatoryCommonAreas().join(','),
  'normalizeCommonAreas ignores empty input'
);
assert(
  normalizeCommonAreas(['parking']).join(',') === COMMON_AREAS.map((a) => a.key).join(','),
  'normalizeCommonAreas ignores partial caller keys'
);

// Video proof validation
threw = false;
try {
  parseVideoPayload(null);
} catch (e) {
  threw = e.statusCode === 400;
}
assert(threw, 'rejects missing video');

threw = false;
try {
  parseVideoPayload('data:image/png;base64,aaaa');
} catch (e) {
  threw = e.statusCode === 400 && /MP4|WebM|MOV/i.test(e.message);
}
assert(threw, 'rejects non-video mime');

const tiny = Buffer.alloc(10, 1).toString('base64');
threw = false;
try {
  parseVideoPayload(`data:video/mp4;base64,${tiny}`);
} catch (e) {
  threw = e.statusCode === 400 && /too small/i.test(e.message);
}
assert(threw, 'rejects tiny video buffer');

const okBuf = Buffer.alloc(60 * 1024, 2);
const parsed = parseVideoPayload(`data:video/webm;base64,${okBuf.toString('base64')}`);
assert(parsed.ext === 'webm' && parsed.mediaType === 'video', 'accepts webm video');
assert(parsed.buf.length === okBuf.length, 'decoded buffer length matches');

const mov = parseVideoPayload(`data:video/quicktime;base64,${okBuf.toString('base64')}`);
assert(mov.ext === 'mov', 'quicktime → mov extension');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll site-visits-rules checks passed.');
