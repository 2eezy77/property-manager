#!/usr/bin/env node
/**
 * Portal-only payments notice: fee copy stays locked to server fee schedule,
 * and off-app Cash App / cashtag language stays explicit.
 *
 * Run: npm run test:portal-only-payments-email
 */
'use strict';

const assert = require('assert');
const { renderPortalOnlyPayments } = require('../src/services/email-templates/portalOnlyPayments');
const { feeSchedulePublic, RATE, FIXED_CENTS } = require('../src/services/payment-processing-fee.service');
const { BRAND } = require('../src/services/email-templates/brand');

const schedule = feeSchedulePublic();
assert.strictEqual(RATE, 0.029);
assert.strictEqual(FIXED_CENTS, 30);
assert.strictEqual(schedule.cardCashApp.label, '2.9% + $0.30');
assert.strictEqual(schedule.ach.label, 'No processing fee');

const feeLabel = schedule.cardCashApp.label;

const rendered = renderPortalOnlyPayments({
  recipientName: 'Stone <script>',
  unitLabel: 'Master',
  loginEmail: 'stone+portal@example.com',
  signatoryName: 'Jose Montero',
});

assert.ok(rendered.subject.includes('portal only'), 'subject stresses portal-only');
assert.ok(rendered.subject.includes(BRAND.property), 'subject names property');

assert.ok(
  /no longer accepting off-app payments/i.test(rendered.text),
  'text bans off-app payments'
);
assert.ok(
  /Cash App to a cashtag/i.test(rendered.text),
  'text names Cash App cashtag as disallowed'
);
assert.ok(
  /Venmo|Zelle/i.test(rendered.text),
  'text also bans other off-app rails'
);

assert.ok(
  rendered.text.includes('Bank (ACH) — no processing fee'),
  'text says ACH has no fee'
);
assert.ok(
  rendered.text.includes(`Card — includes a ${feeLabel} processing fee.`),
  'text card fee matches feeSchedulePublic label'
);
assert.ok(
  rendered.text.includes(`Cash App Pay inside the Payments page — includes a ${feeLabel} processing fee.`),
  'text Cash App Pay fee matches feeSchedulePublic label'
);

assert.ok(rendered.html.includes('&lt;script&gt;'), 'HTML escapes recipient name');
assert.ok(!rendered.html.includes('<script>'), 'HTML has no raw script tag');
assert.ok(
  rendered.html.includes(`<strong>${feeLabel}</strong>`),
  'HTML fee label matches schedule'
);
assert.ok(
  /no longer accepting off-app payments/i.test(rendered.html),
  'HTML bans off-app payments'
);
assert.ok(/Open Payments/i.test(rendered.html), 'HTML CTA opens Payments');
assert.ok(rendered.html.includes('Master'), 'HTML includes unit label');
assert.ok(
  rendered.text.includes('stone%2Bportal%40example.com')
    || rendered.html.includes('stone%2Bportal%40example.com'),
  'sign-in URL encodes plus-address email'
);

console.log('All portal-only-payments-email checks passed.');
