#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leasesPage = fs.readFileSync(
  path.join(root, 'client/src/pages/manager/Leases.jsx'),
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

console.log('lease invite UI checks passed');
