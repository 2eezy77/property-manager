#!/usr/bin/env node
/**
 * Security / money-copy email templates: HTML escape + locked fee wording.
 * Run: node scripts/test-security-notice-emails.js
 */
'use strict';

const assert = require('assert');
const utilityBillNotify = require('../src/services/email-templates/utilityBillNotify');
const tenantPasswordChangedStaff = require('../src/services/email-templates/tenantPasswordChangedStaff');
const { renderPortalOnlyPayments } = require('../src/services/email-templates/portalOnlyPayments');
const { computeCardCashAppFee } = require('../src/services/payment-processing-fee.service');

const util = utilityBillNotify.render({
  tenantName: 'Lily <b>X</b>',
  amount: 42.5,
  serviceType: 'electric & "water"',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  disputeHours: 48,
});
assert.match(util.text, /Lily <b>X<\/b>/);
assert.match(util.html, /Lily &lt;b&gt;X&lt;\/b&gt;/);
assert.doesNotMatch(util.html, /Lily <b>X<\/b>/);
assert.match(util.html, /electric &amp; &quot;water&quot;/);
assert.match(util.text, /\$42\.50/);
assert.match(util.text, /48 hours to dispute/);
assert.match(util.html, /Dispute window/);

const pwd = tenantPasswordChangedStaff.render({
  tenantName: 'Isaiah "Stone"',
  tenantEmail: 'isaiah@example.com',
  unitLabel: 'Room <3>',
  propertyName: '743 A Ave',
  changedAt: '2026-09-01T15:30:00.000Z',
});
assert.strictEqual(pwd.subject, 'Tenant updated portal password — Isaiah "Stone"');
assert.match(pwd.text, /isaiah@example.com/);
assert.match(pwd.text, /Unit: Room <3>/);
assert.match(pwd.html, /Isaiah &quot;Stone&quot;/);
assert.match(pwd.html, /Room &lt;3&gt;/);
assert.doesNotMatch(pwd.html, /Room <3>/);
assert.match(pwd.html, /Open Users/);

const fee = computeCardCashAppFee(10000);
assert.strictEqual(fee.feeCents, 320); // 2.9% + $0.30 on $100
assert.strictEqual(fee.totalCents, 10320);
const portal = renderPortalOnlyPayments({
  recipientName: 'Tenant <script>',
  unitLabel: 'Unit "A"',
  loginEmail: 'tenant+test@example.com',
});
assert.match(portal.subject, /portal only/i);
assert.match(portal.text, /2\.9% \+ \$0\.30/);
assert.match(portal.html, /2\.9% \+ \$0\.30/);
assert.match(portal.text, /Bank \(ACH\).*no processing fee/i);
assert.match(portal.html, /Tenant &lt;script&gt;/);
assert.doesNotMatch(portal.html, /Tenant <script>/);
assert.match(portal.html, /Unit &quot;A&quot;/);

console.log('ok: security-notice-emails');
