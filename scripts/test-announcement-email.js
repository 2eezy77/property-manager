#!/usr/bin/env node
/**
 * Manager announcement broadcast email: subject/title, sender line, HTML escape.
 *
 * Run: npm run test:announcement-email
 */
'use strict';

const { render } = require('../src/services/email-templates/announcement');
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
  const r = render({
    tenantName: 'Ada <script>',
    title: 'Water shutoff <tonight>',
    body: 'Line 1\nLine 2 <b>bold</b>',
    senderName: 'Jose <mgr>',
    propertyName: '743 Demo',
  });
  check(r.text.includes('Hi Ada <script>,'), 'text keeps raw name (plain text)');
  check(r.text.includes('Water shutoff <tonight>'), 'text includes title');
  check(r.text.includes('Line 1\nLine 2 <b>bold</b>'), 'text preserves body newlines');
  check(r.text.includes('— Jose <mgr>, 743 Demo'), 'text sender/property line');
  check(r.text.includes(BRAND.name), 'text includes brand name');
  check(r.html.includes('&lt;script&gt;'), 'HTML escapes tenant name');
  check(r.html.includes('Water shutoff &lt;tonight&gt;'), 'HTML escapes title');
  check(r.html.includes('Line 1<br />Line 2 &lt;b&gt;bold&lt;/b&gt;'), 'HTML escapes body and keeps breaks');
  check(r.html.includes('Jose &lt;mgr&gt;'), 'HTML escapes sender');
  check(!r.html.includes('<script>'), 'HTML has no raw script tag');
  check(/Open portal/i.test(r.html), 'HTML CTA is Open portal');
  check(r.html.includes(BRAND.portalUrl), 'HTML CTA points at portal');
}

{
  const r = render({
    tenantName: 'Tenant',
    title: 'Hello',
    body: 'Body only',
  });
  check(r.text.includes('Property management'), 'default sender when omitted');
  check(r.text.includes(BRAND.property), 'default property when omitted');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll announcement-email checks passed.');
