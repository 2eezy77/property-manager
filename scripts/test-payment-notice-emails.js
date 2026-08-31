#!/usr/bin/env node
/**
 * Payment succeeded/failed notice emails: rent vs utility copy, HTML escape,
 * default ACH failure reason, staff manager CTA.
 *
 * Run: npm run test:payment-notice-emails
 */
'use strict';

const paymentSucceeded = require('../src/services/email-templates/paymentSucceeded');
const paymentFailed = require('../src/services/email-templates/paymentFailed');
const paymentSucceededStaff = require('../src/services/email-templates/paymentSucceededStaff');
const paymentFailedStaff = require('../src/services/email-templates/paymentFailedStaff');
const { BRAND } = require('../src/services/email-templates/brand');

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
  const r = paymentSucceeded.render({
    tenantName: 'Ada <script>',
    amount: 900,
    paymentType: 'rent',
    unitLabel: 'Unit 2',
    propertyName: '743 A Ave',
  });
  check(/rent payment of \$900\.00/i.test(r.text), 'rent succeeded text names rent + amount');
  check(r.text.includes('Unit 2'), 'rent succeeded text includes unit');
  check(r.text.includes('743 A Ave'), 'rent succeeded text includes property');
  check(r.html.includes('&lt;script&gt;'), 'rent succeeded escapes tenant HTML');
  check(!r.html.includes('<script>'), 'rent succeeded HTML has no raw script tag');
  check(r.html.includes('Unit 2'), 'rent succeeded HTML includes unit');
  check(/View payment history/i.test(r.html), 'rent succeeded CTA is payment history');
}

{
  const r = paymentSucceeded.render({
    tenantName: 'Lily',
    amount: 42.5,
    paymentType: 'utility',
  });
  check(/utility share payment of \$42\.50/i.test(r.text), 'utility succeeded uses share wording');
  check(!/Unit /.test(r.text), 'utility succeeded omits unit/property sentence');
  check(/Utility share/.test(r.html), 'utility succeeded detail type is Utility share');
}

{
  const r = paymentFailed.render({
    tenantName: 'Ada <b>',
    amount: 900,
    paymentType: 'rent',
  });
  check(/rent payment of \$900\.00 could not be processed/i.test(r.text), 'rent failed text');
  check(r.text.includes('The bank returned the ACH debit.'), 'failed defaults ACH return reason');
  check(r.html.includes('&lt;b&gt;'), 'rent failed escapes tenant HTML');
  check(r.html.includes('The bank returned the ACH debit.'), 'failed HTML includes default reason');
  check(/Update bank/i.test(r.html), 'failed CTA asks to update bank');
}

{
  const r = paymentFailed.render({
    tenantName: 'Isaiah',
    amount: 55,
    paymentType: 'utility',
    failureReason: 'Insufficient funds <x>',
  });
  check(/utility payment of \$55\.00 could not be processed/i.test(r.text), 'utility failed text');
  check(r.text.includes('Insufficient funds <x>'), 'failed text keeps raw reason (plaintext)');
  check(r.html.includes('Insufficient funds &lt;x&gt;'), 'failed HTML escapes reason in detail table');
}

{
  const r = paymentSucceededStaff.render({
    tenantName: 'Stone <em>',
    tenantEmail: 'stone@example.com',
    amount: 450,
    paymentType: 'rent',
    propertyName: '743 A Ave',
    unitLabel: 'Unit 2',
  });
  check(/paid \$450\.00 for rent/i.test(r.text), 'staff succeeded text');
  check(r.html.includes('&lt;em&gt;'), 'staff succeeded escapes tenant HTML');
  check(r.html.includes(BRAND.paymentsUrl.replace('/tenant/', '/manager/')),
    'staff succeeded CTA points at manager portal');
}

{
  const r = paymentFailedStaff.render({
    tenantName: 'Buckley',
    amount: 900,
    paymentType: 'utility',
  });
  check(/Buckley's utility payment of \$900\.00 failed/i.test(r.text), 'staff failed utility text');
  check(r.text.includes('The bank returned the ACH debit.'), 'staff failed default reason');
  check(r.html.includes(BRAND.paymentsUrl.replace('/tenant/', '/manager/')),
    'staff failed CTA points at manager portal');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll payment-notice-emails checks passed.');
