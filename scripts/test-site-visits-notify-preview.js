#!/usr/bin/env node
/**
 * Unit checks for site-visit tenant notify audience preview helpers.
 * Run: node scripts/test-site-visits-notify-preview.js
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://localhost:5432/property_manager_test';

const {
  ROOM_PURPOSE,
  groupTargetsByTenant,
  occupiedTargets,
  previewTenantsToNotify,
} = require('../src/services/site-visits-notify.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const occupied = occupiedTargets([
  { tenant_id: 't1', unit_id: 'u1', room_label: 'A' },
  { tenant_id: null, unit_id: 'u2', room_label: 'B' },
  { tenant_id: 't2', unit_id: 'u3', room_label: 'C' },
]);
assert(occupied.length === 2, 'occupiedTargets drops vacant rooms');

const grouped = groupTargetsByTenant([
  { tenant_id: 't1', tenant_name: 'Ada', unit_id: 'u1', room_label: 'A' },
  { tenant_id: 't1', tenant_name: 'Ada', unit_id: 'u9', room_label: 'A2' },
  { tenant_id: null, unit_id: 'u2', room_label: 'Vacant' },
  { tenant_id: 't2', tenant_name: 'Bo', unit_id: 'u3', room_label: 'C' },
]);
assert(grouped.length === 2, 'groupTargetsByTenant merges per tenant');
const ada = grouped.find((g) => g.tenantId === 't1');
assert(ada.unitIds.join(',') === 'u1,u9', 'Ada gets both unit ids');
assert(ada.roomLabels.join(',') === 'A,A2', 'Ada gets both room labels');

const roomTargets = [
  { tenantId: 't1', tenantName: 'Ada', unitId: 'u1', roomLabel: 'A', roomPurpose: ROOM_PURPOSE.ROUTINE },
  { tenantId: 't1', tenantName: 'Ada', unitId: 'u9', roomLabel: 'A2', roomPurpose: ROOM_PURPOSE.ROUTINE },
  { tenantId: 't2', tenantName: 'Bo', unitId: 'u3', roomLabel: 'C', roomPurpose: ROOM_PURPOSE.MAINTENANCE },
  { tenantId: null, tenantName: null, unitId: 'u2', roomLabel: 'Vacant', roomPurpose: ROOM_PURPOSE.VACANT_SHOWING },
];
const propertyTenants = [
  { tenant_id: 't1', tenant_name: 'Ada' },
  { tenant_id: 't2', tenant_name: 'Bo' },
  { tenant_id: 't3', tenant_name: 'Cy' },
];

const preview = previewTenantsToNotify(roomTargets, propertyTenants);
const routine = preview.filter((p) => p.scenario === ROOM_PURPOSE.ROUTINE);
const maint = preview.filter((p) => p.scenario === ROOM_PURPOSE.MAINTENANCE);
const showing = preview.filter((p) => p.scenario === ROOM_PURPOSE.VACANT_SHOWING);

assert(routine.length === 1 && routine[0].tenantId === 't1', 'routine inbox only occupied target tenant');
assert(routine[0].roomLabels.join(',') === 'A,A2', 'routine merges Ada rooms');
assert(maint.length === 1 && maint[0].tenantId === 't2', 'maintenance inbox only Bo');
assert(showing.length === 3, 'vacant showing fans out to all property tenants');
assert(
  showing.every((p) => p.roomLabels.join(',') === 'Vacant'),
  'showing notices list vacant room labels'
);
assert(
  showing.map((p) => p.tenantId).sort().join(',') === 't1,t2,t3',
  'showing includes tenants not on the vacant room'
);

const deduped = previewTenantsToNotify(
  [
    { tenantId: 't1', tenantName: 'Ada', unitId: 'u1', roomLabel: 'A', roomPurpose: ROOM_PURPOSE.ROUTINE },
    { tenantId: 't1', tenantName: 'Ada', unitId: 'u9', roomLabel: 'A2', roomPurpose: ROOM_PURPOSE.ROUTINE },
  ],
  []
);
assert(deduped.length === 1, 'dedupes tenant:purpose for routine');

const noVacant = previewTenantsToNotify(
  [{ tenantId: 't1', tenantName: 'Ada', unitId: 'u1', roomLabel: 'A', roomPurpose: ROOM_PURPOSE.ROUTINE }],
  propertyTenants
);
assert(
  noVacant.every((p) => p.scenario !== ROOM_PURPOSE.VACANT_SHOWING),
  'no showing fan-out without vacant rooms'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll site-visits-notify-preview checks passed.');
