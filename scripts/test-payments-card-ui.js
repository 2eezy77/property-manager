#!/usr/bin/env node
/**
 * Static guards for tenant Payments card / Cash App / utility portal-pay UI.
 * Run: npm run test:payments-card-ui
 *
 * Catches regressions like missing utility paymentType on card intents
 * (which previously 500'd when Stripe metadata was non-string) and
 * manager-preview pay CTAs leaking through.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const paymentsPage = fs.readFileSync(
  path.join(root, 'client/src/pages/tenant/Payments.jsx'),
  'utf8'
);
const paymentsRoutes = fs.readFileSync(
  path.join(root, 'src/routes/payments.routes.js'),
  'utf8'
);

function includesAll(source, label, snippets) {
  for (const snippet of snippets) {
    assert(
      source.includes(snippet),
      `${label} should include ${JSON.stringify(snippet)}`
    );
  }
}

includesAll(paymentsPage, 'tenant Payments card integration', [
  "CardPaymentForm from '@/components/payments/CardPaymentForm'",
  "'/api/payments/card/create-intent'",
  "'/api/payments/cashapp/create-intent'",
  "paymentType: 'security_deposit'",
  "paymentType: 'utility'",
  '<CardPaymentForm',
  "card: 'Card'",
  "p.metadata?.source === 'stripe_card'",
]);

assert.match(
  paymentsPage,
  /paymentType:\s*'rent'/,
  'rent ACH/card paths must send paymentType rent'
);

assert.match(
  paymentsPage,
  /startCardPayment\('utility'\)/,
  'utility card CTA must call startCardPayment(utility)'
);

assert.match(
  paymentsPage,
  /handleCashAppPay\('utility'\)/,
  'utility Cash App CTA must call handleCashAppPay(utility)'
);

assert.match(
  paymentsPage,
  /const rentDue = balance\?\.lease\?\.status === 'active'/,
  'rent card controls should only appear for active leases'
);

assert.match(
  paymentsPage,
  /const utilityDue = !managerPreview && utilityDueAmount > 0\.009/,
  'utility due CTA must hide under manager preview'
);

assert.match(
  paymentsPage,
  /const depositDue = !managerPreview && balance\?\.securityDepositPayment/,
  'deposit CTA must hide under manager preview'
);

assert.match(
  paymentsPage,
  /0\.029\) \+ 30/,
  'client fee estimate must stay 2.9% + $0.30'
);

assert.match(
  paymentsRoutes,
  /l\.status IN \('active', 'awaiting_deposit', 'awaiting_identity'\)/,
  'balance endpoint should surface awaiting-deposit/identity leases so deposits can be paid'
);

assert.match(
  paymentsRoutes,
  /payment_type\s*=\s*'utility'|paymentType === 'utility'|payment_type: 'utility'/,
  'payments routes must accept utility portal charges'
);

const autopaySection = paymentsPage.slice(
  paymentsPage.indexOf('id="autopay-heading"'),
  paymentsPage.indexOf('id="bank-accounts-heading"')
);
assert(autopaySection.includes('ACH on the 1st'), 'autopay copy should stay ACH-focused');
assert(!autopaySection.includes('CardPaymentForm'), 'autopay section must not render card payment UI');
assert(!autopaySection.includes('with Card'), 'autopay section must not advertise card autopay');

console.log('payments card UI checks passed');
