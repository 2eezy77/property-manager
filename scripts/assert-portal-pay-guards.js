/**
 * Static guards for portal-pay / Autopay-only utilities model.
 * Run: npm run assert:portal-pay
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function mustNotContain(rel, patterns, why) {
  const src = read(rel);
  for (const p of patterns) {
    if (src.includes(p)) failures.push(`${rel}: must not contain ${JSON.stringify(p)} — ${why}`);
  }
}

function mustContain(rel, patterns, why) {
  const src = read(rel);
  for (const p of patterns) {
    if (!src.includes(p)) failures.push(`${rel}: must contain ${JSON.stringify(p)} — ${why}`);
  }
}

// Workers never ACH
mustNotContain(
  'src/services/utilities-scheduler.service.js',
  ['executeChargeBill', '/charge', 'chargeACH'],
  'utilities worker must never ACH'
);

// Manager Utilities UI must not expose charge CTAs (after Task 2)
mustNotContain(
  'client/src/pages/manager/Utilities.jsx',
  ['Charge all eligible', 'Charge this share', 'Retry charge', 'Advanced ACH', 'landlord ACH'],
  'manager utilities must not expose landlord ACH'
);

// Soft-kill cashtag on tenant surfaces (after Task 4)
mustNotContain(
  'client/src/pages/tenant/Dashboard.jsx',
  ['cashtag'],
  'do not promote off-app cashtag'
);
mustNotContain(
  'client/src/pages/tenant/Payments.jsx',
  ['Outside cashtag', 'cashtag'],
  'do not promote off-app cashtag'
);

// Processing label (after Task 2)
mustContain(
  'client/src/pages/manager/Utilities.jsx',
  ["label: 'Processing'", "['charging', 'Processing']"],
  'charging status shown as Processing in UI'
);


// Off-app Cash App Gmail sync UI retired
mustNotContain(
  'client/src/pages/manager/Payments.jsx',
  ['Sync Cash App from Gmail', 'syncCashApp'],
  'off-app Cash App Gmail sync must not appear in Manager Payments'
);
mustContain(
  'src/services/cashapp-gmail-scheduler.service.js',
  ["process.env.CASHAPP_GMAIL_SYNC_ENABLED === 'true'"],
  'off-app Cash App Gmail sync must be opt-in (default off)'
);

// Source labels before generic payment_method (Manager Payments)
const paymentsSrc = read('client/src/pages/manager/Payments.jsx');
const stripeCardCheck = "if (p.source === 'stripe_card' || p.payment_method === 'card')";
const cashAppImportCheck = "if (p.source === 'cash_app_import')";
const stripeCashAppCheck = "if (p.source === 'stripe_cashapp') return 'Cash App Pay';";
const paymentMethodBranch = 'if (p.payment_method)';
if (!paymentsSrc.includes(stripeCardCheck)) {
  failures.push(`client/src/pages/manager/Payments.jsx: must contain ${JSON.stringify(stripeCardCheck)} — Card label by source`);
}
if (!paymentsSrc.includes(cashAppImportCheck)) {
  failures.push(`client/src/pages/manager/Payments.jsx: must contain ${JSON.stringify(cashAppImportCheck)} — Cash App off-app label by source`);
}
if (!paymentsSrc.includes(stripeCashAppCheck)) {
  failures.push(`client/src/pages/manager/Payments.jsx: must contain ${JSON.stringify(stripeCashAppCheck)} — Cash App Pay label by source`);
}
if (!paymentsSrc.includes("Cash App (archived off-app)")) {
  failures.push('client/src/pages/manager/Payments.jsx: must label full off-app Cash App imports');
}
const cardIdx = paymentsSrc.indexOf(stripeCardCheck);
const importIdx = paymentsSrc.indexOf(cashAppImportCheck);
const stripeIdx = paymentsSrc.indexOf(stripeCashAppCheck);
const methodIdx = paymentsSrc.indexOf(paymentMethodBranch);
if (cardIdx === -1 || importIdx === -1 || stripeIdx === -1 || methodIdx === -1) {
  // missing strings already reported above
} else if (cardIdx >= methodIdx || importIdx >= methodIdx || stripeIdx >= methodIdx) {
  failures.push(
    'client/src/pages/manager/Payments.jsx: stripe_card, cash_app_import, and stripe_cashapp source checks must appear before if (p.payment_method)'
  );
}

// Portal utility pay: link splits → payments.payment_type = utility (not landlord ACH)
mustContain(
  'src/services/utility-portal-charge.service.js',
  ["payment_type", "'utility'", 'prepareUtilityPortalCharge', 'listOpenUtilitySplits'],
  'utility portal charge service must create utility payments linked to splits'
);
mustContain(
  'src/routes/payments.routes.js',
  ["'utility'", 'utilityDue', 'prepareUtilityPortalCharge'],
  'balance/charge intents must support utility portal pay'
);
mustContain(
  'client/src/pages/tenant/Payments.jsx',
  ['utilityDue', "paymentType: 'utility'", 'handleUtilityAchPay'],
  'tenant Payments must surface utility portal pay'
);
mustContain(
  'client/src/pages/manager/Payments.jsx',
  ["utility:'Utility'"],
  'manager Payments must label utility payment type'
);

// Failed utility Stripe payments must clear payment_id so tenants can retry
mustContain(
  'src/webhooks/stripe.webhook.js',
  ["payment_type === 'utility'", 'payment_id = NULL'],
  'utility payment failures must clear split payment_id for retry'
);

if (failures.length) {
  console.error('assert:portal-pay FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('assert:portal-pay OK');
