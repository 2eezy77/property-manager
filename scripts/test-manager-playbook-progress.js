#!/usr/bin/env node
/**
 * Unit checks for manager playbook progress math + retired category hide.
 * Run: npm run test:manager-playbook-progress
 *
 * Guards the offline Cash App import step from reappearing after
 * `cashapp_imports` was removed from live ops, and keeps dashboard
 * completion counts honest when hidden rows slip into a payload.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  HIDDEN_CATEGORIES,
  isHiddenPlaybookCategory,
  summarizePlaybookProgress,
} = require('../src/services/manager-playbook-progress');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(HIDDEN_CATEGORIES.has('cashapp_imports'), 'cashapp_imports stays in HIDDEN_CATEGORIES');
check(isHiddenPlaybookCategory('cashapp_imports') === true, 'cashapp_imports is hidden');
check(isHiddenPlaybookCategory('utilities') === false, 'utilities stay visible');
check(isHiddenPlaybookCategory('tenant_offboarding') === false, 'offboarding stays visible');

const serviceSrc = fs.readFileSync(
  path.join(__dirname, '../src/services/manager-playbook.service.js'),
  'utf8'
);
check(!/category:\s*'cashapp_imports'/.test(serviceSrc), 'DEFAULT_ITEMS must not re-seed cashapp_imports');
check(/category:\s*'utilities'/.test(serviceSrc), 'DEFAULT_ITEMS includes utilities');
check(/category:\s*'bank_links'/.test(serviceSrc), 'DEFAULT_ITEMS includes bank_links');
check(/Do not landlord-ACH/i.test(serviceSrc), 'utilities notes keep portal-pay / no landlord ACH guidance');
check(
  serviceSrc.includes("require('./manager-playbook-progress')"),
  'service uses shared progress helpers'
);

{
  const summary = summarizePlaybookProgress([
    { category: 'utilities', last_completed_at: '2026-08-01', last_verified_at: null },
    { category: 'bank_links', last_completed_at: null, last_verified_at: '2026-08-02' },
    { category: 'cashapp_imports', last_completed_at: '2026-07-01', last_verified_at: '2026-07-01' },
    { category: 'inbox_sla', last_completed_at: '2026-08-03', last_verified_at: '2026-08-03' },
  ]);
  check(summary.total === 3, 'hidden category excluded from total');
  check(summary.completed === 2, 'completed ignores hidden row');
  check(summary.verified === 2, 'verified ignores hidden row');
  check(summary.items.every((i) => i.category !== 'cashapp_imports'), 'items drop cashapp_imports');
}

{
  const empty = summarizePlaybookProgress(null);
  check(empty.total === 0 && empty.completed === 0 && empty.verified === 0, 'null items → zero progress');
}

{
  const noneDone = summarizePlaybookProgress([
    { category: 'announcements', last_completed_at: null, last_verified_at: null },
  ]);
  check(noneDone.total === 1 && noneDone.completed === 0 && noneDone.verified === 0, 'incomplete item counts as open');
}

if (failed) {
  console.error(`\ntest-manager-playbook-progress: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-manager-playbook-progress: OK');
