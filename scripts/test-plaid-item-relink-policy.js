#!/usr/bin/env node
/**
 * Unit checks for Plaid Item webhook needs-relink policy.
 * Run: node scripts/test-plaid-item-relink-policy.js
 */
'use strict';

const {
  itemErrorNeedsRelink,
  classifyItemWebhook,
  NEEDS_RELINK_CODES,
} = require('../src/utils/plaid-item-relink-policy');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(NEEDS_RELINK_CODES.has('PENDING_EXPIRATION'), 'PENDING_EXPIRATION is a relink webhook code');
check(NEEDS_RELINK_CODES.has('USER_PERMISSION_REVOKED'), 'USER_PERMISSION_REVOKED is a relink webhook code');
check(!NEEDS_RELINK_CODES.has('ITEM_LOGIN_REQUIRED'),
  'ITEM_LOGIN_REQUIRED is error-based, not a top-level webhook code');

check(itemErrorNeedsRelink({ error_code: 'ITEM_LOGIN_REQUIRED' }) === true,
  'snake_case ITEM_LOGIN_REQUIRED needs relink');
check(itemErrorNeedsRelink({ errorCode: 'ITEM_LOGIN_REQUIRED' }) === true,
  'camelCase ITEM_LOGIN_REQUIRED needs relink');
check(itemErrorNeedsRelink({ error_code: 'INSTITUTION_DOWN' }) === false,
  'other item errors do not force relink');
check(itemErrorNeedsRelink(null) === false, 'null error does not need relink');
check(itemErrorNeedsRelink(undefined) === false, 'undefined error does not need relink');

check(
  classifyItemWebhook({}).action === 'ignored'
    && classifyItemWebhook({}).reason === 'no_item_id',
  'missing item_id is ignored',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'PENDING_EXPIRATION',
  }).action === 'needs_relink',
  'PENDING_EXPIRATION marks needs_relink',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'USER_PERMISSION_REVOKED',
  }).action === 'needs_relink',
  'USER_PERMISSION_REVOKED marks needs_relink',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'ERROR',
    error: { error_code: 'ITEM_LOGIN_REQUIRED' },
  }).action === 'needs_relink',
  'ERROR + ITEM_LOGIN_REQUIRED marks needs_relink',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'SOME_OTHER',
    error: { error_code: 'ITEM_LOGIN_REQUIRED' },
  }).action === 'needs_relink',
  'ITEM_LOGIN_REQUIRED on any webhook code marks needs_relink',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'LOGIN_REPAIRED',
  }).action === 'cleared_relink',
  'LOGIN_REPAIRED clears needs_relink',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'NEW_ACCOUNTS_AVAILABLE',
  }).action === 'cleared_relink',
  'NEW_ACCOUNTS_AVAILABLE clears needs_relink',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'ERROR',
    error: { error_code: 'INTERNAL_SERVER_ERROR' },
  }).action === 'logged_error',
  'ERROR without login-required is log-only',
);

check(
  classifyItemWebhook({
    item_id: 'item_1',
    webhook_code: 'WEBHOOK_UPDATE_ACKNOWLEDGED',
  }).action === 'noop',
  'unrelated Item codes are noop',
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll Plaid Item relink policy checks passed.');
