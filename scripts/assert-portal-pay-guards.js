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

if (failures.length) {
  console.error('assert:portal-pay FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('assert:portal-pay OK');
