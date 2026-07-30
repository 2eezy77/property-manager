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

// Cash App source labels before generic payment_method (Manager Payments)
const paymentsSrc = read('client/src/pages/manager/Payments.jsx');
const cashAppImportCheck = "if (p.source === 'cash_app_import') return 'Cash App (off-app)';";
const stripeCashAppCheck = "if (p.source === 'stripe_cashapp') return 'Cash App Pay';";
const paymentMethodBranch = 'if (p.payment_method)';
if (!paymentsSrc.includes(cashAppImportCheck)) {
  failures.push(`client/src/pages/manager/Payments.jsx: must contain ${JSON.stringify(cashAppImportCheck)} — Cash App off-app label by source`);
}
if (!paymentsSrc.includes(stripeCashAppCheck)) {
  failures.push(`client/src/pages/manager/Payments.jsx: must contain ${JSON.stringify(stripeCashAppCheck)} — Cash App Pay label by source`);
}
const importIdx = paymentsSrc.indexOf(cashAppImportCheck);
const stripeIdx = paymentsSrc.indexOf(stripeCashAppCheck);
const methodIdx = paymentsSrc.indexOf(paymentMethodBranch);
if (importIdx === -1 || stripeIdx === -1 || methodIdx === -1) {
  // missing strings already reported above
} else if (importIdx >= methodIdx || stripeIdx >= methodIdx) {
  failures.push(
    'client/src/pages/manager/Payments.jsx: cash_app_import and stripe_cashapp source checks must appear before if (p.payment_method)'
  );
}

if (failures.length) {
  console.error('assert:portal-pay FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('assert:portal-pay OK');
