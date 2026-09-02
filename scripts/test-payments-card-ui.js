#!/usr/bin/env node

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
  "startCardPayment('rent')",
  "startCardPayment('security_deposit')",
  "startBankPayment('rent')",
  '<CardPaymentForm',
  "card: 'Card'",
  "p.metadata?.source === 'stripe_card'",
  'Debit / credit card',
]);

const cardForm = fs.readFileSync(
  path.join(root, 'client/src/components/payments/CardPaymentForm.jsx'),
  'utf8'
);
assert.match(
  cardForm,
  /wallets:\s*\{\s*link:\s*'never'/,
  'card Payment Element must disable Stripe Link (Osanin Link generic_decline)'
);

assert.match(
  paymentsPage,
  /const rentDue = balance\?\.lease\?\.status === 'active'/,
  'rent card controls should only appear for active leases'
);

assert.match(
  paymentsRoutes,
  /l\.status IN \('active', 'awaiting_deposit', 'awaiting_identity'\)/,
  'balance endpoint should surface awaiting-deposit leases so pending deposits can be paid'
);

const autopaySection = paymentsPage.slice(
  paymentsPage.indexOf('id="autopay-heading"'),
  paymentsPage.indexOf('id="bank-accounts-heading"')
);
assert(autopaySection.includes('ACH on the 1st'), 'autopay copy should stay ACH-focused');
assert(!autopaySection.includes('CardPaymentForm'), 'autopay section must not render card payment UI');
assert(!autopaySection.includes('with Card'), 'autopay section must not advertise card autopay');

console.log('payments card UI checks passed');
