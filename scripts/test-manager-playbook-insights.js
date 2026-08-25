#!/usr/bin/env node
/**
 * Unit checks for manager playbook rent/utilities/onboarding insight builders.
 * Run: node scripts/test-manager-playbook-insights.js
 */
'use strict';

const {
  insight,
  onboardingRows,
  buildRentInsight,
  buildUtilitiesInsight,
} = require('../src/services/manager-playbook-insights-pure');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const emptyGroups = {
  upToDate: [],
  partial: [],
  late: [],
  pending: [],
  due: [],
};

check(insight('ok', 'hi', Array.from({ length: 12 }, (_, i) => ({ i }))).rows.length === 8,
  'insight caps rows at 8');

check(
  onboardingRows(
    [{ name: 'A', unitLine: 'U1', email: 'a@x.com', checkin: { passwordChanged: true } }],
    'passwordChanged',
    'change login password',
    'Set password'
  ).level === 'ok',
  'onboarding ok when all complete'
);

const missingOnboard = onboardingRows(
  [
    { name: 'A', unitLine: 'U1', email: 'a@x.com', checkin: { passwordChanged: true } },
    { name: 'B', unitLine: 'U2', email: 'b@x.com', checkin: { passwordChanged: false } },
  ],
  'passwordChanged',
  'change login password',
  'Set password'
);
check(missingOnboard.level === 'action', 'onboarding action when missing');
check(missingOnboard.rows.length === 1 && missingOnboard.rows[0].label === 'B',
  'onboarding lists only incomplete tenants');
check(/1 tenant still needs/.test(missingOnboard.headline), 'singular onboarding headline');

const noLeases = buildRentInsight({
  monthLabel: 'August 2026',
  tenants: [],
  groups: emptyGroups,
  summary: {
    total: 0,
    up_to_date: 0,
    partial: 0,
    late: 0,
    pending: 0,
    due: 0,
    email_count: 0,
  },
});
check(noLeases.level === 'ok' && /No active leases/.test(noLeases.headline),
  'rent insight empty roster → ok');

const lateRoster = buildRentInsight({
  monthLabel: 'August 2026',
  tenants: [],
  groups: {
    ...emptyGroups,
    late: [{
      name: 'Late Tenant',
      unitLine: 'Unit 1',
      detail: '$900 due',
      rowStatus: 'danger',
      email: 'late@x.com',
      emailSubject: 'Rent late',
      emailHint: 'Email',
      shouldEmail: true,
      statusLabel: 'Late',
    }],
    partial: [{
      name: 'Partial Tenant',
      unitLine: 'Unit 2',
      detail: '$450 paid',
      rowStatus: 'warn',
      email: 'part@x.com',
      shouldEmail: false,
      statusLabel: 'Partial',
    }],
  },
  summary: {
    total: 3,
    up_to_date: 1,
    partial: 1,
    late: 1,
    pending: 0,
    due: 0,
    email_count: 1,
  },
});
check(lateRoster.level === 'action', 'late rent → action');
check(/1 late/.test(lateRoster.headline) && /email 1 tenant/.test(lateRoster.headline),
  'late rent headline includes late + email count');
check(lateRoster.rows[0].label === 'Late Tenant', 'late tenants sort before partial');

const partialOnly = buildRentInsight({
  monthLabel: 'August 2026',
  tenants: [],
  groups: {
    ...emptyGroups,
    partial: [{
      name: 'Partial',
      detail: '$100 left',
      rowStatus: 'warn',
      email: 'p@x.com',
    }],
  },
  summary: {
    total: 2,
    up_to_date: 1,
    partial: 1,
    late: 0,
    pending: 0,
    due: 0,
    email_count: 0,
  },
});
check(partialOnly.level === 'watch', 'partial-only rent → watch');

const grace = buildRentInsight({
  monthLabel: 'August 2026',
  tenants: [],
  groups: emptyGroups,
  summary: {
    total: 4,
    up_to_date: 2,
    partial: 0,
    late: 0,
    pending: 1,
    due: 1,
    email_count: 0,
  },
});
check(grace.level === 'watch' && /in grace/.test(grace.headline),
  'pending/due without late → grace watch headline');

const utilOk = buildUtilitiesInsight([], []);
check(utilOk.level === 'ok', 'utilities clear → ok');

const utilAction = buildUtilitiesInsight(
  [
    { status: 'draft', service_type: 'electric', property_name: '743', total_amount: 120 },
    { status: 'notified', service_type: 'water', total_amount: 40 },
    { status: 'charging', service_type: 'trash', total_amount: 10 },
  ],
  [
    { name: 'Owes', email: 'o@x.com', owed: 55.5, disputed_count: 0 },
    { name: 'Dispute', email: 'd@x.com', owed: 0, disputed_count: 1 },
  ]
);
check(utilAction.level === 'action', 'draft/owed utilities → action');
check(/1 draft bill/.test(utilAction.headline) && /2 tenants owe/.test(utilAction.headline),
  'utilities headline counts drafts + owed tenants');
const disputed = utilAction.rows.find((r) => r.label === 'Dispute');
check(disputed?.status === 'danger' && /review dispute/.test(disputed.detail),
  'disputed utility row is danger');
check(utilAction.rows.some((r) => /draft, notify tenants/.test(r.detail || '')),
  'draft bill row asks to notify');
check(!utilAction.rows.some((r) => /trash/.test(r.label)),
  'charging bills are not listed as draft/notified rows');

const manyRows = buildUtilitiesInsight(
  Array.from({ length: 10 }, (_, i) => ({
    status: 'draft',
    service_type: `svc${i}`,
    total_amount: 1,
  })),
  []
);
check(manyRows.rows.length === 8, 'utilities insight also caps at 8 rows');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll manager-playbook-insights checks passed.');
