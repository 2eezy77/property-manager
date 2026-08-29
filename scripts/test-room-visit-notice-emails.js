#!/usr/bin/env node
/**
 * Room maintenance follow-up + inspection notice emails: subjects, 24h copy,
 * room labels, and HTML escaping for tenant/property names.
 *
 * Run: npm run test:room-visit-notice-emails
 */
'use strict';

const assert = require('assert');
const followupNotice = require('../src/services/email-templates/roomMaintenanceFollowupNotice');
const followupDone = require('../src/services/email-templates/roomMaintenanceFollowupCompleted');
const inspectionNotice = require('../src/services/email-templates/roomInspectionNotice');
const inspectionDone = require('../src/services/email-templates/roomInspectionCompleted');
const inspectionCancel = require('../src/services/email-templates/roomInspectionCancelled');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const base = {
  tenantName: 'Ada <script>',
  propertyName: '743 A Ave',
  propertyAddress: '743 A Ave, Norfolk VA',
  plannedAtFormatted: 'Mon Aug 11, 10:00 AM',
  visitedAtFormatted: 'Mon Aug 11, 10:30 AM',
  roomLabels: ['Room 2', 'Hall bath'],
};

{
  const r = followupNotice.render(base);
  check(/Maintenance follow-up scheduled/.test(r.subject), `followup notice subject: ${r.subject}`);
  check(r.subject.includes(base.plannedAtFormatted), 'followup notice subject includes when');
  check(/24 hours notice/.test(r.text), 'followup notice text mentions 24h');
  check(r.text.includes('Room 2, Hall bath'), 'followup notice joins room labels');
  check(r.html.includes('&lt;script&gt;'), 'followup notice escapes tenant HTML');
  check(!r.html.includes('<script>'), 'followup notice HTML has no raw script tag');
  check(/do not need to be present/i.test(r.text), 'followup notice: optional presence');
}

{
  const r = followupDone.render({ ...base, roomLabels: 'Kitchen' });
  check(/Maintenance follow-up completed/.test(r.subject), `followup done subject: ${r.subject}`);
  check(r.text.includes('Kitchen'), 'followup done accepts single room string');
  check(/maintenance request/i.test(r.text), 'followup done points to portal maintenance');
  check(r.html.includes('&lt;script&gt;'), 'followup done escapes tenant HTML');
}

{
  const r = inspectionNotice.render(base);
  check(/Room inspection scheduled/.test(r.subject), `inspection notice subject: ${r.subject}`);
  check(/24 hours notice as required/.test(r.text), 'inspection notice cites required 24h');
  check(r.text.includes('Room 2, Hall bath'), 'inspection notice lists rooms');
  check(r.html.includes('&lt;script&gt;'), 'inspection notice escapes tenant HTML');
}

{
  const r = inspectionDone.render({ ...base, roomLabels: ['Master'] });
  check(/inspection completed/i.test(r.subject), `inspection done subject: ${r.subject}`);
  check(r.text.includes('Master'), 'inspection done room label');
}

{
  const r = inspectionCancel.render({
    tenantName: 'Ada <script>',
    propertyName: '743 A Ave',
    plannedAtFormatted: 'Tue Aug 12, 2:00 PM',
    roomLabels: ['Room 3'],
    noticeType: 'room_inspection',
  });
  check(/Inspection cancelled/.test(r.subject), `inspection cancel subject: ${r.subject}`);
  check(r.text.includes('Room 3'), 'inspection cancel room label');
  check(r.html.includes('&lt;script&gt;'), 'inspection cancel escapes tenant HTML');
  check(r.notificationType === 'room_inspection_cancelled', 'inspection cancel notification type');

  const followupCancel = inspectionCancel.render({
    tenantName: 'Ada',
    propertyName: '743 A Ave',
    plannedAtFormatted: 'Wed Aug 13, 9:00 AM',
    noticeType: 'maintenance_followup',
  });
  check(/Maintenance follow-up cancelled/.test(followupCancel.subject),
    `followup cancel subject: ${followupCancel.subject}`);
  check(followupCancel.notificationType === 'maintenance_followup_cancelled',
    'followup cancel notification type');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll room-visit-notice-emails checks passed.');
