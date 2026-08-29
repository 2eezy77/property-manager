#!/usr/bin/env node
/**
 * Off-app Cash App Gmail import is retired — sync must stay opt-in.
 * Locks env parsers so a bad default cannot restart silent imports.
 *
 * Run: node scripts/test-cashapp-gmail-sync-env.js
 *
 * Requires DATABASE_URL only because the scheduler module loads the pool; no queries run.
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/db';

const {
  syncEnabled,
  intervalMs,
  newerThanDays,
} = require('../src/services/cashapp-gmail-scheduler.service');

const prev = {
  CASHAPP_GMAIL_SYNC_ENABLED: process.env.CASHAPP_GMAIL_SYNC_ENABLED,
  CASHAPP_GMAIL_SYNC_MINUTES: process.env.CASHAPP_GMAIL_SYNC_MINUTES,
  CASHAPP_GMAIL_SYNC_NEWER_DAYS: process.env.CASHAPP_GMAIL_SYNC_NEWER_DAYS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withEnv(overrides, fn) {
  const snapshot = {};
  for (const key of Object.keys(overrides)) snapshot[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

try {
  withEnv({ CASHAPP_GMAIL_SYNC_ENABLED: undefined }, () => {
    assert(syncEnabled() === false, 'unset CASHAPP_GMAIL_SYNC_ENABLED keeps sync off');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_ENABLED: 'false' }, () => {
    assert(syncEnabled() === false, 'false keeps sync off');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_ENABLED: '1' }, () => {
    assert(syncEnabled() === false, 'truthy non-true strings do not enable sync');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_ENABLED: 'true' }, () => {
    assert(syncEnabled() === true, 'explicit true enables sync');
  });

  withEnv({ CASHAPP_GMAIL_SYNC_MINUTES: undefined }, () => {
    assert(intervalMs() === 15 * 60 * 1000, 'default interval is 15 minutes');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_MINUTES: '3' }, () => {
    assert(intervalMs() === 15 * 60 * 1000, 'intervals under 5 minutes fall back to 15');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_MINUTES: 'nope' }, () => {
    assert(intervalMs() === 15 * 60 * 1000, 'non-numeric interval falls back to 15');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_MINUTES: '20' }, () => {
    assert(intervalMs() === 20 * 60 * 1000, 'valid interval minutes are honored');
  });

  withEnv({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: undefined }, () => {
    assert(newerThanDays() === 30, 'default lookback is 30 days');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: '0' }, () => {
    assert(newerThanDays() === 30, 'zero lookback falls back to 30');
  });
  withEnv({ CASHAPP_GMAIL_SYNC_NEWER_DAYS: '7' }, () => {
    assert(newerThanDays() === 7, 'valid lookback days are honored');
  });
} finally {
  restoreEnv();
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll Cash App Gmail sync env checks passed.');
