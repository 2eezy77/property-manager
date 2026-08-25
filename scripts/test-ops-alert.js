#!/usr/bin/env node
/**
 * Unit checks for ops-alert HTML escape + notification dedupe.
 * Run: node scripts/test-ops-alert.js
 */
'use strict';

const assert = require('assert');
const { escapeHtml, alreadyNotified } = require('../src/services/ops-alert.service');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', 'escapes angle brackets');
check(escapeHtml('a & b') === 'a &amp; b', 'escapes ampersand');
check(escapeHtml('"quoted"') === '&quot;quoted&quot;', 'escapes double quotes');
check(escapeHtml(null) === '', 'null becomes empty string');
check(escapeHtml(undefined) === '', 'undefined becomes empty string');
check(escapeHtml(42) === '42', 'coerces non-strings');

async function runDedupe() {
  const calls = [];
  const dbHit = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const dbMiss = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };

  const skipped = await alreadyNotified(dbHit, {
    type: 'tenant_bank_linked',
    relatedEntityId: 'ba_1',
  });
  check(skipped === true, 'returns true when a prior notification row exists');
  check(
    calls[0].params[0] === 'tenant_bank_linked' &&
      calls[0].params[1] === 'email' &&
      calls[0].params[2] === 'ba_1',
    'queries type, default email channel, and related entity id'
  );

  const fresh = await alreadyNotified(dbMiss, {
    type: 'site_visit_pending_approval',
    relatedEntityId: 'visit-9',
    channel: 'in_app',
  });
  check(fresh === false, 'returns false when no prior notification exists');
  check(calls[1].params[1] === 'in_app', 'honors explicit channel');

  const noId = await alreadyNotified(dbHit, {
    type: 'tenant_checkin_complete',
    relatedEntityId: null,
  });
  check(noId === false, 'missing relatedEntityId skips DB and returns false');
  check(calls.length === 2, 'does not query when relatedEntityId is missing');
}

runDedupe()
  .then(() => {
    if (failed) {
      console.error(`\n${failed} failure(s)`);
      process.exit(1);
    }
    console.log('\nAll ops-alert checks passed.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
