#!/usr/bin/env node
/**
 * Cash App Gmail sync is opt-in and clamps interval / lookback env vars.
 * Run: npm run test:cashapp-gmail-scheduler-policy
 */
'use strict';

const {
  syncEnabled,
  intervalMs,
  newerThanDays,
} = require('../src/services/cashapp-gmail-scheduler-policy');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(syncEnabled({}) === false, 'default sync disabled');
check(syncEnabled({ CASHAPP_GMAIL_SYNC_ENABLED: 'true' }) === true, 'enabled when true');
check(syncEnabled({ CASHAPP_GMAIL_SYNC_ENABLED: '1' }) === false, 'truthy non-true stays off');
check(syncEnabled({ CASHAPP_GMAIL_SYNC_ENABLED: 'TRUE' }) === false, 'case-sensitive true only');

check(intervalMs({}) === 15 * 60 * 1000, 'default interval 15m');
check(intervalMs({ CASHAPP_GMAIL_SYNC_MINUTES: '30' }) === 30 * 60 * 1000, 'custom 30m');
check(intervalMs({ CASHAPP_GMAIL_SYNC_MINUTES: '4' }) === 15 * 60 * 1000, 'below 5m clamps to 15');
check(intervalMs({ CASHAPP_GMAIL_SYNC_MINUTES: '0' }) === 15 * 60 * 1000, 'zero clamps to 15');
check(intervalMs({ CASHAPP_GMAIL_SYNC_MINUTES: 'nope' }) === 15 * 60 * 1000, 'NaN clamps to 15');
check(intervalMs({ CASHAPP_GMAIL_SYNC_MINUTES: '5' }) === 5 * 60 * 1000, 'minimum 5m allowed');

check(newerThanDays({}) === 30, 'default lookback 30d');
check(newerThanDays({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: '7' }) === 7, 'custom 7d');
check(newerThanDays({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: '0' }) === 30, 'zero days clamps to 30');
check(newerThanDays({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: '-1' }) === 30, 'negative clamps to 30');
check(newerThanDays({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: 'x' }) === 30, 'NaN clamps to 30');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll cashapp-gmail-scheduler-policy checks passed.');
