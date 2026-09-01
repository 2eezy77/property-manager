#!/usr/bin/env node
/**
 * Maintenance email HTML/text render: escape + emergency staff styling.
 * Complements maintenance-notify-policy (subjects / who-gets-mail) with body checks.
 *
 * Run: npm run test:maintenance-email-render
 */
'use strict';

const maintenanceCreated = require('../src/services/email-templates/maintenanceCreated');
const maintenanceCreatedStaff = require('../src/services/email-templates/maintenanceCreatedStaff');
const maintenanceStatus = require('../src/services/email-templates/maintenanceStatus');
const maintenanceStatusStaff = require('../src/services/email-templates/maintenanceStatusStaff');
const maintenanceBill = require('../src/services/email-templates/maintenanceBill');
const maintenanceBillStaff = require('../src/services/email-templates/maintenanceBillStaff');
const { BRAND, PALETTE } = require('../src/services/email-templates/brand');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

{
  const r = maintenanceCreated.render({
    tenantName: 'Ada <script>',
    title: 'Leak <urgent>',
    unitNumber: '2A',
    propertyName: '743 Demo',
    priority: 'high',
  });
  check(r.text.includes('Hi Ada <script>,'), 'tenant created text keeps raw name');
  check(r.text.includes('Title: Leak <urgent>'), 'tenant created text includes title');
  check(r.text.includes(BRAND.maintenanceUrl), 'tenant created text links maintenance');
  check(r.html.includes('Ada &lt;script&gt;'), 'tenant created HTML escapes name');
  check(r.html.includes('Leak &lt;urgent&gt;'), 'tenant created HTML escapes title');
  check(!r.html.includes('<script>'), 'tenant created HTML has no raw script tag');
  check(/Track your request/i.test(r.html), 'tenant created CTA');
}

{
  const normal = maintenanceCreatedStaff.render({
    tenantName: 'Ada',
    tenantEmail: 'ada@example.com',
    title: 'Sink drip',
    unitNumber: '2',
    propertyName: '743',
    priority: 'medium',
    isEmergency: false,
  });
  check(normal.text.includes('New maintenance request from Ada'), 'staff created text names tenant');
  check(normal.html.includes('New request'), 'staff normal hero is New request');
  check(!/EMERGENCY/i.test(normal.html), 'staff normal HTML has no EMERGENCY banner');

  const emergency = maintenanceCreatedStaff.render({
    tenantName: 'Ada <x>',
    tenantEmail: 'a<script>@x.com',
    title: 'Flood <now>',
    unitNumber: '1',
    propertyName: '743',
    priority: 'emergency',
    isEmergency: true,
  });
  check(/EMERGENCY/i.test(emergency.html), 'staff emergency HTML banners EMERGENCY');
  check(emergency.html.includes(PALETTE.danger), 'staff emergency uses danger accent');
  check(emergency.html.includes('Ada &lt;x&gt;'), 'staff emergency escapes tenant name');
  check(emergency.html.includes('a&lt;script&gt;@x.com'), 'staff emergency escapes email');
  check(emergency.html.includes('Flood &lt;now&gt;'), 'staff emergency escapes title');
  check(emergency.html.includes(BRAND.managerMaintenanceUrl), 'staff CTA is manager queue');
}

{
  const r = maintenanceStatus.render({
    tenantName: 'Bo',
    title: 'Window <fix>',
    statusLabel: 'in progress',
    scheduledAt: '2026-08-20T15:00:00.000Z',
    note: 'Bring <tools>',
  });
  check(r.text.includes('Window <fix>'), 'status text keeps raw title');
  check(r.text.includes('in progress'), 'status text includes label');
  check(r.text.includes('Bring <tools>'), 'status text includes note');
  check(r.html.includes('Window &lt;fix&gt;'), 'status HTML escapes title');
  check(r.html.includes('Bring &lt;tools&gt;'), 'status HTML escapes note via detailTable');
  check(/View details/i.test(r.html), 'status CTA');

  const resolved = maintenanceStatus.render({
    tenantName: 'Bo',
    title: 'Done',
    statusLabel: 'resolved',
    scheduledAt: '2026-08-20T15:00:00.000Z',
  });
  check(!/Scheduled:/i.test(resolved.text), 'resolved status omits scheduled line');
}

{
  const r = maintenanceStatusStaff.render({
    title: 'Pipe <burst>',
    propertyName: '743 <A>',
    unitNumber: '3',
    oldStatus: 'submitted',
    newStatus: 'in_progress',
    note: 'Assigned <Kon>',
    statusLabel: 'updated',
  });
  check(r.text.includes('submitted → in_progress'), 'staff status text shows transition');
  check(r.html.includes('Pipe &lt;burst&gt;'), 'staff status HTML escapes title');
  check(r.html.includes('743 &lt;A&gt;'), 'staff status HTML escapes property');
  check(r.html.includes('Assigned &lt;Kon&gt;'), 'staff status HTML escapes note');
}

{
  const r = maintenanceBill.render({
    tenantName: 'Cy <x>',
    amount: 125.5,
    title: 'Damage <door>',
    unitNumber: '4',
    propertyName: '743',
    paymentId: 'pay-1',
  });
  check(r.text.includes('$125.50'), 'bill text formats money');
  check(r.text.includes('pay-1'), 'bill text includes payment ref');
  check(r.html.includes('Cy &lt;x&gt;'), 'bill HTML escapes tenant');
  check(r.html.includes('Damage &lt;door&gt;'), 'bill HTML escapes title');
  check(r.html.includes(BRAND.paymentsUrl), 'bill CTA is payments');
}

{
  const r = maintenanceBillStaff.render({
    tenantName: 'Cy <x>',
    amount: 40,
    title: 'Paint <touch>',
  });
  check(r.text.includes('$40.00 billed to Cy <x>'), 'staff bill text');
  check(r.html.includes('Cy &lt;x&gt;'), 'staff bill HTML escapes tenant');
  check(r.html.includes('Paint &lt;touch&gt;'), 'staff bill HTML escapes title');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll maintenance-email-render checks passed.');
