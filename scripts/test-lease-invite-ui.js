#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leasesPage = fs.readFileSync(
  path.join(root, 'client/src/pages/manager/Leases.jsx'),
  'utf8'
);
const tenantLeasePage = fs.readFileSync(
  path.join(root, 'client/src/pages/tenant/Lease.jsx'),
  'utf8'
);
const finishLeasePay = fs.readFileSync(
  path.join(root, 'client/src/components/leases/FinishLeasePay.jsx'),
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

includesAll(leasesPage, 'manager lease invite UI', [
  'Invite new',
  'for_lease_create',
  'phone required',
]);

includesAll(tenantLeasePage, 'tenant identity verification UI', [
  'Verify your identity',
]);

includesAll(finishLeasePay, 'finish lease pending identity UI', [
  'activation pending identity',
]);

console.log('lease invite UI checks passed');
