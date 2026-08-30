#!/usr/bin/env node
/**
 * Tenant bank-link reminder: subject, Payments CTA, Cash App alternate,
 * login URL with email, and HTML escaping.
 *
 * Run: npm run test:bank-link-reminder-email
 */
'use strict';

const { renderBankLinkReminder } = require('../src/services/email-templates/bankLinkReminder');
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
  const r = renderBankLinkReminder({
    recipientName: 'Ada <script>',
    unitLabel: 'Room 2',
    loginEmail: 'ada@example.com',
    signatoryName: 'Jose Montero',
  });
  check(/Action needed: link your bank for rent/.test(r.subject), `subject: ${r.subject}`);
  check(r.subject.includes(BRAND.property), 'subject names property');
  check(/link your checking or savings/i.test(r.text), 'text asks to link bank');
  check(/Cash App Pay/i.test(r.text), 'text mentions Cash App alternate');
  check(r.text.includes('Room 2'), 'text includes unit label');
  check(r.text.includes(`${BRAND.portalUrl.replace(/\/$/, '')}/login?email=${encodeURIComponent('ada@example.com')}`),
    'text login URL includes encoded email');
  check(r.html.includes('&lt;script&gt;'), 'HTML escapes recipient name');
  check(!r.html.includes('<script>'), 'HTML has no raw script tag');
  check(/Open Payments/i.test(r.html), 'HTML CTA is Open Payments');
  check(r.html.includes('Cash App'), 'HTML mentions Cash App');
}

{
  const r = renderBankLinkReminder({ recipientName: 'Tenant' });
  check(r.text.includes(BRAND.portalUrl), 'without loginEmail uses portal URL');
  check(!/\?email=/.test(r.text), 'without loginEmail omits email query');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll bank-link-reminder-email checks passed.');
