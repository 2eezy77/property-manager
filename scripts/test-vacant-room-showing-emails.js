#!/usr/bin/env node
/**
 * Vacant-room showing courtesy notices: subjects, room labels, optional presence
 * copy, and HTML escaping for tenant/property names.
 *
 * Run: npm run test:vacant-room-showing-emails
 */
'use strict';

const showingNotice = require('../src/services/email-templates/vacantRoomShowingNotice');
const showingDone = require('../src/services/email-templates/vacantRoomShowingCompleted');

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
  const r = showingNotice.render(base);
  check(/Vacant room showing scheduled/.test(r.subject), `notice subject: ${r.subject}`);
  check(r.subject.includes(base.plannedAtFormatted), 'notice subject includes when');
  check(r.text.includes('Room 2, Hall bath'), 'notice joins room labels');
  check(/prospective tenant/i.test(r.text), 'notice mentions prospective tenant');
  check(/do not need to be present/i.test(r.text), 'notice: optional presence');
  check(/will not enter your leased room/i.test(r.text), 'notice: leased room off-limits');
  check(r.html.includes('&lt;script&gt;'), 'notice escapes tenant HTML');
  check(!r.html.includes('<script>'), 'notice HTML has no raw script tag');
  check(r.html.includes('Vacant room showing scheduled'), 'notice HTML title present');
}

{
  const r = showingDone.render({ ...base, roomLabels: 'Kitchen' });
  check(/Vacant room showing completed/.test(r.subject), `done subject: ${r.subject}`);
  check(r.subject.includes(base.visitedAtFormatted), 'done subject includes when');
  check(r.text.includes('Kitchen'), 'done accepts single room string');
  check(/did not need to be present/i.test(r.text), 'done: optional presence');
  check(r.html.includes('&lt;script&gt;'), 'done escapes tenant HTML');
  check(!r.html.includes('<script>'), 'done HTML has no raw script tag');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll vacant-room-showing-emails checks passed.');
