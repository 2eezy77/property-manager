#!/usr/bin/env node
/**
 * Maintenance email subjects + staff notify status gates.
 * Run: node scripts/test-maintenance-notify-policy.js
 */
'use strict';

const {
  tenantDisplayName,
  maintenanceCreatedSubjects,
  maintenanceStatusSubjects,
  shouldNotifyStaffOnStatus,
  maintenanceBillSubjects,
  STAFF_STATUS_NOTIFY,
} = require('../src/services/maintenance-notify-policy');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(tenantDisplayName('Ada', 'Lovelace') === 'Ada Lovelace', 'joins first+last');
assert(tenantDisplayName('Ada', null) === 'Ada', 'first name only');
assert(tenantDisplayName(null, null) === 'Tenant', 'fallback Tenant when empty');

const created = maintenanceCreatedSubjects({ title: 'Leaky faucet', priority: 'medium' });
assert(
  created.tenantSubject === 'Maintenance request received - Leaky faucet',
  'tenant created subject'
);
assert(
  created.staffSubject === '[Maintenance] Leaky faucet',
  'staff created subject without emergency banner'
);
assert(created.isEmergency === false, 'medium is not emergency');

const emergency = maintenanceCreatedSubjects({ title: 'Gas smell', priority: 'emergency' });
assert(
  emergency.staffSubject === '[Maintenance] EMERGENCY - Gas smell',
  'staff subject banners EMERGENCY'
);
assert(emergency.isEmergency === true, 'emergency priority flagged');

const status = maintenanceStatusSubjects({ title: 'AC out', newStatus: 'in_progress' });
assert(
  status.tenantSubject === 'Maintenance update - AC out (in progress)',
  'tenant status subject humanizes underscores'
);
assert(
  status.staffSubject === 'Maintenance in progress - AC out',
  'staff status subject'
);
assert(status.statusLabel === 'in progress', 'statusLabel strips underscores');

for (const s of STAFF_STATUS_NOTIFY) {
  assert(shouldNotifyStaffOnStatus(s) === true, `staff notified on ${s}`);
}
assert(shouldNotifyStaffOnStatus('submitted') === false, 'no staff email on submitted');
assert(shouldNotifyStaffOnStatus('open') === false, 'no staff email on open');

const bill = maintenanceBillSubjects({ amount: 85.5, title: 'Door repair' });
assert(
  bill.tenantSubject === 'Charge for maintenance / damages - $85.50',
  'tenant bill subject formats money'
);
assert(
  bill.staffSubject === 'Maintenance charge recorded - $85.50 (Door repair)',
  'staff bill subject includes title'
);
assert(bill.amountLabel === '$85.50', 'amountLabel is fixed 2 decimals');

if (failed) {
  console.error(`\ntest-maintenance-notify-policy: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-maintenance-notify-policy: OK');
