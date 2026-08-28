#!/usr/bin/env node
/**
 * Client manager tile copy must stay in sync with server paidCountSublabel
 * for partial flexible-pay (Stone) after #81.
 * Run: node scripts/test-rent-collection-copy.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://test:test@127.0.0.1:5432/property_manager_test';

const { spawnSync } = require('child_process');
const path = require('path');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const root = path.join(__dirname, '..');
const esm = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import {
    paidCountSublabel,
    tenantsPaidSub,
  } from './client/src/utils/rent-collection-copy.js';

  const partial = { paid_count: 3, partial_count: 1, tenant_count: 4 };
  if (paidCountSublabel(partial) !== '3/4 paid · 1 partial') process.exit(2);
  if (tenantsPaidSub(partial) !== '3 fully paid · 1 partial') process.exit(3);

  const allPaid = { paid_count: 4, partial_count: 0, tenant_count: 4 };
  if (paidCountSublabel(allPaid) !== '4/4 paid') process.exit(4);
  if (tenantsPaidSub(allPaid) !== 'fully paid this month') process.exit(5);

  if (paidCountSublabel({}) !== '0/0 paid') process.exit(6);
  if (tenantsPaidSub({}) !== 'fully paid this month') process.exit(7);
`], { cwd: root, encoding: 'utf8' });

check(esm.status === 0, `client rent-collection-copy helpers pass (exit ${esm.status}${esm.stderr ? `: ${esm.stderr}` : ''})`);

// Parity with server helper used by owner Dashboard
const { paidCountSublabel: serverLabel } = require('../src/services/rent-status.service');
check(
  serverLabel({ paid_count: 3, partial_count: 1, tenant_count: 4 }) === '3/4 paid · 1 partial',
  'server paidCountSublabel matches client partial copy'
);
check(
  serverLabel({ paid_count: 4, partial_count: 0, tenant_count: 4 }) === '4/4 paid',
  'server paidCountSublabel matches client all-paid copy'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll rent-collection-copy checks passed.');
